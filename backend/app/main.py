import asyncio
import hashlib
import hmac
import json
import logging
import os
import secrets
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Query
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from prometheus_client import CollectorRegistry, Gauge, Counter, generate_latest, CONTENT_TYPE_LATEST
from sqlalchemy import select, insert, delete, text
from . import db
from .schemas import Snapshot
from .store import Store, Conflict

COOKIE = 'aeza_session'
logger = logging.getLogger(__name__)


class Login(BaseModel):
    login: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)


class SettingsPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_settings_version: int | None = None
    weights: dict[str, float] | None = None
    horizon_days: int | None = None
    urgency_days: int | None = None
    medium_threshold: float | None = None
    high_threshold: float | None = None
    coverage_threshold: float | None = None
    funded_multiplier: float | None = None


def create_app(database_url=None, data_path=None, password=None, fixed_as_of=None, testing=False):
    url = database_url or os.environ.get('DATABASE_URL', 'sqlite:///./aeza.db')
    engine = db.make_engine(url)
    if testing:
        db.metadata.create_all(engine)
    fixed = fixed_as_of or os.environ.get('ANALYSIS_AS_OF')
    if isinstance(fixed, str):
        fixed = datetime.fromisoformat(fixed.replace('Z', '+00:00'))
        if fixed.tzinfo is None:
            raise ValueError('ANALYSIS_AS_OF requires timezone')
    if fixed:
        if fixed.tzinfo is None:
            raise ValueError('Analysis time requires timezone')
        fixed = fixed.astimezone(timezone.utc)
    store = Store(engine, fixed)
    admin_password = password or os.environ.get('ADMIN_PASSWORD', '')
    if len(admin_password) < 12:
        raise ValueError('ADMIN_PASSWORD must contain at least 12 characters')
    fixture = data_path or os.environ.get('DATA_PATH', str(Path(__file__).resolve().parents[2] / 'data/original/data.json'))
    metrics_token = os.environ.get('METRICS_TOKEN', '')
    secure = os.environ.get('COOKIE_SECURE', 'false').lower() == 'true'
    attempts = defaultdict(deque)
    attempts_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        store.initialize(fixture, os.environ.get('ADMIN_LOGIN', 'admin'), admin_password)
        stop = asyncio.Event()

        async def tick():
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=60)
                except asyncio.TimeoutError:
                    if not store.fixed_as_of:
                        try:
                            await asyncio.to_thread(store.recalculate)
                        except Exception:
                            logger.exception('Scheduled calculation failed; last successful version retained')
        task = asyncio.create_task(tick())
        yield
        stop.set()
        await task
        engine.dispose()

    app = FastAPI(title='Aéza Retention API', version='0.1.0', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store = store

    @app.middleware('http')
    async def limits_and_headers(request, call_next):
        length = request.headers.get('content-length')
        if length and (not length.isdigit() or int(length) > 20 * 1024 * 1024):
            return Response('Payload too large', status_code=413)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'same-origin'
        if request.url.path.startswith('/api') or request.url.path == '/metrics':
            response.headers['Cache-Control'] = 'no-store'
        return response

    def session_for(request):
        token = request.cookies.get(COOKIE, '')
        if not token:
            return None
        hashed = hashlib.sha256(token.encode()).hexdigest()
        with engine.connect() as conn:
            row = conn.execute(
                select(db.sessions, db.users.c.login).join(db.users).where(db.sessions.c.token_hash == hashed)).mappings().first()
            if row and datetime.fromisoformat(row['expires']) > datetime.now(timezone.utc):
                return dict(row)
        return None

    def authorized(request: Request):
        session = session_for(request)
        if not session:
            raise HTTPException(401, 'Требуется вход')
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            if not hmac.compare_digest(request.headers.get('x-csrf-token', '').encode(), session['csrf'].encode()):
                raise HTTPException(403, 'Неверный CSRF-токен')
        return session

    def version(data):
        return {k: data[k] for k in ('calculation_version', 'source_version', 'settings_version', 'as_of', 'time_mode')}

    @app.get('/healthz', include_in_schema=False)
    def health():
        with engine.connect() as conn:
            conn.execute(text('SELECT 1'))
        return {'status': 'ok'}

    @app.post('/api/v1/auth/login', tags=['auth'])
    def login(body: Login, response: Response, request: Request):
        origin = request.headers.get('origin')
        if origin and origin.rstrip('/') != str(request.base_url).rstrip('/'):
            raise HTTPException(403, 'Origin не совпадает')
        ip = request.client.host if request.client else 'unknown'
        with attempts_lock:
            current = time.monotonic()
            for key in list(attempts):
                while attempts[key] and attempts[key][0] < current - 60:
                    attempts[key].popleft()
                if not attempts[key]:
                    del attempts[key]
            if len(attempts[ip]) >= 10:
                raise HTTPException(429, 'Слишком много попыток. Повторите через минуту.')
            attempts[ip].append(current)
        with engine.connect() as conn:
            user = conn.execute(select(db.users).where(db.users.c.login == body.login)).mappings().first()
        valid = False
        try:
            # Verify against a dummy hash too, avoiding a cheap username oracle.
            valid = PasswordHasher().verify(user['password_hash'] if user else app.state.dummy_hash, body.password) and bool(user)
        except (VerificationError, InvalidHashError):
            pass
        if not valid:
            raise HTTPException(401, 'Неверный логин или пароль')
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        with engine.begin() as conn:
            conn.execute(delete(db.sessions).where(db.sessions.c.expires < datetime.now(timezone.utc).isoformat()))
            old = request.cookies.get(COOKIE)
            if old:
                conn.execute(delete(db.sessions).where(db.sessions.c.token_hash == hashlib.sha256(old.encode()).hexdigest()))
            conn.execute(insert(db.sessions).values(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user['id'],
                         csrf=csrf, expires=(datetime.now(timezone.utc) + timedelta(hours=8)).isoformat()))
        response.set_cookie(COOKIE, token, httponly=True, secure=secure, samesite='strict', max_age=28800, path='/')
        return {'login': user['login'], 'csrf_token': csrf}

    app.state.dummy_hash = PasswordHasher().hash(secrets.token_urlsafe(24))

    @app.get('/api/v1/auth/me', tags=['auth'])
    def me(user=Depends(authorized)):
        return {'login': user['login'], 'csrf_token': user['csrf']}

    @app.post('/api/v1/auth/logout', tags=['auth'])
    def logout(response: Response, user=Depends(authorized)):
        with engine.begin() as conn:
            conn.execute(delete(db.sessions).where(db.sessions.c.token_hash == user['token_hash']))
        response.delete_cookie(COOKIE, path='/')
        return {'ok': True}

    @app.get('/api/v1/customers', dependencies=[Depends(authorized)], tags=['customers'])
    def customers(sort_by: str = Query('score', pattern='^(id|email|balance|totalReplenished|score)$'),
                  sort_order: str = Query('desc', pattern='^(asc|desc)$'), risk_level: str | None = Query(None, pattern='^(low|medium|high|unknown)$'),
                  search: str = Query('', max_length=320), page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100)):
        data = store.current()
        rows = [c for c in data['customers'] if (not risk_level or c['risk_level'] == risk_level) and
                (search.lower() in c['email'].lower() or search in str(c['id']))]
        known = [c for c in rows if c[sort_by] is not None]
        unknown = [c for c in rows if c[sort_by] is None]
        known.sort(key=lambda c: c['id'])
        known.sort(key=lambda c: c[sort_by], reverse=sort_order == 'desc')
        ordered = known + sorted(unknown, key=lambda c: c['id'])
        return {**version(data), 'items': [{k: v for k, v in c.items() if k != 'services'} for c in ordered[(page-1)*page_size:page*page_size]], 'total': len(rows), 'page': page, 'page_size': page_size}

    @app.get('/api/v1/customers/{customer_id}', dependencies=[Depends(authorized)], tags=['customers'])
    def customer(customer_id: int):
        data = store.current()
        row = next((c for c in data['customers'] if c['id'] == customer_id), None)
        if row is None:
            raise HTTPException(404, 'Клиент не найден')
        return {**version(data), **row}

    @app.get('/api/v1/analytics/summary', dependencies=[Depends(authorized)], tags=['analytics'])
    def summary():
        data = store.current()
        return {**version(data), **data['summary'], 'duration_seconds': data['duration_seconds'], 'recalculation_failures': store.failures}

    @app.get('/api/v1/model/settings', dependencies=[Depends(authorized)], tags=['model'])
    def settings():
        return store.settings()

    @app.patch('/api/v1/model/settings', dependencies=[Depends(authorized)], tags=['model'])
    def update_settings(body: SettingsPatch):
        try:
            changed = body.model_dump(exclude_unset=True)
            expected = changed.pop('expected_settings_version', None)
            if any(v is None for v in changed.values()):
                raise HTTPException(422, 'Параметры не могут быть null')
            return {**version(store.update_settings(changed, expected)), 'status': 'completed'}
        except Conflict as exc:
            raise HTTPException(409, str(exc)) from exc
        except ValidationError as exc:
            raise HTTPException(422, json.loads(exc.json(include_context=False))) from exc

    @app.put('/api/v1/source/snapshot', dependencies=[Depends(authorized)], tags=['source'])
    def import_snapshot(body: Snapshot):
        data = store.replace_snapshot(body)
        return {**version(data), 'status': 'completed', 'counts': {k: len(v) for k, v in body.model_dump().items()}, 'warnings': data['summary']['warnings']}

    @app.get('/api/v1/source/snapshot', dependencies=[Depends(authorized)], tags=['source'])
    def export_snapshot():
        return store.source()

    @app.post('/api/v1/source/demo', dependencies=[Depends(authorized)], tags=['source'])
    def add_demo():
        from .scenarios import demo_snapshot
        data = store.replace_snapshot(Snapshot.model_validate(demo_snapshot(store.source(), store.now())))
        return {**version(data), 'status': 'completed'}

    @app.post('/api/v1/source/original', dependencies=[Depends(authorized)], tags=['source'])
    def reset_original():
        with open(fixture, encoding='utf-8') as source:
            snapshot = Snapshot.model_validate(json.load(source))
        data = store.replace_snapshot(snapshot)
        return {**version(data), 'status': 'completed'}

    @app.get('/api/v1/events', tags=['events'])
    async def events(request: Request, user=Depends(authorized)):
        async def stream():
            previous = None
            while not await request.is_disconnected():
                valid = await asyncio.to_thread(session_for, request)
                if not valid:
                    return
                current = await asyncio.to_thread(store.current)
                if current['calculation_version'] != previous:
                    previous = current['calculation_version']
                    yield f'event: calculation\ndata: {json.dumps(version(current))}\n\n'
                else:
                    yield ': heartbeat\n\n'
                await asyncio.sleep(1)
        return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    @app.get('/metrics', tags=['metrics'])
    def metrics(request: Request):
        bearer = request.headers.get('authorization', '')
        token_ok = bool(metrics_token) and hmac.compare_digest(bearer.encode(), ('Bearer ' + metrics_token).encode())
        if not token_ok and not session_for(request):
            raise HTTPException(401, 'Требуется токен сборщика или сессия')
        data, registry = store.current(), CollectorRegistry()
        s = data['summary']
        risk = Gauge('churn_customers', 'Customers by risk level', ['risk_level'], registry=registry)
        for k, v in s['risk_counts'].items():
            risk.labels(k).set(v)
        for name, help_text, value in (
            ('churn_loss_index_eur', 'Scenario payment amount at risk in EUR; not calibrated expected loss', s['loss_eur']),
            ('churn_due_eur', 'Known renewal obligations in EUR', s['due_eur']),
            ('churn_unfunded_eur', 'Known obligations not covered by balance in EUR', s['unfunded_eur']),
            ('churn_money_unknown_services', 'Renewable services excluded for data quality', s['money_unknown_services']),
            ('churn_scored_customers', 'Customers with complete score', s['scored_customer_count']),
            ('churn_score_mean', 'Mean known customer score; NaN when absent', s['score_mean'] if s['score_mean'] is not None else float('nan')),
            ('churn_calculation_version', 'Published calculation version', data['calculation_version']),
            ('churn_last_calculation_timestamp_seconds', 'Analysis as_of timestamp', datetime.fromisoformat(data['as_of']).timestamp()),
            ('churn_calculation_duration_seconds', 'Last calculation duration', data['duration_seconds']),
        ):
            Gauge(name, help_text, registry=registry).set(value)
        Counter('churn_recalculations', 'Published calculations', registry=registry).inc(data['calculation_version'])
        Counter('churn_recalculation_failures', 'Timer calculation errors since process start', registry=registry).inc(store.failures)
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    @app.get('/api/v1/docs', dependencies=[Depends(authorized)], include_in_schema=False)
    def docs():
        return get_swagger_ui_html(openapi_url='/api/v1/openapi.json', title='Aéza Retention API',
            swagger_js_url='/swagger/swagger-ui-bundle.js', swagger_css_url='/swagger/swagger-ui.css')

    @app.get('/api/v1/openapi.json', dependencies=[Depends(authorized)], include_in_schema=False)
    def openapi():
        return app.openapi()

    from swagger_ui_bundle import swagger_ui_path
    app.mount('/swagger', StaticFiles(directory=swagger_ui_path), name='swagger-assets')
    frontend = os.environ.get('FRONTEND_DIST')
    if frontend and Path(frontend).exists():
        app.mount('/', StaticFiles(directory=frontend, html=True), name='frontend')

    def openapi_schema():
        from fastapi.openapi.utils import get_openapi
        if app.openapi_schema:
            return app.openapi_schema
        schema = get_openapi(title=app.title, version=app.version, routes=app.routes,
            description='Explainable retention index. Cookie session required; mutating authenticated requests require X-CSRF-Token. All source money fields are integer EUR cents. API fields ending _eur are EUR. Scores are indices, not calibrated probabilities.')
        security = schema.setdefault('components', {}).setdefault('securitySchemes', {})
        security.update(SessionCookie={'type':'apiKey','in':'cookie','name':COOKIE}, MetricsBearer={'type':'http','scheme':'bearer'})
        for path, methods in schema['paths'].items():
            for method, operation in methods.items():
                if path == '/api/v1/auth/login':
                    operation['security'] = []
                elif path == '/metrics':
                    operation['security'] = [{'SessionCookie':[]},{'MetricsBearer':[]}]
                else:
                    operation['security'] = [{'SessionCookie':[]}]
                    if method in {'post','put','patch','delete'}:
                        operation.setdefault('parameters', []).append({'name':'X-CSRF-Token','in':'header','required':True,'schema':{'type':'string'},'description':'csrf_token returned by login/me'})
        app.openapi_schema = schema
        return schema
    app.openapi = openapi_schema
    return app


def production_app():
    return create_app()
