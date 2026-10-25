# Выпуск и восстановление

Рабочий сервер использует один backend worker, PostgreSQL, Nginx, Dex и Caddy. Публичный адрес: `https://app.5-145-176-212.sslip.io/`; старый `http://5.145.176.212:8080/` перенаправляет на HTTPS. Команда пока не предоставила собственный домен, поэтому используется временное DNS-имя sslip.io. Файлы `.runtime/stack.env` и `.runtime/oidc.env` содержат секреты, имеют режим 0600 и не входят в Git. Команды ниже выполняются из `/opt/aeza`.

## Перед обновлением

Сверьте `git rev-parse HEAD` и `git ls-remote origin refs/heads/main`, проверьте `git status --short` и сохраните локальные изменения. Проверьте `docker compose --env-file .runtime/stack.env -f compose.yaml -f compose.oidc.yaml ps` и `free -h`. Не запускайте второй backend worker: блокировка пересчёта пока локальна одному процессу.

Создайте приватную копию БД:

```bash
mkdir -p .runtime/backups
chmod 700 .runtime/backups
umask 077
docker exec aeza-db-1 pg_dump -U retention -Fc retention > .runtime/backups/aeza-before-update.dump
```

Проверьте возможность восстановления в **отдельную** БД:

```bash
docker exec aeza-db-1 createdb -U retention retention_restore_check
docker exec -i aeza-db-1 pg_restore -U retention -d retention_restore_check --no-owner --no-privileges < .runtime/backups/aeza-before-update.dump
docker exec aeza-db-1 psql -U retention -d retention_restore_check -tAc 'SELECT version_num FROM alembic_version; SELECT count(*) FROM marketing_actions;'
```

Если тестовая БД уже существует, используйте другое имя; не направляйте `pg_restore` в рабочую `retention` для проверки.

## Обновление

```bash
docker compose --env-file .runtime/stack.env -f compose.yaml -f compose.oidc.yaml build backend frontend
docker compose --env-file .runtime/stack.env -f compose.yaml -f compose.oidc.yaml up -d --no-build backend frontend
docker compose --env-file .runtime/stack.env -f compose.yaml -f compose.oidc.yaml ps
curl -fsS https://app.5-145-176-212.sslip.io/healthz
```

Backend применяет Alembic при старте. Релиз v1.0 добавляет миграцию `012_release_v1`: роли и состояние сотрудников, авторство карточек и контактов, подтверждённую сумму. Уже существующие данные, настройки и заметки остаются; для старых записей автор и подтверждённая сумма неизвестны. Перед рабочим обновлением восстановите резервную копию в отдельную БД и прогоните миграцию на ней. После запуска проверьте `SELECT version_num FROM alembic_version` (ожидается `012_release_v1`), парольный вход, рейтинг, «Что если?», очередь, конфликт редактирования, завершённые карточки и историю. Действующий TLS-сертификат Caddy обновляет автоматически при доступных публичных портах 80/443.

## Откат

Откат образа **без** отката схемы БД не является проверенным восстановлением. Для v1.0 нужен снимок БД, сделанный до миграции 012, и совместимые образы с тегом `before-release-v1`. Новые данные сотрудников и подтверждённых сумм, добавленные после снимка, при полном восстановлении исчезнут; перед откатом оцените это с командой. При подтверждённом инциденте остановите backend/frontend, восстановите копию и запустите совместимые образы вместе:

```bash
docker compose --env-file .runtime/stack.env -f compose.yaml -f compose.oidc.yaml stop backend frontend
docker exec aeza-db-1 dropdb -U retention retention
docker exec aeza-db-1 createdb -U retention -O retention retention
docker exec -i aeza-db-1 pg_restore -U retention -d retention --no-owner --no-privileges < .runtime/backups/aeza-before-update.dump
docker tag aeza-backend:before-release-v1 aeza-backend:latest
docker tag aeza-frontend:before-release-v1 aeza-frontend:latest
docker compose --env-file .runtime/stack.env -f compose.yaml -f compose.oidc.yaml up -d --no-build backend frontend
```

Перед рабочим откатом проверьте имя резервного файла и наличие образов. Восстановление в отдельную БД проверяет читаемость архива без изменения рабочей установки.
