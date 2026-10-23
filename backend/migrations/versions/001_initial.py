"""Source contract and application storage."""
from alembic import op
from app.db import metadata

revision = '001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    metadata.create_all(bind=bind)
    if bind.dialect.name == 'postgresql':
        op.execute('ALTER TABLE services ADD CONSTRAINT services_name_format CHECK (name ~ \'^[A-Za-z0-9-]+$\')')
        for table, columns in [('services', ['createdAt', 'expiresAt']), ('transactions', ['createdAt', 'performedAt'])]:
            for column in columns:
                op.execute(f'ALTER TABLE {table} ALTER COLUMN "{column}" TYPE timestamptz(3)')


def downgrade():
    # Explicitly destructive: never used by startup or normal shutdown.
    metadata.drop_all(bind=op.get_bind())
