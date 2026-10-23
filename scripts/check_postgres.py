"""Opt-in integration check. Requires a separate EMPTY test database; never drops tables."""
import os
import sys
import secrets
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy import inspect, select, insert, func
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'backend'))
from app import db
from app.main import create_app
from app.schemas import Snapshot
from fastapi.testclient import TestClient

url = os.environ.get('TEST_DATABASE_URL', '')
if not url:
    raise SystemExit('Set TEST_DATABASE_URL to a separate empty PostgreSQL test database.')
parsed = make_url(url)
if parsed.get_backend_name() != 'postgresql' or 'test' not in (parsed.database or '').lower():
    raise SystemExit('Refusing: PostgreSQL database name must contain test.')
engine = db.make_engine(url)
if inspect(engine).get_table_names():
    raise SystemExit('Refusing: test database must be EMPTY. No tables changed.')
subprocess.run([sys.executable, '-m', 'alembic', 'upgrade', 'head'], cwd=root/'backend', env={**os.environ, 'DATABASE_URL':url}, check=True)
password=secrets.token_urlsafe(24)
app=create_app(url,str(root/'data/original/data.json'),password,datetime(2026,10,19,15,tzinfo=timezone.utc))
with TestClient(app) as client:
    login=client.post('/api/v1/auth/login',json={'login':'admin','password':password})
    assert login.status_code==200
    headers={'X-CSRF-Token':login.json()['csrf_token']}
    source=client.get('/api/v1/source/snapshot').json()
    for _ in range(2):
        assert client.put('/api/v1/source/snapshot',headers=headers,json=source).status_code==200
    with engine.connect() as conn:
        assert [conn.scalar(select(func.count()).select_from(t)) for t in (db.accounts,db.services,db.transactions)]==[10,30,100]
        transaction=conn.begin_nested()
        generated_id=conn.scalar(insert(db.accounts).values(email='sequence-check@example.test', balance=0, withdrawBalance=0,totalReplenished=0,bonusBalance=0,bonusState='locked').returning(db.accounts.c.id))
        assert generated_id>10
        transaction.rollback()
    try:
        with engine.begin() as conn:
            service=Snapshot.model_validate(source).services[0].model_dump()
            service.update(id=999999,ownerId=999999)
            conn.execute(insert(db.services).values(**service))
    except IntegrityError:
        pass
    else:
        raise AssertionError('Foreign key constraint did not reject invalid ownerId')
    assert client.get('/api/v1/analytics/summary').json()['customer_count']==10
engine.dispose()
print('PostgreSQL migration, API import, repeated snapshot, counts, identity and FK checks passed. Test database retained.')
