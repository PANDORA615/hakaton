"""Create local credentials once; never overwrites an existing .env."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
target = root / '.env'
if target.exists():
    raise SystemExit('.env already exists. Edit it manually; no changes made.')
password = secrets.token_urlsafe(20)
content = (root / '.env.example').read_text(encoding='utf-8')
content = content.replace('POSTGRES_PASSWORD=\n', 'POSTGRES_PASSWORD=' + secrets.token_hex(24) + '\n')
content = content.replace('ADMIN_PASSWORD=\n', 'ADMIN_PASSWORD=' + password + '\n')
content = content.replace('METRICS_TOKEN=\n', 'METRICS_TOKEN=' + secrets.token_hex(32) + '\n')
with target.open('x', encoding='utf-8') as output:
    output.write(content)
target.chmod(0o600)
print('Created .env. Keep it private and do not commit it.')
print('Login: admin')
print('Local admin password:', password)
print('Start: docker compose up --build -d')
print('Open: http://localhost:8080')
