"""Accept arbitrary service names and nonnegative transaction amounts."""
from alembic import op
from sqlalchemy import BigInteger, CheckConstraint, Integer, inspect, text

from app.db import transactions

revision = '007_source_contract'
down_revision = '006_action_versions'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = inspect(bind)
    if bind.dialect.name == 'postgresql':
        service_checks = {item['name'] for item in inspector.get_check_constraints('services')}
        if 'services_name_format' in service_checks:
            op.drop_constraint('services_name_format', 'services', type_='check')
        transaction_checks = {item['name'] for item in inspector.get_check_constraints('transactions')}
        if 'transactions_amount_check' in transaction_checks:
            op.drop_constraint('transactions_amount_check', 'transactions', type_='check')
        op.alter_column('transactions', 'amount', existing_type=Integer(), type_=BigInteger())
        if 'transactions_amount_nonnegative' not in transaction_checks:
            op.create_check_constraint('transactions_amount_nonnegative', 'transactions', 'amount >= 0')
    elif bind.dialect.name == 'sqlite':
        old_cap = any('1000' in item['sqltext'] and 'amount' in item['sqltext']
                      for item in inspector.get_check_constraints('transactions'))
        if old_cap:
            # SQLite omits unnamed CHECKs during table recreation. Restate every
            # source constraint from the current model while widening amount.
            checks = [CheckConstraint(str(item.sqltext), name=item.name)
                      for item in transactions.constraints if isinstance(item, CheckConstraint)]
            with op.batch_alter_table('transactions', recreate='always', table_args=checks) as batch:
                batch.alter_column('amount', existing_type=Integer(), type_=BigInteger())
    else:
        raise RuntimeError('Unsupported database for source-contract migration')


def downgrade():
    bind = op.get_bind()
    non_ascii = bind.execute(text("SELECT count(*) FROM services WHERE name !~ '^[A-Za-z0-9-]+$'")) if bind.dialect.name == 'postgresql' else None
    if non_ascii is not None and non_ascii.scalar_one():
        raise RuntimeError('Cannot restore the old name restriction while arbitrary names exist')
    if bind.execute(text('SELECT count(*) FROM transactions WHERE amount > 1000')).scalar_one():
        raise RuntimeError('Cannot restore the old amount limit while larger transactions exist')
    if bind.dialect.name == 'postgresql':
        op.drop_constraint('transactions_amount_nonnegative', 'transactions', type_='check')
        op.alter_column('transactions', 'amount', existing_type=BigInteger(), type_=Integer())
        op.create_check_constraint('transactions_amount_check', 'transactions', 'amount BETWEEN 0 AND 1000')
        op.create_check_constraint('services_name_format', 'services', "name ~ '^[A-Za-z0-9-]+$'")
    else:
        raise RuntimeError('Restore the SQLite database from a pre-migration backup')
