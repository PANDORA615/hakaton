import copy
import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, func
from app import db
from app.main import create_app
from app.schemas import Snapshot, Settings
from app.scoring import calculate, add_term, score_service, eur
from app.scenarios import demo_snapshot

DATA_PATH = Path(__file__).resolve().parents[2] / 'data/original/data.json'
NOW = datetime(2026, 10, 19, 15, tzinfo=timezone.utc)
PASSWORD = 'test-only-password-2841'


@pytest.fixture
def source():
    return json.loads(DATA_PATH.read_text())


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv('METRICS_TOKEN', 'test-only-metrics-token')
    return create_app(f'sqlite:///{tmp_path}/test.db', str(DATA_PATH), PASSWORD, NOW, testing=True)


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


def sign_in(client):
    response = client.post('/api/v1/auth/login', json={'login': 'admin', 'password': PASSWORD})
    assert response.status_code == 200
    return {'X-CSRF-Token': response.json()['csrf_token']}


def test_fixed_and_live_time_contract(tmp_path, monkeypatch):
    url = f'sqlite:///{tmp_path}/clock.db'
    monkeypatch.delenv('ANALYSIS_AS_OF', raising=False)
    fixed_app = create_app(url, str(DATA_PATH), PASSWORD, testing=True)
    assert fixed_app.state.store.fixed_as_of.isoformat() == '2026-10-19T15:00:00+00:00'
    monkeypatch.setenv('ANALYSIS_AS_OF', 'invalid')
    with pytest.raises(ValueError, match='ANALYSIS_AS_OF must be empty'):
        create_app(url, str(DATA_PATH), PASSWORD, testing=True)
    monkeypatch.setenv('ANALYSIS_AS_OF', '')
    monkeypatch.setenv('RECALC_INTERVAL_SECONDS', '1')
    live_app = create_app(url, str(DATA_PATH), PASSWORD, testing=True)
    with TestClient(live_app) as live:
        sign_in(live)
        before = live.get('/api/v1/analytics/summary').json()
        assert before['time_mode'] == 'live'
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            after = live.get('/api/v1/analytics/summary').json()
            if after['calculation_version'] > before['calculation_version']:
                break
            time.sleep(.1)
        assert after['calculation_version'] > before['calculation_version']
        assert datetime.fromisoformat(after['as_of']).tzinfo is not None


def test_history_retention_keeps_predecessor_and_current(tmp_path, monkeypatch, source):
    monkeypatch.setenv('RETENTION_RUN_LIMIT', '2')
    monkeypatch.setenv('RETENTION_SNAPSHOT_LIMIT', '2')
    app = create_app(f'sqlite:///{tmp_path}/retention.db', str(DATA_PATH), PASSWORD, NOW, testing=True)
    with TestClient(app):
        active_id = next(item['id'] for item in source['services'] if item['status'] == 'active')
        for index in range(5):
            changed = copy.deepcopy(source)
            if index >= 3:
                next(item for item in changed['services'] if item['id'] == active_id)['status'] = 'deleted'
            app.state.store.replace_snapshot(Snapshot.model_validate(changed))
        with app.state.store.engine.connect() as conn:
            assert conn.scalar(select(func.count()).select_from(db.runs)) == 2
            assert conn.scalar(select(func.count()).select_from(db.snapshots)) == 3
        history = app.state.store.history(2)
        assert len(history) == 2
        assert history[1]['deleted_count'] == 1


def test_concurrent_add_to_work_is_idempotent(app):
    with TestClient(app):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: app.state.store.save_action(1, 'open', '', expected_version=0), range(2)))
        assert all(item['version'] == 1 for item in results)
        assert len(app.state.store.actions()) == 1


def test_remember_me_changes_session_persistence(client):
    temporary = client.post('/api/v1/auth/login', json={'login': 'admin', 'password': PASSWORD})
    assert temporary.status_code == 200
    assert temporary.json()['remember_me'] is False
    assert 'Max-Age' not in temporary.headers['set-cookie']
    assert client.get('/api/v1/auth/me').json()['remember_me'] is False
    remembered = client.post('/api/v1/auth/login', json={'login': 'admin', 'password': PASSWORD, 'remember_me': True})
    assert remembered.status_code == 200
    assert remembered.json()['remember_me'] is True
    assert 'Max-Age=2592000' in remembered.headers['set-cookie']
    assert client.get('/api/v1/auth/me').json()['remember_me'] is True
    assert client.get('/api/v1/account').json()['remember_me'] is True


