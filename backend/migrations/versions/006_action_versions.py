"""Add optimistic version to contact records without changing their contents."""
from alembic import op
from sqlalchemy import Column, Integer, inspect, text

revision = '006_action_versions'
down_revision = '005_action_outcomes'
branch_labels = None
depends_on = None


def upgrade():
    if 'version' not in {column['name'] for column in inspect(op.get_bind()).get_columns('marketing_actions')}:
        op.add_column('marketing_actions', Column('version', Integer, nullable=False, server_default=text('1')))


def downgrade():
    if 'version' in {column['name'] for column in inspect(op.get_bind()).get_columns('marketing_actions')}:
        op.drop_column('marketing_actions', 'version')
