# 🚀 Production Deployment

## Подготовка
1. Вписать 7 ключей в `server/.env` (Stripe, SMTP, Sentry, S3, Redis, DB_PASSWORD, CORS_ORIGIN)
2. `npx vite build` — сборка фронта в `dist/`
3. `cd server && npm ci --production` — зависимости бэка

## Варианты хостинга
| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| VPS (nginx + PM2) | Полный контроль | Ручное администрирование |
| Docker + VPS | Изолированно, healthcheck | Сложнее отладка |
| Railway / Fly.io | Простота, SSL | Меньше контроля |

## Docker + VPS (рекомендованный путь для staging)
1. `.env` в корне: `DB_*`, `JWT_SECRET`, `CORS_ORIGIN`, `REDIS_URL`, ключи (Twilio/AWS/Stripe/OpenAI/Sentry).
2. `docker compose build && docker compose up -d` — поднимает `app` (миграции применяются автоматически при старте), `db` (mysql:8 + schema/миграции при первом volume), `redis`, `nginx` (:8080, статика из `dist/`), `prometheus` (:9090), `grafana` (:3001).
3. Миграции: `node database/migrations/migrate.js` выполняется в CMD образа перед сервером; идемпотентно (таблица `_migrations`), безопасен для существующей БД.
4. Healthcheck: `GET /health` (curl в образе, `USER node`), compose-зависимости ждут healthy `db`.
5. Нагрузочный тест: `k6 run scripts/k6/load-staging.js` (smoke) или `k6 run --env MODE=load --env STAGING_URL=https://… scripts/k6/load-staging.js` (100 VU, пороги p95<500ms и <1% ошибок).

## Nginx essentials
```nginx
location /api {
    proxy_pass http://localhost:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400s;    # для WebSocket
    client_max_body_size 10M;     # для фото
}

location / {
    root /app/dist;
    try_files $uri $uri/ /index.html;  # SPA fallback
}
```
