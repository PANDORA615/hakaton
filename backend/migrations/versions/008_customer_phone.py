"""Optional customer callback number."""
from alembic import op
from sqlalchemy import Column, String, inspect

revision = '008_customer_phone'
down_revision = '007_source_contract'
branch_labels = None
depends_on = None


def upgrade():
    # Initial schema uses current metadata, so fresh installs already have the column.
    if 'phone' not in {column['name'] for column in inspect(op.get_bind()).get_columns('accounts')}:
        op.add_column('accounts', Column('phone', String(16), nullable=True))


def downgrade():
    if 'phone' in {column['name'] for column in inspect(op.get_bind()).get_columns('accounts')}:
        op.drop_column('accounts', 'phone')