def test_auth_methods_and_incomplete_oidc_configuration(client, tmp_path, monkeypatch):
    assert client.get('/api/v1/auth/methods').json() == {'password': True, 'oidc': False}
    assert client.get('/api/v1/auth/oidc/start').status_code == 404
    monkeypatch.setenv('OIDC_CLIENT_ID', 'incomplete')
    with pytest.raises(ValueError, match='Complete all OIDC settings'):
        create_app(f'sqlite:///{tmp_path}/oidc.db', str(DATA_PATH), PASSWORD, NOW, testing=True)


def test_oidc_requires_allowed_subject_and_issues_local_session(tmp_path, monkeypatch):
    from fastapi.responses import RedirectResponse
    from app import main as main_module

    class Provider:
        subject = 'unknown'

        async def authorize_redirect(self, request, redirect_uri):
            request.session['state'] = 'test-state'
            return RedirectResponse('https://identity.example/authorize', status_code=302)

        async def authorize_access_token(self, request):
            assert request.session['state'] == 'test-state'
            return {'userinfo': {'sub': self.subject}}

    provider = Provider()

    class OAuthStub:
        def register(self, *args, **kwargs):
            self.provider = provider

    monkeypatch.setattr(main_module, 'OAuth', OAuthStub)
    settings = {
        'OIDC_ISSUER_URL': 'https://identity.example/realms/prototype',
        'OIDC_CLIENT_ID': 'prototype',
        'OIDC_CLIENT_SECRET': 'test-client-secret',
        'OIDC_CALLBACK_URL': 'https://app.example/api/v1/auth/oidc/callback',
        'OIDC_ALLOWED_SUB': 'approved-subject',
        'OIDC_SESSION_SECRET': 'test-session-secret-longer-than-thirty-two-characters',
    }
    for key, value in settings.items():
        monkeypatch.setenv(key, value)
    app = create_app(f'sqlite:///{tmp_path}/oidc.db', str(DATA_PATH), PASSWORD, NOW, testing=True)
    with TestClient(app, base_url='https://app.example') as oidc_client:
        assert oidc_client.get('/api/v1/auth/methods').json()['oidc'] is True
        oidc_client.get('/api/v1/auth/oidc/start', follow_redirects=False)
        denied = oidc_client.get('/api/v1/auth/oidc/callback', follow_redirects=False)
        assert denied.status_code == 303
        assert 'auth_error=oidc_failed' in denied.headers['location']
        assert oidc_client.get('/api/v1/auth/me').status_code == 401
        provider.subject = 'approved-subject'
        oidc_client.get('/api/v1/auth/oidc/start?remember_me=true', follow_redirects=False)
        accepted = oidc_client.get('/api/v1/auth/oidc/callback', follow_redirects=False)
        assert accepted.status_code == 303
        assert accepted.headers['location'] == '/?oidc_login=success'
        assert oidc_client.get('/api/v1/auth/me').json()['login'] == 'admin'
        assert oidc_client.get('/api/v1/auth/me').json()['remember_me'] is True


def test_account_profile_password_and_sessions(client):
    assert client.get('/api/v1/account').status_code == 401
    headers = sign_in(client)
    initial = client.get('/api/v1/account').json()
    assert initial['login'] == 'admin'
    assert initial['last_login_at']
    assert initial['active_sessions'] == 1
    profile = {'login': 'new.admin', 'display_name': 'Руководитель', 'email': 'owner@example.test'}
    assert client.put('/api/v1/account/profile', headers=headers, json=profile).status_code == 403
    changed = client.put('/api/v1/account/profile', headers=headers,
                         json={**profile, 'current_password': PASSWORD})
    assert changed.status_code == 200
    assert changed.json()['display_name'] == 'Руководитель'
    assert changed.json()['login'] == 'new.admin'
    assert changed.json()['email'] == 'owner@example.test'
    assert client.put('/api/v1/account/profile', headers=headers,
                      json={**profile, 'email': 'invalid-email'}).status_code == 422

    other = TestClient(client.app)
    assert other.post('/api/v1/auth/login', json={'login': 'new.admin', 'password': PASSWORD}).status_code == 200
    assert client.get('/api/v1/account').json()['active_sessions'] == 2
    revoked = client.post('/api/v1/account/sessions/revoke', headers=headers)
    assert revoked.json()['revoked'] == 1
    assert other.get('/api/v1/auth/me').status_code == 401

    assert client.post('/api/v1/account/password', headers=headers,
                       json={'current_password': 'wrong', 'new_password': 'new-test-password-2841'}).status_code == 403
    changed_password = client.post('/api/v1/account/password', headers=headers,
                                   json={'current_password': PASSWORD, 'new_password': 'new-test-password-2841'})
    assert changed_password.status_code == 200
    assert client.get('/api/v1/account').json()['password_changed_at']
    client.post('/api/v1/auth/logout', headers=headers)
    assert client.post('/api/v1/auth/login', json={'login': 'new.admin', 'password': PASSWORD}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'login': 'new.admin', 'password': 'new-test-password-2841'}).status_code == 200


