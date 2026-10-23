import json
import threading
import time
from datetime import datetime, timezone
from sqlalchemy import select, insert, delete, update, text, func
from . import db
from .schemas import Snapshot, Settings
from .scoring import calculate, CALCULATION_SCHEMA_VERSION


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
        else:
            current = self.current()
            if not current or current.get('schema_version') != CALCULATION_SCHEMA_VERSION:
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

    def history(self, limit=30):
        with self.engine.connect() as conn:
            rows = conn.execute(select(db.snapshots).order_by(db.snapshots.c.id.desc()).limit(limit + 1)).mappings().all()
        rows = list(reversed(rows))
        result = []
        previous = None
        for row in rows:
            services = {service['id']: service for service in row['payload']['services']}
            transitions = []
            if previous is not None:
                for service_id, service in services.items():
                    old = previous.get(service_id)
                    if old and old['status'] != service['status']:
                        transitions.append({'service_id': service_id, 'customer_id': service['ownerId'],
                                            'name': service['name'], 'from_status': old['status'], 'to_status': service['status']})
            result.append({'source_version': row['id'], 'imported_at': row['imported_at'],
                           'service_count': len(services), 'transitions': transitions,
                           'deleted_count': sum(item['to_status'] == 'deleted' for item in transitions)})
            previous = services
        return list(reversed(result[-limit:]))

    def simulate(self, customer_id, balance_cents=None, service_id=None, auto_prolong=None):
        with self.lock, self.engine.connect() as conn:
            current = self.latest(conn, db.runs)
            source = Snapshot.model_validate(self.latest(conn, db.snapshots)['payload'])
            settings = Settings.model_validate(self.latest(conn, db.settings_versions)['payload'])
            account = next((account for account in source.accounts if account.id == customer_id), None)
            if account is None:
                raise LookupError('Клиент не найден')
            if balance_cents is not None:
                account.balance = balance_cents
            if service_id is not None:
                service = next((service for service in source.services if service.id == service_id and service.ownerId == customer_id), None)
                if service is None:
                    raise LookupError('Услуга клиента не найдена')
                service.autoProlong = auto_prolong
            before = next(customer for customer in current['payload']['customers'] if customer['id'] == customer_id)
            scenario = calculate(source, settings, datetime.fromisoformat(current['as_of']))
            after = next(customer for customer in scenario['customers'] if customer['id'] == customer_id)
            return {'before': before, 'after': after, 'as_of': current['as_of'],
                    'calculation_version': current['id'], 'saved': False}

    def actions(self):
        current = self.current()
        customers = {customer['id']: customer for customer in current['customers']}
        with self.engine.connect() as conn:
            rows = conn.execute(select(db.marketing_actions).order_by(db.marketing_actions.c.updated_at.desc())).mappings().all()
        return [{**dict(row), 'customer': customers.get(row['customer_id'])} for row in rows]

    def save_action(self, customer_id, status, note):
        customer_exists = any(customer['id'] == customer_id for customer in self.current()['customers'])
        with self.lock, self.engine.begin() as conn:
            existing = conn.execute(select(db.marketing_actions.c.id).where(db.marketing_actions.c.customer_id == customer_id)).scalar_one_or_none()
            if existing is None and not customer_exists:
                raise LookupError('Клиент не найден')
            values = {'status': status, 'note': note, 'updated_at': datetime.now(timezone.utc).isoformat()}
            if existing is None:
                conn.execute(insert(db.marketing_actions).values(customer_id=customer_id, **values))
            else:
                conn.execute(update(db.marketing_actions).where(db.marketing_actions.c.id == existing).values(**values))
        return next(action for action in self.actions() if action['customer_id'] == customer_id)
