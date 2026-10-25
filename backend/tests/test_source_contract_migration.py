"""Upgrade a database with the pre-007 source constraints without losing rows."""
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, insert, text

from app import db


def test_upgrade_old_sqlite_source_contract(tmp_path):
    database = tmp_path / 'legacy.db'
    url = f'sqlite:///{database}'
    engine = db.make_engine(url)
    db.metadata.create_all(engine)
    created = datetime(2026, 10, 1, tzinfo=timezone.utc)
    expires = datetime(2026, 11, 1, tzinfo=timezone.utc)
    with engine.begin() as conn:
        conn.execute(insert(db.accounts).values(id=1, email='client@example.test', balance=0,
                    withdrawBalance=0, totalReplenished=0, bonusBalance=0, bonusState='locked'))
        conn.execute(insert(db.services).values(id=1, name='legacy-service', ownerId=1,
                    paymentTerm='month', autoProlong=False, createdAt=created,
                    expiresAt=expires, status='active', price=5000))
        conn.execute(insert(db.transactions).values(id=1, amount=1000, status='not_performed',
                    createdAt=created, type='order', serviceId=1))
        conn.execute(text('CREATE TABLE transactions_old (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL '
                          'CHECK (amount BETWEEN 0 AND 1000), status TEXT NOT NULL, performedAt DATETIME, '
                          'createdAt DATETIME NOT NULL, type TEXT NOT NULL CHECK (type IN (\'order\',\'prolong\')), '
                          'serviceId BIGINT NOT NULL REFERENCES services(id), '
                          'CHECK ((status=\'not_performed\' AND performedAt IS NULL) OR '
                          '(status=\'performed\' AND performedAt IS NOT NULL AND performedAt >= createdAt)))'))
        conn.execute(text('INSERT INTO transactions_old SELECT id, amount, status, performedAt, createdAt, type, serviceId FROM transactions'))
        conn.execute(text('DROP TABLE transactions'))
        conn.execute(text('ALTER TABLE transactions_old RENAME TO transactions'))
        conn.execute(text('CREATE INDEX transactions_service_id_idx ON transactions (serviceId)'))
        conn.execute(text('CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY)'))
        conn.execute(text("INSERT INTO alembic_version VALUES ('006_action_versions')"))
    engine.dispose()

    backend = Path(__file__).resolve().parents[1]
    result = subprocess.run(['alembic', 'upgrade', 'head'], cwd=backend,
                            env={**os.environ, 'DATABASE_URL': url}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    with create_engine(url).begin() as conn:
        assert conn.scalar(text('SELECT amount FROM transactions WHERE id=1')) == 1000
        conn.execute(text("INSERT INTO transactions(id,amount,status,createdAt,type,serviceId) "
                          "VALUES (2,2500000000,'not_performed','2026-10-02T00:00:00Z','order',1)"))
        assert conn.scalar(text('SELECT version_num FROM alembic_version')) == '011_account_activity'
        assert conn.scalar(text("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='marketing_contacts'")) == 1
        assert conn.scalar(text('SELECT phone FROM accounts WHERE id=1')) is None
        assert conn.scalar(text('SELECT count(*) FROM transactions')) == 2