def test_account_settings_survive_restart(tmp_path):
    url = f'sqlite:///{tmp_path}/account-restart.db'
    first = create_app(url, str(DATA_PATH), PASSWORD, NOW, testing=True)
    with TestClient(first) as client:
        headers = sign_in(client)
        assert client.put('/api/v1/account/profile', headers=headers,
                          json={'login': 'admin', 'display_name': 'Команда удержания',
                                'email': 'team@example.test'}).status_code == 200
        assert client.post('/api/v1/account/password', headers=headers,
                           json={'current_password': PASSWORD, 'new_password': 'persisted-password-2841'}).status_code == 200
    second = create_app(url, str(DATA_PATH), 'different-env-password-2841', NOW, testing=True)
    with TestClient(second) as client:
        assert client.post('/api/v1/auth/login', json={'login': 'admin', 'password': PASSWORD}).status_code == 401
        assert client.post('/api/v1/auth/login', json={'login': 'admin', 'password': 'persisted-password-2841'}).status_code == 200
        profile = client.get('/api/v1/account').json()
        assert profile['display_name'] == 'Команда удержания'
        assert profile['email'] == 'team@example.test'
        assert profile['password_changed_at']


@pytest.mark.parametrize('path', ['/api/v1/auth/me', '/api/v1/customers', '/api/v1/customers/1',
    '/api/v1/analytics/summary', '/api/v1/model/settings', '/api/v1/source/snapshot', '/api/v1/docs', '/api/v1/openapi.json', '/metrics', '/api/v1/events'])
def test_unauthenticated_denied(client, path):
    assert client.get(path).status_code == 401


def test_source_contract_and_quality(source):
    snapshot = Snapshot.model_validate(source)
    result = calculate(snapshot, Settings(), NOW)
    summary = result['summary']
    assert [len(source[k]) for k in ('accounts', 'services', 'transactions')] == [10,30,100]
    assert len(summary['warnings']) == 8
    assert summary['money_unknown_services'] == 8
    assert sum(summary['risk_counts'].values()) == 10
    assert summary['money_partial'] is True
    for c in result['customers']:
        for s in c['services']:
            if s['status'] == 'prolong_wait':
                assert s['score'] is None
                assert s['loss_eur'] is None


@pytest.mark.parametrize('mutation', ['bonus','bool_money','owner','service','duplicate','performed','date','amount'])
def test_invalid_snapshot(source, mutation):
    if mutation == 'bonus': source['accounts'][0]['bonusState'] = 'active'
    if mutation == 'bool_money': source['accounts'][0]['balance'] = True
    if mutation == 'owner': source['services'][0]['ownerId'] = 99999
    if mutation == 'service': source['transactions'][0]['serviceId'] = 99999
    if mutation == 'duplicate': source['accounts'][1]['id'] = 1
    if mutation == 'performed': source['transactions'][0]['performedAt'] = None
    if mutation == 'date': source['services'][0]['expiresAt'] = '2026-10-19T15:00:00'
    if mutation == 'amount': source['transactions'][0]['amount'] = 1001
    with pytest.raises(ValidationError): Snapshot.model_validate(source)


def test_money_formula_63_eur(source):
    service = Snapshot.model_validate(source).services[0]
    service.expiresAt = NOW
    # funding_gap=.8 at weight 87.5, other weights 0 => score 80, not 70.
    # Use no_autoprolong=1 at 70, all other weights 0 except waiting=30 (0).
    service.autoProlong = False
    service.status = 'active'
    config = Settings(weights={'no_autoprolong':70,'funding_gap':0,'payment_wait':30,'expiry_urgency':0})
    result = score_service(service, [10000,8000], config, NOW)
    assert result['score'] == 70
    assert result['loss_eur'] == 63
    assert any('7219.43 ₽' in reason['text'] for reason in result['reasons'])


