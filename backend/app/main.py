import asyncio
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
from urllib.parse import urlsplit
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from authlib.integrations.starlette_client import OAuth
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Query
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator, field_validator
from prometheus_client import CollectorRegistry, Gauge, Counter, generate_latest, CONTENT_TYPE_LATEST
from sqlalchemy import select, insert, delete, text
from sqlalchemy import update, func
from sqlalchemy.exc import IntegrityError
from starlette.middleware.sessions import SessionMiddleware
from . import db
from .schemas import Snapshot
from .store import Store, Conflict, ActionConflict
from .fx import fx_cache
from .tariffs import TariffCatalog

COOKIE = 'aeza_session'
logger = logging.getLogger(__name__)


class Login(BaseModel):
    login: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=1024)
    remember_me: bool = False


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    login: str = Field(min_length=3, max_length=40, pattern=r'^[A-Za-z0-9_.-]+$')
    display_name: str = Field(min_length=1, max_length=80)
    email: str = Field(default='', max_length=254)
    current_password: str | None = None

    @field_validator('display_name', 'email')
    @classmethod
    def trim_fields(cls, value):
        return value.strip()

    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        if value and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value):
            raise ValueError('Укажите корректный email')
        return value


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=12, max_length=1024)


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


class CustomerCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(min_length=3, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    balance_cents: int = Field(default=0, ge=0, le=9223372036854775807, strict=True)
    expected_source_version: int = Field(ge=1, strict=True)

    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value):
            raise ValueError('Укажите корректный email')
        return value

    @field_validator('phone')
    @classmethod
    def valid_phone(cls, value):
        if value is None or not value.strip():
            return None
        normalized = re.sub(r'[\s()\-]', '', value)
        if not re.fullmatch(r'\+[1-9]\d{9,14}', normalized):
            raise ValueError('Укажите номер в международном формате: +79991234567')
        return normalized


class ScenarioRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    balance_cents: int | None = Field(default=None, ge=0, le=9223372036854775807)
    service_id: int | None = Field(default=None, gt=0)
    auto_prolong: bool | None = None

    @model_validator(mode='after')
    def valid_scenario(self):
        if (self.service_id is None) != (self.auto_prolong is None):
            raise ValueError('Укажите услугу и состояние автопродления вместе')
        if self.balance_cents is None and self.service_id is None:
            raise ValueError('Укажите хотя бы одно изменение')
        return self


class ActionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: str = Field(pattern='^(open|contacted|resolved)$')
    note: str = Field(default='', max_length=2000)
    outcome: str | None = Field(default=None, pattern='^(pending|renewed|not_renewed)$')
    expected_version: int | None = Field(default=None, ge=0)
    assignee: str | None = Field(default=None, max_length=80)
    next_contact_at: datetime | None = None

    @field_validator('next_contact_at')
    @classmethod
    def contact_date_has_timezone(cls, value):
        if value is not None and value.utcoffset() is None:
            raise ValueError('Укажите дату со смещением часового пояса')
        return value


class ContactRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    channel: str = Field(pattern='^(call|email|chat|other)$')
    note: str = Field(min_length=1, max_length=2000)
    expected_version: int = Field(ge=1)
    next_contact_at: datetime | None = None

    @field_validator('note')
    @classmethod
    def contact_note_not_blank(cls, value):
        if not value.strip():
            raise ValueError('Опишите результат контакта')
        return value

    @field_validator('next_contact_at')
    @classmethod
    def contact_date_has_timezone(cls, value):
        return ActionRequest.contact_date_has_timezone(value)


