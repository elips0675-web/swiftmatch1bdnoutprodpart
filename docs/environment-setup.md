# Runbook: поднятие окружения для продакшена (staging → prod)

> Этап 68 (27.08.2026). Пошаговый план «окружение» — всё, что **вне кода**, чтобы выйти в прод.
> Код, тесты, `.env.example`, docker-compose, nginx, deploy.yml и `runbook-keys.md` уже готовы.
> Секреты в git НЕ коммитятся: `.env` в `.gitignore` (см. `runbook-keys.md` § «Где живут ключи»).
> Порядок = порядок в плане «Первый рубль» → «Мобильный релиз» → «Надёжность» → «Масштабирование» (Что доделать.txt, фазы qwen).

---

## 0. Что уже готово в коде (не нужно делать заново)

- `docker-compose.yml` — app + nginx + Prometheus + Grafana (валиден, но НЕ прогонялся end-to-end)
- `nginx/swiftmatch.conf` — WS timeout `proxy_read_timeout 86400s`, `client_max_body_size 10M`
- `.github/workflows/deploy.yml` — CI: lint → test → build → migrate (на сервере) → restart; нужны только secrets
- `scripts/backup-mysql.ps1` / `.sh` — бэкап, retention 30 дней; `verify-backup.mjs` — restore smoke
- `server/.env.example`, `.env.example` — актуальные шаблоны всех ключей
- `docs/runbook-keys.md` — ротация/порядок ввода каждого ключа
- `docs/rollback-plan.md` — план отката

---

## 1. VPS (staging → prod)

- [ ] Купить/поднять VPS (2 vCPU / 4 GB минимум; DB_POOL_MAX 20 → при необходимости 10 под k6)
- [ ] Ubuntu LTS, SSH-доступ (ключ, не пароль)
- [ ] Установить Docker + Docker Compose plugin
- [ ] Выделить отдельного пользователя для деплоя (не root), добавить SSH-ключ (для `DEPLOY_SSH_KEY`)
- [ ] **Проверка:** `ssh deploy@<ip>` входит без пароля

## 2. Домен и DNS

- [ ] Купить домен, у регистратора: A-запись `@` и `www` → IP VPS
- [ ] (поддомен `api.` или настройка путей — по nginx-конфигу)
- [ ] **Проверка:** `dig +short <domain>` возвращает IP VPS

## 3. SSL (Let's Encrypt + auto-renewal)

- [ ] `certbot` (nginx-плагин) на VPS: получить сертификат на `<domain>`
- [ ] Проверить auto-renew: `systemctl status certbot.timer` (или cron)
- [ ] Привязать в nginx: `ssl_certificate` пути + редирект `http → https`
- [ ] **Проверка:** `https://<domain>` открывается с валидным сертификатом; WS `wss://<domain>/socket.io` подключается (нет CSP/SSL ошибок)

## 4. Docker Compose (реальный прогон)

- [ ] `cp server/.env.example server/.env` на VPS → вписать реальные ключи (см. §5)
- [ ] Склонировать репо на VPS, собрать фронт: `VITE_API_URL=https://<domain> npx vite build` → `dist/`
- [ ] `docker compose up -d`
- [ ] Проверить по одному: healthcheck app (`/health` 200), nginx проксирует `/api` 200, WS через 60s не обрывается, `client_max_body_size` пропускает фото до 10 MB, volumes (./dist, uploads), сеть между контейнерами
- [ ] По итогам (если что-то поправили в compose/nginx) — commit

## 5. Ключи — ввести реальные (по `runbook-keys.md`)

Всё в `server/.env` на VPS. После каждого: рестарт API + смоук.

