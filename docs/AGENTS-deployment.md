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
2. `docker compose build && docker compose up -d` — поднимает `app` (миграции применяются автоматически при старте), `db` (mysql:8.4 + schema/миграции при первом volume), `redis`, `nginx` (:8080, статика из `dist/`), `prometheus` (:9090), `grafana` (:3001).
3. Миграции: `node database/migrations/migrate.js` выполняется в CMD образа перед сервером; идемпотентно (таблица `_migrations`), безопасен для существующей БД.
4. Healthcheck: `GET /health` (curl в образе, `USER node`), compose-зависимости ждут healthy `db`.
5. Нагрузочный тест: `k6 run scripts/k6/load-staging.js` (smoke) или `k6 run --env MODE=load --env STAGING_URL=https://… scripts/k6/load-staging.js` (100 VU, пороги p95<500ms и <1% ошибок).

## Деплой и откат (безопасная выкладка)

Деплой обязан уметь две вещи: **доказать, что версия поднялась**, и **сам вернуться назад**, если не поднялась. В `.github/workflows/deploy.yml` (джоба `deploy`) это так:

1. Перед сборкой снимается снимок работающих образов: `docker tag swiftmatch-app:latest swiftmatch-app:rollback` (+ `swiftmatch-web`). Сборка переназначает только `:latest`, поэтому `:rollback` хранит предыдущую версию.
2. `docker compose up -d --build --wait` — `--wait` не отдаёт управление, пока сервисы с `healthcheck` не станут `healthy`.
3. Дополнительная проба тех же порта и пути, что в `healthcheck` compose: `curl -fsS http://127.0.0.1:3002/health` и `curl -fsS http://127.0.0.1:8080/` (цикл 30×5 с), иначе шаг падает — «контейнер запущен» ≠ «API отвечает». Проба бьёт по **опубликованному** порту (путь конечного пользователя), поэтому на VPS-хосте обязателен `curl`: скрипт проверяет `command -v curl` в начале и падает сразу, до изменений — иначе отсутствие curl выглядело бы как «health не поднялся».
4. Только после этого применяются миграции и `schema-validate` / `schema-drift-audit`.
5. При падении **любого** шага отдельный шаг с `if: failure()` возвращает `:rollback` (`docker compose up -d --no-build --wait`) и снова проверяет health. Прод не остаётся на новой версии до ручного вмешательства.

Что нужно от `docker-compose.yml`: у сервисов `app` и `nginx` объявлены `image:` (стабильный тег отката — иначе имя зависит от имени проекта compose) и у `app` — `healthcheck` с `curl`.

Миграции не откатываются (forward-only, `docs/rollback-plan.md`, раздел про миграции): если причина сбоя в самой миграции, восстановление — из бэкапа.

Гейт: `npm run check:deploy-rollout` (`scripts/deploy-rollout-audit.mjs`) связывает `docker-compose.yml`, `deploy.yml` и пробу сервиса `app`; падает, если снят `--wait`, снимок `:rollback` делается после `up`, проба бьёт не в тот порт/путь, откат потерял `--no-build` / `if: failure()` / пробу health. Само поведение на VPS гейт не доказывает (нужен VPS) — он держит структуру, без которой откат невозможен физически.

**Чего в этой схеме нет:** истинного zero-downtime (без окна 502 на время пересоздания контейнера). Он требует двух реплик `app` за nginx с перереload, а это упирается в решение «single-instance» из-за in-memory лимитеров (`docs/rollback-plan.md`, раздел про rate-limit): `express-rate-limit` и `lockout.js` не шарят счётчики между процессами, поэтому реплик не может быть больше одной, пока лимиты не переведены на `REDIS_URL`.

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
