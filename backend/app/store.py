import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from sqlalchemy import select, insert, delete, update, text, func
from sqlalchemy.exc import IntegrityError
from . import db
from .schemas import Snapshot, Settings, Account
from .scoring import calculate, CALCULATION_SCHEMA_VERSION


class Conflict(Exception):
    pass


class ActionConflict(Conflict):
    def __init__(self, current=None):
        super().__init__('Контакт изменён в другой вкладке. Сравните данные и повторите сохранение.')
        self.current = dict(current) if current else None


class Store:
    def __init__(self, engine, fixed_as_of=None):
        self.engine, self.fixed_as_of = engine, fixed_as_of
        self.lock = threading.RLock()
        self.failures = 0
        self.run_limit = self._limit('RETENTION_RUN_LIMIT', 200)
        self.snapshot_limit = self._limit('RETENTION_SNAPSHOT_LIMIT', 100)

    @staticmethod
    def _limit(name, default):
        raw = os.environ.get(name, str(default))
        try:
            value = int(raw)
        except ValueError as exc:
            raise ValueError(f'{name} must be an integer of at least 2') from exc
        if value < 2:
            raise ValueError(f'{name} must be an integer of at least 2')
        return value

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
            payload = snapshot.model_dump(mode='json')
            for account in payload['accounts']:
                if account['phone'] is None:
                    del account['phone']
            conn.execute(insert(db.snapshots).values(payload=payload, imported_at=datetime.now(timezone.utc).isoformat()))
            self._calculate(conn)
        self.prune_history()
        return self.current()

    def add_customer(self, email, balance_cents, expected_source_version, phone=None):
        with self.lock:
            with self.engine.connect() as conn:
                latest = self.latest(conn, db.snapshots)
            if latest['id'] != expected_source_version:
                raise Conflict('Реестр изменился. Обновите страницу и повторите добавление.')
            source = Snapshot.model_validate(latest['payload'])
            email = email.strip().lower()
            if any(account.email.lower() == email for account in source.accounts):
                raise Conflict('Клиент с таким email уже есть в реестре.')
            customer_id = max((account.id for account in source.accounts), default=0) + 1
            account = Account(id=customer_id, email=email, phone=phone, balance=balance_cents,
                              withdrawBalance=0, totalReplenished=0,
                              bonusBalance=0, bonusState='locked')
            source.accounts.append(account)
            result = self.replace_snapshot(source)
            return {'id': customer_id, 'source_version': result['source_version'],
                    'calculation_version': result['calculation_version']}

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
        self.prune_history()
        return self.current()

    def recalculate(self):
        try:
            with self.lock, self.engine.begin() as conn:
                self._calculate(conn)
            self.prune_history()
        except Exception:
            self.failures += 1
            raise

    def prune_history(self):
        # Cleanup uses a separate transaction; a failure cannot roll back a published calculation.
        try:
            with self.lock, self.engine.begin() as conn:
                recent_run_ids = set(conn.scalars(select(db.runs.c.id).order_by(db.runs.c.id.desc()).limit(self.run_limit)))
                old_run_ids = list(conn.scalars(select(db.runs.c.id).where(db.runs.c.id.not_in(recent_run_ids)).order_by(db.runs.c.id).limit(100)))
                if old_run_ids:
                    conn.execute(delete(db.runs).where(db.runs.c.id.in_(old_run_ids)))
                references = conn.execute(select(db.runs.c.source_version, db.runs.c.settings_version)).all()
                needed_sources = {row.source_version for row in references}
                needed_settings = {row.settings_version for row in references}
                # Keep one predecessor for the first visible transition in history().
                needed_sources.update(conn.scalars(select(db.snapshots.c.id).order_by(db.snapshots.c.id.desc()).limit(self.snapshot_limit + 1)))
                latest_setting = conn.scalar(select(db.settings_versions.c.id).order_by(db.settings_versions.c.id.desc()).limit(1))
                if latest_setting is not None:
                    needed_settings.add(latest_setting)
                old_sources = list(conn.scalars(select(db.snapshots.c.id).where(db.snapshots.c.id.not_in(needed_sources)).order_by(db.snapshots.c.id).limit(100)))
                if old_sources:
                    conn.execute(delete(db.snapshots).where(db.snapshots.c.id.in_(old_sources)))
                old_settings = list(conn.scalars(select(db.settings_versions.c.id).where(db.settings_versions.c.id.not_in(needed_settings)).order_by(db.settings_versions.c.id).limit(100)))
                if old_settings:
                    conn.execute(delete(db.settings_versions).where(db.settings_versions.c.id.in_(old_settings)))
        except Exception:
            logging.getLogger(__name__).exception('History cleanup failed; published calculation is retained')

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
        limit = min(limit, self.snapshot_limit)
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
                    'calculation_version': current['id'], 'source_version': current['source_version'],
                    'settings_version': current['settings_version'], 'saved': False}

    def actions(self):
        current = self.current()
        customers = {customer['id']: customer for customer in current['customers']}
        with self.engine.connect() as conn:
            rows = conn.execute(select(db.marketing_actions).order_by(db.marketing_actions.c.id.asc())).mappings().all()
        return [{**dict(row), 'customer': customers.get(row['customer_id'])} for row in rows]

    def action_outcomes(self):
        items = self.actions()
        renewed = sum(item['outcome'] == 'renewed' for item in items)
        not_renewed = sum(item['outcome'] == 'not_renewed' for item in items)
        known = renewed + not_renewed
        return {'renewed': renewed, 'not_renewed': not_renewed,
                'pending': len(items) - known, 'known_total': known,
                'renewal_share_pct': round(100 * renewed / known, 1) if known else None,
                'items': [item for item in items if item['outcome'] != 'pending']}

    def save_action(self, customer_id, status, note, outcome=None, expected_version=None):
        default_create = status == 'open' and note == '' and outcome in (None, 'pending')
        with self.lock:
            customer_exists = any(customer['id'] == customer_id for customer in self.current()['customers'])
            try:
                with self.engine.begin() as conn:
                    existing = conn.execute(select(db.marketing_actions).where(db.marketing_actions.c.customer_id == customer_id)).mappings().first()
                    if existing is None and not customer_exists:
                        raise LookupError('Клиент не найден')
                    if existing is not None and default_create and expected_version in (None, 0):
                        pass  # Idempotent add-to-work; preserve any existing changes.
                    elif existing is not None:
                        if expected_version != existing['version']:
                            raise ActionConflict(existing)
                        now = datetime.now(timezone.utc).isoformat()
                        chosen_outcome = outcome if outcome is not None else existing['outcome']
                        if chosen_outcome != 'pending' and status == 'open':
                            raise ValueError('Сначала отметьте контакт с клиентом')
                        recorded_at = existing['outcome_recorded_at'] if chosen_outcome == existing['outcome'] else (now if chosen_outcome != 'pending' else None)
                        result = conn.execute(update(db.marketing_actions).where(
                            db.marketing_actions.c.id == existing['id'],
                            db.marketing_actions.c.version == expected_version).values(
                                status=status, note=note, outcome=chosen_outcome, outcome_recorded_at=recorded_at,
                                updated_at=now, version=expected_version + 1))
                        if result.rowcount != 1:
                            raise ActionConflict(existing)
                    else:
                        if expected_version not in (None, 0):
                            raise ActionConflict()
                        chosen_outcome = outcome or 'pending'
                        if chosen_outcome != 'pending' and status == 'open':
                            raise ValueError('Сначала отметьте контакт с клиентом')
                        now = datetime.now(timezone.utc).isoformat()
                        conn.execute(insert(db.marketing_actions).values(customer_id=customer_id, status=status,
                            note=note, outcome=chosen_outcome, outcome_recorded_at=now if chosen_outcome != 'pending' else None,
                            updated_at=now, version=1))
            except IntegrityError as exc:
                if not default_create:
                    with self.engine.connect() as conn:
                        current = conn.execute(select(db.marketing_actions).where(
                            db.marketing_actions.c.customer_id == customer_id)).mappings().first()
                    raise ActionConflict(current) from exc
            return next(action for action in self.actions() if action['customer_id'] == customer_id)
