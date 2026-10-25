from sqlalchemy import (MetaData, Table, Column, BigInteger, Integer, String, Text, Boolean, DateTime, JSON,
                        ForeignKey, CheckConstraint, Identity, Index, create_engine, event, text)

metadata = MetaData()
ID_TYPE = BigInteger().with_variant(Integer, 'sqlite')
accounts = Table('accounts', metadata,
    Column('id', ID_TYPE, Identity(), primary_key=True), Column('email', Text, nullable=False, unique=True),
    Column('phone', String(16)),
    *[Column(k, BigInteger, nullable=False, default=0, server_default=text('0')) for k in ('balance', 'withdrawBalance', 'totalReplenished', 'bonusBalance')],
    Column('bonusState', Text, nullable=False, default='locked', server_default=text("'locked'")),
    *[CheckConstraint(f'"{k}" >= 0') for k in ('balance', 'withdrawBalance', 'totalReplenished', 'bonusBalance')],
    CheckConstraint("\"bonusState\" IN ('locked', 'unlocked')"))
services = Table('services', metadata,
    Column('id', ID_TYPE, Identity(), primary_key=True), Column('name', Text, nullable=False),
    Column('ownerId', BigInteger, ForeignKey('accounts.id', ondelete='RESTRICT', onupdate='RESTRICT'), nullable=False),
    Column('paymentTerm', Text, nullable=False), Column('autoProlong', Boolean, nullable=False, default=False, server_default=text('false')),
    Column('createdAt', DateTime(timezone=True), nullable=False, server_default=text('CURRENT_TIMESTAMP')), Column('expiresAt', DateTime(timezone=True), nullable=False),
    Column('status', Text, nullable=False), Column('price', BigInteger, nullable=False),
    CheckConstraint('price >= 0'), CheckConstraint('"expiresAt" >= "createdAt"'),
    CheckConstraint("\"paymentTerm\" IN ('hour','week','month','quarter_year','half_year','year')"),
    CheckConstraint("status IN ('active','blocked','deleted','suspended','prolong_wait')"))
Index('services_owner_id_idx', services.c.ownerId)
transactions = Table('transactions', metadata,
    Column('id', ID_TYPE, Identity(), primary_key=True), Column('amount', BigInteger, nullable=False),
    Column('status', Text, nullable=False, default='not_performed', server_default=text("'not_performed'")),
    Column('performedAt', DateTime(timezone=True)), Column('createdAt', DateTime(timezone=True), nullable=False, server_default=text('CURRENT_TIMESTAMP')),
    Column('type', Text, nullable=False),
    Column('serviceId', BigInteger, ForeignKey('services.id', ondelete='RESTRICT', onupdate='RESTRICT'), nullable=False),
    CheckConstraint('amount >= 0', name='transactions_amount_nonnegative'), CheckConstraint("type IN ('order','prolong')"),
    CheckConstraint("(status='not_performed' AND \"performedAt\" IS NULL) OR (status='performed' AND \"performedAt\" IS NOT NULL AND \"performedAt\" >= \"createdAt\")"))
Index('transactions_service_id_idx', transactions.c.serviceId)
snapshots = Table('source_snapshots', metadata, Column('id', Integer, primary_key=True), Column('payload', JSON, nullable=False), Column('imported_at', String, nullable=False))
settings_versions = Table('model_settings_versions', metadata, Column('id', Integer, primary_key=True), Column('payload', JSON, nullable=False))
runs = Table('calculation_runs', metadata, Column('id', Integer, primary_key=True), Column('source_version', Integer, nullable=False),
             Column('settings_version', Integer, nullable=False), Column('as_of', String, nullable=False), Column('payload', JSON, nullable=False), Column('duration', String, nullable=False))
users = Table('users', metadata, Column('id', Integer, primary_key=True), Column('login', String, unique=True, nullable=False), Column('password_hash', Text, nullable=False))
user_profiles = Table('user_profiles', metadata,
    Column('user_id', Integer, ForeignKey('users.id', ondelete='CASCADE'), primary_key=True),
    Column('display_name', String(80), nullable=False, server_default=text("''")),
    Column('email', String(254), nullable=False, server_default=text("''")),
    Column('updated_at', String, nullable=False),
    Column('last_login_at', String),
    Column('password_changed_at', String))
sessions = Table('sessions', metadata, Column('token_hash', String, primary_key=True), Column('user_id', Integer, ForeignKey('users.id'), nullable=False),
                 Column('csrf', String, nullable=False), Column('expires', String, nullable=False),
                 Column('remember_me', Boolean, nullable=False, server_default=text('false')))
competitor_tariffs = Table('competitor_tariffs', metadata,
    Column('provider', String(40), primary_key=True), Column('plans', JSON, nullable=False),
    Column('fetched_at', String), Column('attempted_at', String), Column('error', Text))
marketing_actions = Table('marketing_actions', metadata,
    Column('id', ID_TYPE, Identity(), primary_key=True),
    Column('customer_id', BigInteger, nullable=False, unique=True),
    Column('status', String, nullable=False),
    Column('note', Text, nullable=False, server_default=text("''")),
    Column('outcome', String, nullable=False, server_default=text("'pending'")),
    Column('outcome_recorded_at', String),
    Column('assignee', String(80)),
    Column('next_contact_at', String),
    Column('version', Integer, nullable=False, server_default=text('1')),
    Column('updated_at', String, nullable=False),
    CheckConstraint("status IN ('open','contacted','resolved')"))
marketing_contacts = Table('marketing_contacts', metadata,
    Column('id', ID_TYPE, Identity(), primary_key=True),
    Column('action_id', Integer, nullable=False),
    Column('channel', String(16), nullable=False),
    Column('note', Text, nullable=False),
    Column('contacted_at', String, nullable=False),
    CheckConstraint("channel IN ('call','email','chat','other')"))


def make_engine(url):
    options = {'connect_args': {'check_same_thread': False}} if url.startswith('sqlite') else {}
    engine = create_engine(url, **options)
    if url.startswith('sqlite'):
        @event.listens_for(engine, 'connect')
        def fk(dbapi_connection, _):
            dbapi_connection.execute('PRAGMA foreign_keys=ON')
    return engine