def create_app(database_url=None, data_path=None, password=None, fixed_as_of=None, testing=False):
    url = database_url or os.environ.get('DATABASE_URL', 'sqlite:///./aeza.db')
    engine = db.make_engine(url)
    if testing:
        db.metadata.create_all(engine)
    fixed = fixed_as_of or os.environ.get('ANALYSIS_AS_OF', '2026-10-19T15:00:00Z')
    if isinstance(fixed, str):
        try:
            fixed = datetime.fromisoformat(fixed.replace('Z', '+00:00')) if fixed else None
        except ValueError as exc:
            raise ValueError('ANALYSIS_AS_OF must be empty for live mode or an ISO date/time with timezone') from exc
        if fixed is not None and fixed.tzinfo is None:
            raise ValueError('ANALYSIS_AS_OF requires timezone')
    if fixed:
        if fixed.tzinfo is None:
            raise ValueError('Analysis time requires timezone')
        fixed = fixed.astimezone(timezone.utc)
    store = Store(engine, fixed)
    tariff_catalog = TariffCatalog(engine)
    try:
        recalc_interval = float(os.environ.get('RECALC_INTERVAL_SECONDS', '60'))
    except ValueError as exc:
        raise ValueError('RECALC_INTERVAL_SECONDS must be between 1 and 3600') from exc
    if not 1 <= recalc_interval <= 3600:
        raise ValueError('RECALC_INTERVAL_SECONDS must be between 1 and 3600')
    admin_password = password or os.environ.get('ADMIN_PASSWORD', '')
    if len(admin_password) < 12:
        raise ValueError('ADMIN_PASSWORD must contain at least 12 characters')
    fixture = data_path or os.environ.get('DATA_PATH', str(Path(__file__).resolve().parents[2] / 'data/original/data.json'))
    metrics_token = os.environ.get('METRICS_TOKEN', '')
    secure = os.environ.get('COOKIE_SECURE', 'false').lower() == 'true'
    oidc_names = ('OIDC_ISSUER_URL', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET', 'OIDC_CALLBACK_URL',
                  'OIDC_ALLOWED_SUB', 'OIDC_SESSION_SECRET')
    oidc_config = {name: os.environ.get(name, '').strip() for name in oidc_names}
    oidc_enabled = all(oidc_config.values())
    if any(oidc_config.values()) and not oidc_enabled:
        raise ValueError('Complete all OIDC settings or leave them all empty')
    if oidc_enabled:
        secure = True
        issuer = urlsplit(oidc_config['OIDC_ISSUER_URL'])
        callback = urlsplit(oidc_config['OIDC_CALLBACK_URL'])
        if issuer.scheme != 'https' or not issuer.netloc or issuer.query or issuer.fragment:
            raise ValueError('OIDC_ISSUER_URL must be an HTTPS issuer URL')
        if callback.scheme != 'https' or not callback.netloc or callback.path != '/api/v1/auth/oidc/callback' or callback.query or callback.fragment:
            raise ValueError('OIDC_CALLBACK_URL must be an HTTPS callback URL with the expected path')
        if len(oidc_config['OIDC_SESSION_SECRET']) < 32:
            raise ValueError('OIDC_SESSION_SECRET must contain at least 32 characters')
        allowed_subs = {item.strip() for item in oidc_config['OIDC_ALLOWED_SUB'].split(',') if item.strip()}
        if len(allowed_subs) != 1:
            raise ValueError('OIDC_ALLOWED_SUB must contain exactly one subject while the app has one local administrator')
    attempts = defaultdict(deque)
    attempts_lock = threading.Lock()

    @asynccontextmanager
    async def lifespan(app):
        store.initialize(fixture, os.environ.get('ADMIN_LOGIN', 'admin'), admin_password)
        stop = asyncio.Event()

        async def tick():
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=recalc_interval)
                except asyncio.TimeoutError:
                    if not store.fixed_as_of:
                        try:
                            await asyncio.to_thread(store.recalculate)
                        except Exception:
                            logger.exception('Scheduled calculation failed; last successful version retained')
        task = asyncio.create_task(tick())
        async def refresh_rates():
            while not stop.is_set():
                await asyncio.to_thread(fx_cache.get)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=60 * 60)
                except asyncio.TimeoutError:
                    pass
        fx_task = asyncio.create_task(refresh_rates()) if not testing else None
        async def refresh_tariffs():
            while not stop.is_set():
                try:
                    await asyncio.to_thread(tariff_catalog.refresh_due)
                except Exception:
                    logger.exception('Tariff catalog refresh failed')
                try:
                    await asyncio.wait_for(stop.wait(), timeout=60 * 60)
                except asyncio.TimeoutError:
                    pass
        tariff_task = asyncio.create_task(refresh_tariffs()) if not testing else None
        yield
        stop.set()
        await task
        if fx_task:
            await fx_task
        if tariff_task:
            await tariff_task
        engine.dispose()

    app = FastAPI(title='Aéza Retention API', version='0.9.0-beta', docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store = store
    if oidc_enabled:
        app.add_middleware(SessionMiddleware, secret_key=oidc_config['OIDC_SESSION_SECRET'],
                           session_cookie='aeza_oidc_flow', max_age=600, same_site='lax', https_only=True)
        oauth = OAuth()
        oauth.register('provider', client_id=oidc_config['OIDC_CLIENT_ID'], client_secret=oidc_config['OIDC_CLIENT_SECRET'],
                       server_metadata_url=oidc_config['OIDC_ISSUER_URL'].rstrip('/') + '/.well-known/openid-configuration',
                       client_kwargs={'scope': 'openid profile email', 'code_challenge_method': 'S256'})

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

    @app.get('/api/v1/competitors/tariffs', tags=['competitors'])
    def competitor_tariffs(_=Depends(authorized)):
        return tariff_catalog.catalog()

    @app.post('/api/v1/auth/login', tags=['auth'])
    def login(body: Login, response: Response, request: Request):
        origin = request.headers.get('origin')
        allowed_origins = {str(request.base_url).rstrip('/')}
        if oidc_enabled:
            callback_url = urlsplit(oidc_config['OIDC_CALLBACK_URL'])
            allowed_origins.add(f'{callback_url.scheme}://{callback_url.netloc}')
        if origin and origin.rstrip('/') not in allowed_origins:
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
        return issue_session(user, response, request, remember_me=body.remember_me)

    def issue_session(user, response, request, remember_me=False):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        lifetime = timedelta(days=30) if remember_me else timedelta(hours=8)
        with engine.begin() as conn:
            conn.execute(delete(db.sessions).where(db.sessions.c.expires < datetime.now(timezone.utc).isoformat()))
            old = request.cookies.get(COOKIE)
            if old:
                conn.execute(delete(db.sessions).where(db.sessions.c.token_hash == hashlib.sha256(old.encode()).hexdigest()))
            conn.execute(insert(db.sessions).values(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user['id'],
                         csrf=csrf, expires=(datetime.now(timezone.utc) + lifetime).isoformat(), remember_me=remember_me))
            now = datetime.now(timezone.utc).isoformat()
            profile = conn.execute(select(db.user_profiles.c.user_id).where(db.user_profiles.c.user_id == user['id'])).first()
            if profile:
                conn.execute(update(db.user_profiles).where(db.user_profiles.c.user_id == user['id']).values(last_login_at=now))
            else:
                conn.execute(insert(db.user_profiles).values(user_id=user['id'], display_name=user['login'],
                                                       updated_at=now, last_login_at=now))
        cookie_options = {'max_age': int(lifetime.total_seconds())} if remember_me else {}
        response.set_cookie(COOKIE, token, httponly=True, secure=secure, samesite='strict', path='/', **cookie_options)
        return {'login': user['login'], 'csrf_token': csrf, 'remember_me': remember_me}

    app.state.dummy_hash = PasswordHasher().hash(secrets.token_urlsafe(24))

    @app.get('/api/v1/auth/methods', tags=['auth'])
    def auth_methods():
        return {'password': True, 'oidc': oidc_enabled}

    if oidc_enabled:
        @app.get('/api/v1/auth/oidc/start', tags=['auth'])
        async def oidc_start(request: Request, remember_me: bool = False):
            request.session.clear()
            request.session['remember_me'] = remember_me
            return await oauth.provider.authorize_redirect(request, oidc_config['OIDC_CALLBACK_URL'])

        @app.get('/api/v1/auth/oidc/callback', tags=['auth'])
        async def oidc_callback(request: Request):
            try:
                token = await oauth.provider.authorize_access_token(request)
                # Authlib populates userinfo only after validating the signed ID token,
                # including issuer, audience, expiry and the nonce from this login flow.
                claims = token.get('userinfo') or {}
                if not token.get('id_token'):
                    raise ValueError('OIDC ID token is missing')
                if claims.get('iss') != oidc_config['OIDC_ISSUER_URL']:
                    raise ValueError('OIDC issuer mismatch')
                audience = claims.get('aud', [])
                if isinstance(audience, str):
                    audience = [audience]
                if oidc_config['OIDC_CLIENT_ID'] not in audience:
                    raise ValueError('OIDC audience mismatch')
                if claims.get('azp') and claims['azp'] != oidc_config['OIDC_CLIENT_ID']:
                    raise ValueError('OIDC authorized party mismatch')
                subject = claims.get('sub')
                if not subject or subject not in allowed_subs:
                    logger.warning('OIDC sign-in rejected: subject is not authorized')
                    return RedirectResponse('/?auth_error=oidc_unauthorized', status_code=303)
                with engine.connect() as conn:
                    user = conn.execute(select(db.users).order_by(db.users.c.id).limit(1)).mappings().first()
                if user is None:
                    raise ValueError('Local administrator is unavailable')
                response = RedirectResponse('/?oidc_login=success', status_code=303)
                issue_session(user, response, request, remember_me=request.session.get('remember_me', False))
                return response
            except Exception as exc:
                logger.warning('OIDC sign-in failed: %s', type(exc).__name__)
                return RedirectResponse('/?auth_error=oidc_failed', status_code=303)
            finally:
                request.session.clear()

    @app.get('/api/v1/auth/me', tags=['auth'])
    def me(user=Depends(authorized)):
        return {'login': user['login'], 'csrf_token': user['csrf'], 'remember_me': user['remember_me']}

    def account_info(session):
        with engine.connect() as conn:
            profile = conn.execute(select(db.user_profiles).where(db.user_profiles.c.user_id == session['user_id'])).mappings().first()
            login_name = conn.execute(select(db.users.c.login).where(db.users.c.id == session['user_id'])).scalar_one()
            active_sessions = conn.execute(select(func.count()).select_from(db.sessions).where(
                db.sessions.c.user_id == session['user_id'],
                db.sessions.c.expires > datetime.now(timezone.utc).isoformat())).scalar_one()
        return {'id': session['user_id'], 'login': login_name,
                'display_name': profile['display_name'] if profile else login_name,
                'email': profile['email'] if profile else '',
                'profile_updated_at': profile['updated_at'] if profile else None,
                'last_login_at': profile['last_login_at'] if profile else None,
                'password_changed_at': profile['password_changed_at'] if profile else None,
                'session_expires_at': session['expires'], 'remember_me': session['remember_me'], 'active_sessions': active_sessions,
                'oidc_available': oidc_enabled}

    @app.get('/api/v1/account', tags=['account'])
    def account(session=Depends(authorized)):
        return account_info(session)

    @app.put('/api/v1/account/profile', tags=['account'])
    def save_profile(body: ProfileUpdate, session=Depends(authorized)):
        name = body.display_name.strip()
        if not name:
            raise HTTPException(422, 'Имя не может быть пустым')
        with engine.begin() as conn:
            current = conn.execute(select(db.users).where(db.users.c.id == session['user_id'])).mappings().one()
            if body.login != current['login']:
                try:
                    PasswordHasher().verify(current['password_hash'], body.current_password or '')
                except (VerificationError, InvalidHashError):
                    raise HTTPException(403, 'Для смены логина укажите текущий пароль')
                try:
                    conn.execute(update(db.users).where(db.users.c.id == session['user_id']).values(login=body.login))
                except IntegrityError:
                    raise HTTPException(409, 'Логин уже занят')
            now = datetime.now(timezone.utc).isoformat()
            existing = conn.execute(select(db.user_profiles.c.user_id).where(db.user_profiles.c.user_id == session['user_id'])).first()
            values = {'display_name': name, 'email': body.email, 'updated_at': now}
            if existing:
                conn.execute(update(db.user_profiles).where(db.user_profiles.c.user_id == session['user_id']).values(**values))
            else:
                conn.execute(insert(db.user_profiles).values(user_id=session['user_id'], **values))
        return account_info(session)

    @app.post('/api/v1/account/password', tags=['account'])
    def change_password(body: PasswordChange, session=Depends(authorized)):
        with engine.begin() as conn:
            current_hash = conn.execute(select(db.users.c.password_hash).where(db.users.c.id == session['user_id'])).scalar_one()
            try:
                PasswordHasher().verify(current_hash, body.current_password)
            except (VerificationError, InvalidHashError):
                raise HTTPException(403, 'Текущий пароль неверен')
            if body.current_password == body.new_password:
                raise HTTPException(422, 'Новый пароль должен отличаться от текущего')
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(update(db.users).where(db.users.c.id == session['user_id']).values(password_hash=PasswordHasher().hash(body.new_password)))
            conn.execute(update(db.user_profiles).where(db.user_profiles.c.user_id == session['user_id']).values(password_changed_at=now))
            conn.execute(delete(db.sessions).where(db.sessions.c.user_id == session['user_id'],
                                                   db.sessions.c.token_hash != session['token_hash']))
        return {'ok': True, 'other_sessions_revoked': True}

    @app.post('/api/v1/account/sessions/revoke', tags=['account'])
    def revoke_other_sessions(session=Depends(authorized)):
        with engine.begin() as conn:
            result = conn.execute(delete(db.sessions).where(db.sessions.c.user_id == session['user_id'],
                                                           db.sessions.c.token_hash != session['token_hash']))
        return {'revoked': result.rowcount}

    @app.post('/api/v1/auth/logout', tags=['auth'])
    def logout(response: Response, user=Depends(authorized)):
        with engine.begin() as conn:
            conn.execute(delete(db.sessions).where(db.sessions.c.token_hash == user['token_hash']))
        response.delete_cookie(COOKIE, path='/')
        return {'ok': True}

    @app.get('/api/v1/fx/rates', dependencies=[Depends(authorized)], tags=['currency'])
    def fx_rates():
        return fx_cache.get()

    @app.post('/api/v1/customers', status_code=201, dependencies=[Depends(authorized)], tags=['customers'])
    def create_customer(body: CustomerCreate):
        try:
            return store.add_customer(body.email, body.balance_cents, body.expected_source_version, body.phone)
        except Conflict as exc:
            raise HTTPException(409, str(exc)) from exc

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

    @app.get('/api/v1/analytics/quality', dependencies=[Depends(authorized)], tags=['analytics'])
    def quality_report():
        return store.quality_report()

    @app.get('/api/v1/analytics/history', dependencies=[Depends(authorized)], tags=['analytics'])
    def history(limit: int = Query(30, ge=1, le=100)):
        return {'snapshots': store.history(limit), 'definition': 'Факт удаления — переход статуса услуги в deleted между загруженными снимками'}

    @app.post('/api/v1/customers/{customer_id}/simulate', dependencies=[Depends(authorized)], tags=['customers'])
    def simulate(customer_id: int, body: ScenarioRequest):
        try:
            return store.simulate(customer_id, body.balance_cents, body.service_id, body.auto_prolong)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.get('/api/v1/actions', dependencies=[Depends(authorized)], tags=['actions'])
    def actions():
        return {'items': store.actions()}

    @app.get('/api/v1/actions/outcomes', dependencies=[Depends(authorized)], tags=['actions'])
    def action_outcomes():
        return store.action_outcomes()

    @app.put('/api/v1/actions/{customer_id}', dependencies=[Depends(authorized)], tags=['actions'])
    def save_action(customer_id: int, body: ActionRequest):
        try:
            return store.save_action(customer_id, body.status, body.note, body.outcome, body.expected_version,
                body.assignee.strip() or None if body.assignee is not None else None,
                body.next_contact_at.isoformat() if body.next_contact_at else None,
                bool({'assignee', 'next_contact_at'} & body.model_fields_set))
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ActionConflict as exc:
            raise HTTPException(409, {'message': str(exc), 'current': exc.current}) from exc
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    @app.post('/api/v1/actions/{customer_id}/contacts', dependencies=[Depends(authorized)], tags=['actions'])
    def record_contact(customer_id: int, body: ContactRequest):
        try:
            return store.record_contact(customer_id, body.channel, body.note.strip(), body.expected_version,
                body.next_contact_at.isoformat() if body.next_contact_at else None)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        except ActionConflict as exc:
            raise HTTPException(409, {'message': str(exc), 'current': exc.current}) from exc

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
