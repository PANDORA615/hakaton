import os
from alembic import context
from sqlalchemy import create_engine
from app.db import metadata

engine = create_engine(os.environ.get('DATABASE_URL', 'sqlite:///./aeza.db'))
with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=metadata)
    with context.begin_transaction():
        context.run_migrations()
