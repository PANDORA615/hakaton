# Aéza Churn Risk Analyzer

Первый рабочий Django-каркас для кейса «Анализ рисков оттока». Сейчас в нём есть:

- сессионная авторизация по логину и паролю;
- модели клиентов, услуг и настраиваемых весов risk-score;
- объяснимый расчёт риска продления;
- защищённые API для списка и карточки клиентов, а также настроек модели;
- Swagger UI: `/api/v1/docs`.

## Локальный запуск

Нужен Python 3.12+.

```powershell
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

После входа в Django admin (`/admin/`) можно создать клиентов и услуги. Затем войдите через `POST /api/v1/auth/login`; Swagger доступен по `/api/v1/docs`.

## Проверки

```powershell
python manage.py test
python manage.py check
```

Это только фундамент. Следующие этапы: импорт исходного snapshot, денежная оценка, метрики Prometheus, SSE, web-панель и Docker Compose.
