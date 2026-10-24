"""Persist official competitor tariff snapshots."""
from alembic import op
from sqlalchemy import inspect
from app.db import competitor_tariffs

revision = '009_competitor_tariffs'
down_revision = '008_customer_phone'
branch_labels = None
depends_on = None


def upgrade():
    if not inspect(op.get_bind()).has_table('competitor_tariffs'):
        competitor_tariffs.create(op.get_bind())


def downgrade():
    if inspect(op.get_bind()).has_table('competitor_tariffs'):
        competitor_tariffs.drop(op.get_bind())