def test_shared_balance_and_bonus(source):
    demo = Snapshot.model_validate(demo_snapshot(source, NOW))
    result = calculate(demo, Settings(), NOW)
    shared = next(c for c in result['customers'] if c['id'] == 1005)
    assert shared['due_eur'] == 140
    assert shared['unfunded_eur'] == 60
    unlocked = next(c for c in result['customers'] if c['id'] == 1004)
    assert unlocked['unfunded_eur'] == 0
    locked = next(c for c in result['customers'] if c['id'] == 1006)
    assert locked['unfunded_eur'] == 180
    assert all(result['summary']['risk_counts'][k] > 0 for k in ('low','medium','high','unknown'))


def test_calendar_clamping():
    value = datetime(2024,1,31,tzinfo=timezone.utc)
    assert add_term(value,'month').day == 29
    assert add_term(value,'month',2).day == 31
    assert add_term(datetime(2024,2,29,tzinfo=timezone.utc),'year').day == 28


def test_live_clock_and_zero_price(source):
    source['services'][0]['price'] = 0
    result = calculate(Snapshot.model_validate(source),Settings(),datetime(2026,10,23,15,tzinfo=timezone.utc))
    assert result['summary']['money_unknown_services'] >= 8
    assert result['summary']['loss_eur'] >= 0


@pytest.mark.parametrize('sort_by', ['id','email','balance','totalReplenished','score'])
@pytest.mark.parametrize('order', ['asc','desc'])
def test_sorting_before_pagination(client, sort_by, order):
    sign_in(client)
    data = client.get(f'/api/v1/customers?sort_by={sort_by}&sort_order={order}&page_size=100').json()
    known = [c[sort_by] for c in data['items'] if c[sort_by] is not None]
    assert known == sorted(known, reverse=order == 'desc')
    first = client.get(f'/api/v1/customers?sort_by={sort_by}&sort_order={order}&page_size=3').json()
    assert [c['id'] for c in first['items']] == [c['id'] for c in data['items'][:3]]


def test_auth_csrf_and_logout(client):
    assert client.post('/api/v1/auth/login', json={'login':'admin','password':'wrong'}).status_code == 401
    headers = sign_in(client)
    assert client.get('/api/v1/auth/me').json()['login'] == 'admin'
    assert client.patch('/api/v1/model/settings', json={'horizon_days':8}).status_code == 403
    old_cookie = client.cookies.get('aeza_session')
    assert client.post('/api/v1/auth/logout',headers=headers).status_code == 200
    assert client.get('/api/v1/customers', headers={'Cookie':'aeza_session='+old_cookie}).status_code == 401


def test_settings_recalc_conflict_and_persistence(client, app):
    headers = sign_in(client)
    before = client.get('/api/v1/analytics/summary').json()
    config = client.get('/api/v1/model/settings').json()
    changed = client.patch('/api/v1/model/settings', headers=headers, json={'expected_settings_version':config['settings_version'], 'weights':{'no_autoprolong':90}})
    assert changed.status_code == 200
    after = client.get('/api/v1/analytics/summary').json()
    assert after['calculation_version'] > before['calculation_version']
    assert after['loss_eur'] != before['loss_eur']
    conflict = client.patch('/api/v1/model/settings',headers=headers,json={'expected_settings_version':config['settings_version'],'horizon_days':8})
    assert conflict.status_code == 409
    with app.state.store.engine.connect() as conn:
        latest = app.state.store.latest(conn,db.settings_versions)
        assert latest['payload']['weights']['no_autoprolong'] == 90


def test_settings_invalid_do_not_publish(client):
    headers = sign_in(client)
    before = client.get('/api/v1/analytics/summary').json()['calculation_version']
    for payload in ({'weights':{'no_autoprolong':0,'funding_gap':0,'payment_wait':0,'expiry_urgency':0}},
                    {'medium_threshold':80,'high_threshold':30}, {'horizon_days':1,'urgency_days':3}, {'funded_multiplier':2}, {'horizon_days':None}):
        assert client.patch('/api/v1/model/settings',headers=headers,json=payload).status_code == 422
    assert client.get('/api/v1/analytics/summary').json()['calculation_version'] == before


