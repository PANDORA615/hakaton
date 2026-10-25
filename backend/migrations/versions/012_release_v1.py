"""Add employee roles, action authors and confirmed retained amounts."""
from alembic import op
from sqlalchemy import Boolean, BigInteger, Column, ForeignKey, Integer, String, inspect, text

revision = '012_release_v1'
down_revision = '011_account_activity'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {column['name'] for column in inspect(bind).get_columns('users')}
    if 'role' not in columns:
        op.add_column('users', Column('role', String(16), nullable=False, server_default=text("'admin'")))
    if 'is_active' not in columns:
        op.add_column('users', Column('is_active', Boolean, nullable=False, server_default=text('true')))
    columns = {column['name'] for column in inspect(bind).get_columns('marketing_actions')}
    if 'updated_by_user_id' not in columns:
        op.add_column('marketing_actions', Column('updated_by_user_id', Integer, ForeignKey('users.id', ondelete='SET NULL')))
    if 'retained_amount_cents' not in columns:
        op.add_column('marketing_actions', Column('retained_amount_cents', BigInteger))
    columns = {column['name'] for column in inspect(bind).get_columns('marketing_contacts')}
    if 'created_by_user_id' not in columns:
        op.add_column('marketing_contacts', Column('created_by_user_id', Integer, ForeignKey('users.id', ondelete='SET NULL')))


def downgrade():
    for table, names in [('marketing_contacts', ['created_by_user_id']),
                         ('marketing_actions', ['retained_amount_cents', 'updated_by_user_id']),
                         ('users', ['is_active', 'role'])]:
        columns = {column['name'] for column in inspect(op.get_bind()).get_columns(table)}
        for name in names:
            if name in columns:
                op.drop_column(table, name)
