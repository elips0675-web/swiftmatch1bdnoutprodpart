# Деплой SwiftMatch на VPS (Docker)

Проект разворачивается целиком через **Docker Compose** (`.env` + `docker-compose.yml`).
`github/workflows/deploy.yml` автоматически выкатывает при пушe в `main`; ниже — ручной путь и требования.

## Предварительные требования (VPS)

- Ubuntu 22.04/24.04 (или любой Linux).
- Установленный **Docker Engine + Docker Compose plugin**:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER
  newgrp docker
  docker compose version   # должен вывести версию
  ```
- Минимум **2 CPU / 2 GB RAM** (при 100 VU лучше 4 GB). Диск ≥ 20 GB.

## 1. Клонировать репозиторий

```bash
cd /app && git clone https://github.com/elips0675-web/swiftmatch1bdnoutprodpart.git swiftmatch
cd /app/swiftmatch
```

## 2. Секреты (`.env`)

`.env` в git отсутствует — создайте из примера и заполните реальными значениями:

```bash
cp .env.example .env
nano .env
```

Обязательные продакшен-значения (все из секций `.env.example`):
- `JWT_SECRET` — сгенерируйте длинный случайный (≥32 байта).
- Stripe: `STRIPE_SECRET_KEY` (live), `STRIPE_WEBHOOK_SECRET`.
- OpenAI: `OPENAI_API_KEY` (AI-модерация, icebreakers, hangouts suggest).
- `CLIENT_URL`, `CORS_ORIGIN` = ваш домен (https://swiftmatch.app).
- Опционально: RevenueCat `REVENUECAT_WEBHOOK_SECRET`, Sentry `SENTRY_DSN`, Twilio, SMTP, FCM/VAPID.

> ВАЖНО: `VITE_*` переменные попадают в браузер — не храните в них секреты.
> Для сборки фронта с продакшен-API задайте `VITE_API_URL=/api` (отдаётся nginx'ом).

## 3. Первичный запуск

```bash
docker compose up -d --build
```

Первый старт:
- MySQL поднимается, применяет `database/mysql_schema.sql` + миграции из `database/migrations/` (только при **пустом** volume `db_data`);
- применяет миграции повторно нельзя — они идемпотентны через таблицу `_migrations` (`node database/migrations/migrate.js`).

Проверить:
```bash
docker compose ps            # все контейнеры healthy
curl http://localhost:3002/health
curl http://localhost:8080/healthz
```

## 4. Домен + HTTPS

`docker-compose.yml` отдаёт приложение на `http://localhost:8080` (nginx-web-этап).
Для HTTPS наружу используйте внешний reverse-proxy — проще всего **Caddy** (авто Let's Encrypt):

```bash
# /etc/caddy/Caddyfile
swiftmatch.app {
    reverse_proxy 127.0.0.1:8080
}
```

Альтернативно — замените `nginx/swiftmatch.http.conf` на `nginx/swiftmatch.conf`
(SSL-блок) и повесьте сертификаты на `/etc/ssl`. Обычно проще через Caddy/Traefik.

## 5. Автоматический деплой (GitHub Actions)

`deploy.yml` при пушe в `main` после зелёных проверок rsync'ит файлы на VPS и делает
`docker compose up -d --build` + `migrate.js` + `schema-validate.mjs`.

В GitHub-репозитории создайте secrets:
- `DEPLOY_HOST` — IP/имя VPS
- `DEPLOY_USER` — SSH-пользователь (например `deploy`)
- `DEPLOY_SSH_KEY` — приватный SSH-ключ деплой-пользователя (публичный — в `~/.ssh/authorized_keys`)

Remote-путь в workflow: `/app/swiftmatch`.

## 6. Мониторинг

Prometheus (9090) + Grafana (3001) поднимаются вместе с compose:
- Prometheus собирает `/metrics` с API-контейнера.
- Grafana: логин `admin` / пароль из `GF_SECURITY_ADMIN_PASSWORD` (в compose `swiftmatch`).
  Dashboard уже зарегистрирована (`monitoring/grafana-dashboard.json`).
- Для публичного доступа — закройте 9090/3001 (только internal) или за reverse-proxy.

## 7. Нагрузочное тестирование (k6)

k6-сценарий (`k6/load-test.js`) — рамп до 100 VU с порогами (error<10%, p95<2s).

Локально против живого API:
```bash
k6 run k6/load-test.js -e API_URL=http://localhost:3002 -e USER_EMAIL=user5@mail.ru -e USER_PASSWORD=demo123456
```

Через nginx (как реальные пользователи, учтёт rate-limit):
```bash
k6 run k6/load-test.js -e API_URL=http://localhost:8080 -e USER_EMAIL=user5@mail.ru -e USER_PASSWORD=demo123456
```

## 8. Бэкапы

Сервер поддерживает дамп БД (`BACKUP_DIR`, `BACKUP_RETENTION_DAYS`). Настройте cron на VPS,
например ежедневный дамп из DB-контейнера:

```bash
0 3 * * * docker exec $(docker compose -f /app/swiftmatch/docker-compose.yml ps -q db) \
  mysqldump -uroot -proot swiftmatch1bd | gzip > /var/backups/swiftmatch_$(date +\%F).sql.gz
```

## Быстрые команды

```bash
docker compose up -d --build   # собрать и поднять всё
docker compose logs -f app     # логи API
docker compose exec -T app node database/migrations/migrate.js   # применить миграции
docker compose down            # остановить
docker compose down -v         # остановить И стереть данные volume (осторожно!)
docker compose exec -T app node scripts/schema-validate.mjs      # проверка схемы
```
