"""Add account profile and security activity."""
from alembic import op
from sqlalchemy import inspect
from app.db import user_profiles

revision = '003_user_profiles'
down_revision = '002_marketing_actions'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if not inspect(bind).has_table(user_profiles.name):
        user_profiles.create(bind=bind)


def downgrade():
    user_profiles.drop(bind=op.get_bind(), checkfirst=True)