def test_snapshot_repeat_rollback_and_counts(client, app, source):
    headers = sign_in(client)
    for _ in range(2):
        assert client.put('/api/v1/source/snapshot',headers=headers,json=source).status_code == 200
    with app.state.store.engine.connect() as conn:
        assert [conn.scalar(select(func.count()).select_from(t)) for t in (db.accounts,db.services,db.transactions)] == [10,30,100]
    current = client.get('/api/v1/analytics/summary').json()['calculation_version']
    bad = copy.deepcopy(source);bad['services'][0]['ownerId']=987654
    assert client.put('/api/v1/source/snapshot',headers=headers,json=bad).status_code == 422
    assert client.get('/api/v1/analytics/summary').json()['calculation_version'] == current
    assert client.get('/api/v1/source/snapshot').json() == source


def test_history_tracks_observed_deletion(client, source):
    headers = sign_in(client)
    service = next(item for item in source['services'] if item['status'] == 'active')
    service['status'] = 'deleted'
    assert client.put('/api/v1/source/snapshot', headers=headers, json=source).status_code == 200
    history = client.get('/api/v1/analytics/history').json()['snapshots']
    assert history[0]['deleted_count'] == 1
    assert history[0]['transitions'][0]['service_id'] == service['id']
    assert history[0]['transitions'][0]['to_status'] == 'deleted'
    assert 'risk_eur' in client.get('/api/v1/analytics/summary').json()['renewal_calendar'][0]


def test_scenario_does_not_publish_or_change_source(client, source):
    headers = sign_in(client)
    client.post('/api/v1/source/demo', headers=headers)
    before = client.get('/api/v1/analytics/summary').json()['calculation_version']
    original = client.get('/api/v1/source/snapshot').json()
    response = client.post('/api/v1/customers/1006/simulate', headers=headers,
                           json={'balance_cents': 100000, 'service_id': 1006, 'auto_prolong': True})
    assert response.status_code == 200
    result = response.json()
    assert result['saved'] is False
    assert result['after']['loss_eur'] <= result['before']['loss_eur']
    assert client.get('/api/v1/analytics/summary').json()['calculation_version'] == before
    assert client.get('/api/v1/source/snapshot').json() == original
    assert client.post('/api/v1/customers/1006/simulate', headers=headers, json={}).status_code == 422


def test_marketing_actions(client, source):
    headers = sign_in(client)
    assert client.get('/api/v1/actions').json()['items'] == []
    assert client.get('/api/v1/actions/outcomes').json()['renewal_share_pct'] is None
    response = client.put('/api/v1/actions/1', headers=headers, json={'status': 'open', 'note': '', 'expected_version': 0})
    assert response.status_code == 200
    assert response.json()['customer']['id'] == 1
    assert response.json()['version'] == 1
    duplicate = client.put('/api/v1/actions/1', headers=headers, json={'status': 'open', 'note': '', 'expected_version': 0})
    assert duplicate.status_code == 200 and duplicate.json()['version'] == 1
    response = client.put('/api/v1/actions/1', headers=headers, json={'status': 'contacted', 'note': 'Связались', 'expected_version': 1})
    assert response.status_code == 200
    assert response.json()['version'] == 2
    stale = client.put('/api/v1/actions/1', headers=headers, json={'status': 'contacted', 'note': 'Старая заметка', 'expected_version': 1})
    assert stale.status_code == 409
    assert stale.json()['detail']['current']['version'] == 2
    assert client.get('/api/v1/actions').json()['items'][0]['note'] == 'Связались'
    renewed = client.put('/api/v1/actions/1', headers=headers, json={'status': 'resolved', 'note': 'Продлил', 'outcome': 'renewed', 'expected_version': 2})
    assert renewed.status_code == 200
    recorded_at = renewed.json()['outcome_recorded_at']
    assert recorded_at
    assert client.put('/api/v1/actions/2', headers=headers, json={'status': 'resolved', 'note': 'Отказ', 'outcome': 'not_renewed'}).status_code == 200
    result = client.get('/api/v1/actions/outcomes').json()
    assert (result['renewed'], result['not_renewed'], result['known_total'], result['renewal_share_pct']) == (1, 1, 2, 50.0)
    preserved = client.put('/api/v1/actions/1', headers=headers, json={'status': 'resolved', 'note': 'Комментарий обновлён', 'expected_version': 3})
    assert preserved.json()['outcome'] == 'renewed'
    assert preserved.json()['outcome_recorded_at'] == recorded_at
    assert client.put('/api/v1/actions/1', headers=headers, json={'status': 'resolved', 'outcome': 'invalid'}).status_code == 422
    assert client.put('/api/v1/actions/1', headers=headers, json={'status': 'open', 'outcome': 'renewed', 'expected_version': 4}).status_code == 422
    assert client.put('/api/v1/actions/999999', headers=headers, json={'status': 'open'}).status_code == 404
    removed_services = {service['id'] for service in source['services'] if service['ownerId'] == 1}
    source['accounts'] = [account for account in source['accounts'] if account['id'] != 1]
    source['services'] = [service for service in source['services'] if service['id'] not in removed_services]
    source['transactions'] = [transaction for transaction in source['transactions'] if transaction['serviceId'] not in removed_services]
    assert client.put('/api/v1/source/snapshot', headers=headers, json=source).status_code == 200
    assert client.put('/api/v1/actions/1', headers=headers, json={'status': 'resolved', 'note': 'Завершено', 'expected_version': 4}).status_code == 200
    assert client.get('/api/v1/actions').json()['items'][0]['customer'] is None
    assert client.get('/api/v1/actions/outcomes').json()['renewed'] == 1


