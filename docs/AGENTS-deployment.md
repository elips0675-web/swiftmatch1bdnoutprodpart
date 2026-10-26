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

## Диск и логи контейнеров

Логи ограничены в `docker-compose.yml` якорем `x-logging` (`driver: json-file`, `max-size: 10m`, `max-file: 3` — до 30 МБ на контейнер, у всех шести сервисов), у Prometheus задан retention тома (`--storage.tsdb.retention.time=15d`, `--storage.tsdb.retention.size=2GB`). Гейт: `npm run check:compose-logging` (`scripts/compose-logging-audit.mjs`) — падает, если у сервиса нет лимита логов, лимит бессмысленный (`max-size` > 100 МБ, `max-file` > 10), у Prometheus нет retention или в workflow появилась prune-команда.

Порядок при «Docker съел диск» — от измерения к действию:

1. **Измерить, а не гадать:** `docker system df -v`, `df -h`, и отдельно содержимое каталога Docker изнутри (`docker run --rm -v /var/lib/docker:/d redis:7-alpine sh -c "du -sk /d/* | sort -n | tail"`). Логи контейнеров — `find /var/lib/docker/containers -name '*-json.log' -exec du -sk {} +`.
2. **Безопасная чистка:** `docker builder prune -f`, `docker image prune -f` (только dangling-образы без тега), `docker compose logs --tail 100 <service>`. Логи работающих контейнеров уже ротируются лимитом из compose — вручную `truncate` им не нужен.
3. **Запрещено на VPS:** `docker system prune -a` удаляет образы, не занятые запущенным контейнером, — то есть `swiftmatch-app:rollback` и `swiftmatch-web:rollback`, единственную цель автоматического отката (снимок снимается **до** сборки, раздел выше); после него откат физически невозможен. `--volumes` / `docker volume prune` удаляют `db_data` и `uploads_data` — базу и фотографии пользователей. Гейт валит деплой, если такая команда появится в `.github/workflows/*`.
4. **Если `docker system df` мал, а диск занят — виноват не Docker, а образ диска.** На Windows это `%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx` (замер 26.10.2026: файл 39.13 ГБ при 5.4 ГБ данных внутри — 33+ ГБ освобождённых прошлыми prune блоков, которые VHDX не отдал; файл не sparse). На Linux тот же класс — файлы, удалённые, но открытые процессом: `lsof +L1`.
5. **Windows, возврат места:** `docker desktop stop` → `wsl --shutdown` → `Optimize-VHD -Path "<путь к docker_data.vhdx>" -Mode Full` от администратора → `docker desktop start`. Замер: 39.13 → 6.6 ГБ, на C: +30.2 ГБ, образы и тома целы. `Docker Desktop.exe -Quit` на 4.x не завершает движок (только показывает дашборд) — остановка через `docker desktop stop`.

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
