import asyncio
import json
from starlette.requests import Request
from test_app import sign_in, client, app


def test_sse_reports_new_version_and_closes_on_logout(client, app):
    headers = sign_in(client)
    cookie = client.cookies.get('aeza_session')

    async def receive():
        await asyncio.sleep(0)
        return {'type':'http.request','body':b''}

    request = Request({'type':'http','method':'GET','path':'/api/v1/events','headers':[(b'cookie', ('aeza_session='+cookie).encode())],
                       'query_string':b'', 'client':('127.0.0.1',1234), 'server':('testserver',80),'scheme':'http'}, receive)
    endpoint = next(r.endpoint for r in app.routes if getattr(r,'path',None)=='/api/v1/events')

    async def scenario():
        response = await endpoint(request, user={'login':'admin'})
        stream = response.body_iterator
        first = await anext(stream)
        before = json.loads(first.split('data: ')[1].strip())['calculation_version']
        assert 'event: calculation' in first
        app.state.store.update_settings({'horizon_days':8}, None)
        second = await anext(stream)
        after = json.loads(second.split('data: ')[1].strip())['calculation_version']
        assert after > before
        client.post('/api/v1/auth/logout',headers=headers)
        try:
            await anext(stream)
        except StopAsyncIteration:
            return
        raise AssertionError('SSE must stop after session revocation')
    asyncio.run(scenario())
