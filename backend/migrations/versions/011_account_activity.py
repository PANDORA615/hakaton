"""Store account activity and session origin."""
from alembic import op
from sqlalchemy import Column, String, inspect
from app.db import account_events

revision = '011_account_activity'
down_revision = '010_contact_followups'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {column['name'] for column in inspect(bind).get_columns('sessions')}
    if 'created_at' not in columns:
        op.add_column('sessions', Column('created_at', String))
    if 'auth_method' not in columns:
        op.add_column('sessions', Column('auth_method', String(16)))
    account_events.create(bind, checkfirst=True)


def downgrade():
    bind = op.get_bind()
    account_events.drop(bind, checkfirst=True)
    columns = {column['name'] for column in inspect(bind).get_columns('sessions')}
    if 'auth_method' in columns:
        op.drop_column('sessions', 'auth_method')
    if 'created_at' in columns:
        op.drop_column('sessions', 'created_at')