def test_metrics_and_openapi(client):
    headers = sign_in(client)
    summary = client.get('/api/v1/analytics/summary').json()
    metrics = client.get('/metrics').text
    for level, count in summary['risk_counts'].items():
        assert f'churn_customers{{risk_level="{level}"}} {float(count)}' in metrics
    assert f'churn_loss_index_eur {summary["loss_eur"]}' in metrics
    assert 'user-0001' not in metrics
    assert client.get('/api/v1/docs').status_code == 200
    assert client.get('/swagger/swagger-ui-bundle.js').status_code == 200
    spec = client.get('/api/v1/openapi.json').json()
    assert 'patch' in spec['paths']['/api/v1/model/settings']
    client.post('/api/v1/auth/logout',headers=headers)
    assert client.get('/metrics',headers={'Authorization':'Bearer test-only-metrics-token'}).status_code == 200
    assert client.get('/api/v1/customers',headers={'Authorization':'Bearer test-only-metrics-token'}).status_code == 401


def test_demo_adds_without_editing_original(client, source):
    headers = sign_in(client)
    assert client.post('/api/v1/source/demo',headers=headers).status_code == 200
    data = client.get('/api/v1/source/snapshot').json()
    assert data['accounts'][:10] == source['accounts']
    assert data['services'][:30] == source['services']
    assert data['transactions'] == source['transactions']
    assert len(data['accounts']) == 16
    client.post('/api/v1/source/demo',headers=headers)
    assert client.get('/api/v1/analytics/summary').json()['customer_count'] == 16
    client.post('/api/v1/source/original',headers=headers)
    assert client.get('/api/v1/analytics/summary').json()['customer_count'] == 10


def test_restart_keeps_settings_and_source(tmp_path):
    url=f'sqlite:///{tmp_path}/restart.db'
    a=create_app(url,str(DATA_PATH),PASSWORD,NOW,testing=True)
    with TestClient(a) as c:
        headers=sign_in(c)
        c.patch('/api/v1/model/settings',headers=headers,json={'horizon_days':10})
        c.post('/api/v1/source/demo',headers=headers)
        old_version = c.get('/api/v1/analytics/summary').json()['calculation_version']
    with a.state.store.engine.begin() as conn:
        payload = dict(conn.execute(select(db.runs.c.payload).where(db.runs.c.id == old_version)).scalar_one())
        payload.pop('schema_version')
        conn.execute(db.runs.update().where(db.runs.c.id == old_version).values(payload=payload))
    b=create_app(url,str(DATA_PATH),'another-password-123',NOW,testing=True)
    with TestClient(b) as c:
        sign_in(c)  # Existing password is preserved, not overwritten by env.
        assert c.get('/api/v1/model/settings').json()['horizon_days']==10
        summary = c.get('/api/v1/analytics/summary').json()
        assert summary['customer_count']==16
        assert summary['calculation_version'] > old_version
        assert 'risk_eur' in summary['renewal_calendar'][0]
