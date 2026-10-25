"""Add ownership, follow-up reminders and immutable contact history."""
from alembic import op
from sqlalchemy import Column, String, inspect
from app.db import marketing_contacts

revision = '010_contact_followups'
down_revision = '009_competitor_tariffs'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    columns = {column['name'] for column in inspect(bind).get_columns('marketing_actions')}
    if 'assignee' not in columns:
        op.add_column('marketing_actions', Column('assignee', String(80)))
    if 'next_contact_at' not in columns:
        op.add_column('marketing_actions', Column('next_contact_at', String))
    if not inspect(bind).has_table('marketing_contacts'):
        marketing_contacts.create(bind)


def downgrade():
    bind = op.get_bind()
    marketing_contacts.drop(bind, checkfirst=True)
    columns = {column['name'] for column in inspect(bind).get_columns('marketing_actions')}
    if 'next_contact_at' in columns:
        op.drop_column('marketing_actions', 'next_contact_at')
    if 'assignee' in columns:
        op.drop_column('marketing_actions', 'assignee')
