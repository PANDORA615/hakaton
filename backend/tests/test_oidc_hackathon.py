"""Self-contained OIDC protocol smoke test; no external provider is contacted."""
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from authlib.jose import JsonWebKey, jwt
from authlib.integrations.starlette_client import OAuth
from fastapi.testclient import TestClient

from app import main as main_module
from app.main import create_app

DATA_PATH = Path(__file__).resolve().parents[2] / 'data/original/data.json'
NOW = datetime(2026, 10, 19, 15, tzinfo=timezone.utc)
PASSWORD = 'test-only-password-2841'


def test_hackathon_oidc_signed_token_and_replay(tmp_path, monkeypatch):
    issuer = 'https://identity.example'
    client_id = 'hackathon-demo'
    captured = {}

    class CapturingOAuth(OAuth):
        def register(self, *args, **kwargs):
            provider = super().register(*args, **kwargs)
            captured['provider'] = provider
            return provider

    monkeypatch.setattr(main_module, 'OAuth', CapturingOAuth)
    for name, value in {
        'OIDC_ISSUER_URL': issuer,
        'OIDC_CLIENT_ID': client_id,
        'OIDC_CLIENT_SECRET': 'test-only-client-secret',
        'OIDC_CALLBACK_URL': 'https://app.example/api/v1/auth/oidc/callback',
        'OIDC_ALLOWED_SUB': 'approved-subject',
        'OIDC_SESSION_SECRET': 'test-only-oidc-session-secret-over-32-characters',
    }.items():
        monkeypatch.setenv(name, value)
    app = create_app(f'sqlite:///{tmp_path}/oidc-hackathon.db', str(DATA_PATH), PASSWORD, NOW, testing=True)
    provider = captured['provider']
    key = JsonWebKey.generate_key('RSA', 2048, options={'kid': 'hackathon-test-key'}, is_private=True)

    async def metadata():
        return {
            'issuer': issuer,
            'authorization_endpoint': issuer + '/authorize',
            'token_endpoint': issuer + '/token',
            'jwks_uri': issuer + '/jwks',
            'id_token_signing_alg_values_supported': ['RS256'],
        }

    async def jwks(force=False):
        return {'keys': [key.as_dict(is_private=False)]}

    original_redirect = provider.authorize_redirect

    async def authorize_redirect(request, redirect_uri):
        response = await original_redirect(request, redirect_uri)
        for name, value in request.session.items():
            if name.startswith('_state_provider_'):
                captured['nonce'] = value['data']['nonce']
        return response

    async def access_token(**params):
        assert params.get('code_verifier'), 'PKCE verifier must survive the redirect'
        now = int(time.time())
        claims = {'iss': issuer, 'aud': client_id, 'sub': captured.get('subject', 'approved-subject'),
                  'iat': now, 'exp': now + 300, 'nonce': captured['nonce']}
        if captured.get('bad_nonce'):
            claims['nonce'] = 'wrong-nonce'
        encoded = jwt.encode({'alg': 'RS256', 'kid': key.kid}, claims, key).decode()
        return {'id_token': encoded, 'access_token': 'test-access-token', 'token_type': 'Bearer'}

    monkeypatch.setattr(provider, 'load_server_metadata', metadata)
    monkeypatch.setattr(provider, 'fetch_jwk_set', jwks)
    monkeypatch.setattr(provider, 'authorize_redirect', authorize_redirect)
    monkeypatch.setattr(provider, 'fetch_access_token', access_token)

    with TestClient(app, base_url='https://app.example') as browser:
        def start():
            response = browser.get('/api/v1/auth/oidc/start', follow_redirects=False)
            assert response.status_code == 302
            query = parse_qs(urlsplit(response.headers['location']).query)
            assert query['code_challenge_method'] == ['S256']
            assert query.get('code_challenge')
            assert query.get('nonce')
            assert query.get('state')
            return query['state'][0]

        state = start()
        callback = browser.get(f'/api/v1/auth/oidc/callback?code=demo-code&state={state}', follow_redirects=False)
        assert callback.status_code == 303
        assert callback.headers['location'] == '/?oidc_login=success'
        assert browser.get('/api/v1/auth/me').json()['login'] == 'admin'
        replay = browser.get(f'/api/v1/auth/oidc/callback?code=demo-code&state={state}', follow_redirects=False)
        assert 'auth_error=oidc_failed' in replay.headers['location']

        browser.post('/api/v1/auth/logout', headers={'X-CSRF-Token': browser.get('/api/v1/auth/me').json()['csrf_token']})
        captured['bad_nonce'] = True
        state = start()
        invalid = browser.get(f'/api/v1/auth/oidc/callback?code=demo-code&state={state}', follow_redirects=False)
        assert 'auth_error=oidc_failed' in invalid.headers['location']
        assert browser.get('/api/v1/auth/me').status_code == 401
