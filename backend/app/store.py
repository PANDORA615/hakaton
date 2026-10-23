import json
import threading
import time
from datetime import datetime, timezone
from sqlalchemy import select, insert, delete, text, func
from . import db
from .schemas import Snapshot, Settings
from .scoring import calculate


class Conflict(Exception):
    pass


class Store:
    def __init__(self, engine, fixed_as_of=None):
        self.engine, self.fixed_as_of = engine, fixed_as_of
        self.lock = threading.RLock()
        self.failures = 0

    def now(self):
        return self.fixed_as_of or datetime.now(timezone.utc)

    @staticmethod
    def latest(conn, table):
        return conn.execute(select(table).order_by(table.c.id.desc()).limit(1)).mappings().first()

    def initialize(self, path, login, password):
        from argon2 import PasswordHasher
        with self.lock, self.engine.begin() as conn:
            if not conn.execute(select(db.users.c.id).limit(1)).first():
                conn.execute(insert(db.users).values(login=login, password_hash=PasswordHasher().hash(password)))
            if not self.latest(conn, db.settings_versions):
                conn.execute(insert(db.settings_versions).values(payload=Settings().model_dump()))
        with self.engine.connect() as conn:
            has_source = self.latest(conn, db.snapshots)
        if not has_source:
            with open(path, encoding='utf-8') as f:
                self.replace_snapshot(Snapshot.model_validate(json.load(f)))
        elif not self.current():
            self.recalculate()

    def _calculate(self, conn):
        started = time.monotonic()
        source = self.latest(conn, db.snapshots)
        config = self.latest(conn, db.settings_versions)
        now = self.now()
        result = calculate(Snapshot.model_validate(source['payload']), Settings.model_validate(config['payload']), now)
        row_id = conn.execute(insert(db.runs).values(source_version=source['id'], settings_version=config['id'],
                              as_of=now.isoformat(), payload=result, duration=str(time.monotonic() - started)).returning(db.runs.c.id)).scalar_one()
        return row_id

    def replace_snapshot(self, snapshot):
        with self.lock, self.engine.begin() as conn:
            # Delete in FK order. Old results store immutable JSON, not FKs to mutable source rows.
            for table in (db.transactions, db.services, db.accounts):
                conn.execute(delete(table))
            for table, rows in ((db.accounts, snapshot.accounts), (db.services, snapshot.services), (db.transactions, snapshot.transactions)):
                if rows:
                    conn.execute(insert(table), [r.model_dump() for r in rows])
                if self.engine.dialect.name == 'postgresql':
                    conn.execute(text(f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), COALESCE((SELECT max(id) FROM {table.name}), 1), EXISTS(SELECT 1 FROM {table.name}))"))
            conn.execute(insert(db.snapshots).values(payload=snapshot.model_dump(mode='json'), imported_at=datetime.now(timezone.utc).isoformat()))
            self._calculate(conn)
        return self.current()

    def update_settings(self, changes, expected_version):
        with self.lock, self.engine.begin() as conn:
            current = self.latest(conn, db.settings_versions)
            if expected_version is not None and current['id'] != expected_version:
                raise Conflict('Настройки изменены в другой вкладке. Обновите страницу настроек.')
            updated = dict(current['payload'])
            if 'weights' in changes:
                changes = {**changes, 'weights': {**updated['weights'], **changes['weights']}}
            updated.update(changes)
            config = Settings.model_validate(updated)
            conn.execute(insert(db.settings_versions).values(payload=config.model_dump()))
            self._calculate(conn)
        return self.current()

    def recalculate(self):
        try:
            with self.lock, self.engine.begin() as conn:
                self._calculate(conn)
        except Exception:
            self.failures += 1
            raise

    def settings(self):
        from .schemas import FEATURES
        with self.engine.connect() as conn:
            row = self.latest(conn, db.settings_versions)
            return {**row['payload'], 'settings_version': row['id'], 'features': FEATURES}

    def current(self):
        with self.engine.connect() as conn:
            row = self.latest(conn, db.runs)
            if not row:
                return None
            return {**row['payload'], 'calculation_version': row['id'], 'source_version': row['source_version'],
                    'settings_version': row['settings_version'], 'as_of': row['as_of'], 'duration_seconds': float(row['duration']),
                    'time_mode': 'fixed' if self.fixed_as_of else 'live'}

    def source(self):
        with self.engine.connect() as conn:
            return self.latest(conn, db.snapshots)['payload']