| Сервис | Переменные | Без ключа | Проверка |
|---|---|---|---|
| Stripe (test → live) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_LIVE=true` | mock (в prod запрещён) | checkout session + webhook «invalid signature» нет |
| SMTP (Resend/SES/SendGrid) | `SMTP_HOST/PORT/SECURE/USER/PASS/FROM` | письма НЕ доходят (только лог «Would send...») | сброс пароля → письмо приходит |
| Sentry | `SENTRY_DSN` (back) + `VITE_SENTRY_DSN` (front) | нет телеметрии | ошибка → событие в Sentry |
| S3/DO/Selectel | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, `S3_ENDPOINT` | фотки на локальном диске | загрузка фото → файл в бакете |
| Redis | `REDIS_URL` | in-memory fallback (1 инстанс) | `Redis connected` в логе + 2×re-limit |
| VAPID (push) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (сгенерить `npx web-push generate-vapid-keys`) | dev-ключ | пуш на web подписку |
| OpenAI / Perspective | `OPENAI_API_KEY`, `OPENAI_MODEL`, `PERSPECTIVE_API_KEY` | icebreakers фолбэк из БД; модерация fail-open | icebreaker из OpenAI |
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS не уходит | код на телефон |
| FCM | `FCM_SERVER_KEY`, `FCM_SERVICE_ACCOUNT` | пуши Android не идут | пуш на устройство |
| RevenueCat | `REVENUECAT_WEBHOOK_SECRET` + `VITE_REVENUECAT_API_KEY` (front) | IAP no-op (веб-fallback) | sandbox-покупка |

**Проверка всех ключей разом:** `powershell -File scripts/check-keys.ps1` (Windows) — для Linux используйте `grep` по `server/.env` (скрипт-аналог в репо не заведён; можно вызвать PowerShell из WSL: `pwsh -File scripts/check-keys.ps1`).

## 6. GitHub secrets (для deploy.yml)

- [ ] В репозитории: Settings → Secrets and variables → Actions:
  - `DEPLOY_HOST` — IP VPS
  - `DEPLOY_USER` — пользователь деплоя
  - `DEPLOY_SSH_KEY` — приватный SSH-ключ деплоя
  - (DB_* НЕ нужны — миграции читают `server/.env` на сервере)
- [ ] Прогнать deploy.yml на ветке `main`

## 7. Реальный деплой + smoke

- [ ] После первого деплоя: миграции прошли на сервере (`node database/migrations/migrate.js`)
- [ ] `node scripts/schema-validate.mjs` — схема совпадает
- [ ] Смоук API: `/health` 200, логин/регистрация/чат/загрузка/чекаут
- [ ] E2E против staging с реальными ключами (дипсик: «финальное E2E-тестирование»)

## 8. Redis — поднять постоянно

- [ ] В docker-compose redis уже есть — включить сервис (или ubuntu `apt install redis-server` + systemd)
- [ ] `REDIS_URL=redis://<host>:6379` в `server/.env`
- [ ] **Проверка:** лог `[ws] Redis adapter attached` (этап 68) + `connected_clients > 0`

## 9. Бэкапы

- [ ] Настроить ежедневный бэкап MySQL (Task Scheduler / cron) — `scripts/backup-mysql.ps1` / `.sh`
- [ ] retention 30 дней
- [ ] Прогнать `scripts/verify-backup.mjs` (restore в скретч-БД + sanity) — RTO уже замерен ~3.6с (этап 44)
- [ ] Выгрузить бэкап во внешнее хранилище (не на тот же диск)

## 10. Android-окружение

- [ ] JDK 21 (не 25), Android SDK (platform 35/36, build-tools 35.0.0)
- [ ] `@revenuecat/purchases-capacitor` установлен; `VITE_REVENUECAT_API_KEY` в `.env` перед сборкой
- [ ] keystore (production) — не в git
- [ ] `npx cap sync android` → `./gradlew assembleRelease` → AAB (bundle)
- [ ] App Links: `assetlinks.json` на домен + SHA256 fingerprint
- [ ] Google Play Console: проект, политика 17+, Privacy Policy + Terms, скриншоты, TestFlight/внутренний трек

## 11. Мониторинг (после деплоя)

- [ ] UptimeRobot (HTTP + WS) → алерты
- [ ] Grafana alerts в Telegram/Slack (CPU, 5xx, DB connections) — дашборды уже provisioned
- [ ] Sentry: source maps для фронта, beforeSend фильтрует secrets (готово), алерты на errors
- [ ] Log aggregation (Loki/ELK) — пост-релиз, Винстон-на-диск заменяется

## 12. Нагрузочное тестирование (staging)

- [ ] `k6/load-test.js` — полный ramp **100 VU** (не 10) на staging с мульти-IP / поднятыми лимитами
- [ ] Мониторить `free -m` / `Threads_connected` (check RADAR_PRE_LEAK_64 — память/утечки пула)
- [ ] При необходимости `DB_POOL_MAX` 20 → 10

---

## Чек-лист «готов к проду»

- [ ] `/health` 200 с VPS
- [ ] `https://<domain>` + валидный SSL
- [ ] WS `wss://` подключается, 60s+ не обрывается
- [ ] Все обязательные ключи введены и проверены (`check-keys`)
- [ ] deploy.yml отработал, миграции применились, schema-validate OK
- [ ] Бэкап ежедневно + restore smoke в CI
- [ ] Sentry ловит ошибки, telegram/slack алерты
- [ ] Android APK/AAB собирается, App Links работают
- [ ] Полный E2E против staging зелёный

После выполнения — updeйт `Что доделать.txt` и закоммить (документация).
