"""Store whether a login may be restored after a page reload."""
from alembic import op
from sqlalchemy import Boolean, Column, inspect, text

revision = '004_remember_me'
down_revision = '003_user_profiles'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    if 'remember_me' not in {column['name'] for column in inspect(bind).get_columns('sessions')}:
        op.add_column('sessions', Column('remember_me', Boolean, nullable=False, server_default=text('false')))


def downgrade():
    bind = op.get_bind()
    if 'remember_me' in {column['name'] for column in inspect(bind).get_columns('sessions')}:
        op.drop_column('sessions', 'remember_me')
