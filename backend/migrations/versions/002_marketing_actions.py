"""Add persistent marketing follow-up actions."""
from alembic import op
from sqlalchemy import inspect
from app.db import marketing_actions

revision = '002_marketing_actions'
down_revision = '001_initial'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if not inspect(bind).has_table(marketing_actions.name):
        marketing_actions.create(bind=bind)


def downgrade():
    marketing_actions.drop(bind=op.get_bind(), checkfirst=True)
