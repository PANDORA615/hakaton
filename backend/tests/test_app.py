import copy
import json
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
    b=create_app(url,str(DATA_PATH),'another-password-123',NOW,testing=True)
    with TestClient(b) as c:
        sign_in(c)  # Existing password is preserved, not overwritten by env.
        assert c.get('/api/v1/model/settings').json()['horizon_days']==10
        assert c.get('/api/v1/analytics/summary').json()['customer_count']==16
