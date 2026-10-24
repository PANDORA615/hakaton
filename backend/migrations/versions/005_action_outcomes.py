"""Record observed renewal outcomes for customer actions."""
from alembic import op
from sqlalchemy import Column, String, inspect, text

revision = '005_action_outcomes'
down_revision = '004_remember_me'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in inspect(op.get_bind()).get_columns('marketing_actions')}
    if 'outcome' not in columns:
        op.add_column('marketing_actions', Column('outcome', String, nullable=False, server_default=text("'pending'")))
    if 'outcome_recorded_at' not in columns:
        op.add_column('marketing_actions', Column('outcome_recorded_at', String))


def downgrade():
    columns = {column['name'] for column in inspect(op.get_bind()).get_columns('marketing_actions')}
    if 'outcome_recorded_at' in columns:
        op.drop_column('marketing_actions', 'outcome_recorded_at')
    if 'outcome' in columns:
        op.drop_column('marketing_actions', 'outcome')
