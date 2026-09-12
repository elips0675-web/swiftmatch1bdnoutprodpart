# Чек-лист: VPS → secrets → первый деплой → smoke

> Исполняемый пошаговый план по qwen «4 дня» + приоритеты kimi и дипсик.
> Согласован с `docs/environment-setup.md` (полный runbook), `docs/runbook-keys.md` (ротация ключей), `test/DEPLOY.md` (ручной деплой), `.github/workflows/deploy.yml`.
> Правило: секреты НЕ в git (`git check-ignore server/.env` должен вернуть путь). Секции 1–4 — это ~день 1–2, 5–7 — день 3, 8–10 — день 4.

---

## 1. VPS

- [ ] Купить/создать VPS: **Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM**, диск ≥ 20 GB, public IP.
- [ ] Проверить вход по паролю из панели хостинга, затем сразу перейти на ключ:
  ```bash
  ssh-keygen -t ed25519 -C "deploy-vps" -f ~/.ssh/id_ed25519_vps -N ""      # если ещё нет
  ssh-copy-id -i ~/.ssh/id_ed25519_vps root@<IP>                             # или вручную в authorized_keys
  ssh root@<IP>                                                              # вход без пароля
  ```
- [ ] Базовая защита:
  ```bash
  apt update && apt upgrade -y
  adduser deploy && usermod -aG sudo deploy
  # в /etc/ssh/sshd_config: PermitRootLogin no, PasswordAuthentication no → sudo systemctl restart ssh
  ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
  ```
- [ ] Docker + Compose plugin:
  ```bash
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker deploy
  su - deploy && docker compose version     # docker compose v2
  ```
- [ ] **Проверка:** `ssh deploy@<IP>` входит без пароля; `docker info` работает у `deploy`.

## 2. Домен + DNS

- [ ] Купить домен (напр. `swiftmatch.app`), у регистратора добавить:
  - `A  @   → <IP VPS>`
  - `A  www → <IP VPS>`
  - (если API на поддомене — `CNAME api → @`, см. CSRF-guard при выносе на поддомен)
- [ ] **Проверка:** `dig +short <domain>` и `dig +short www.<domain>` возвращают IP VPS.

## 3. SSL (Caddy, авто Let's Encrypt — простейший путь)

- [ ] Установить Caddy как systemd-сервис:
  ```bash
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update && apt install -y caddy
  ```
- [ ] `/etc/caddy/Caddyfile`:
  ```
  <domain> {
      reverse_proxy 127.0.0.1:8080
  }
  ```
- [ ] `sudo systemctl reload caddy` — сертификат выпустится автоматически при первом входящем запросе.
- [ ] **Проверка:** `https://<domain>` открывается без ошибок сертификата; `https://<domain>/health` отвечает 200.

## 4. Код на сервере + первый `docker compose up`

- [ ] Склонировать репозиторий (deploy-пользователь):
  ```bash
  sudo mkdir -p /app && sudo chown deploy:deploy /app
  cd /app && git clone https://github.com/elips0675-web/swiftmatch1bdnoutprodpart.git swiftmatch
  cd /app/swiftmatch
  ```
- [ ] Подготовить окружение (см. §5 — секреты) и собрать фронт:
  ```bash
  cp server/.env.example server/.env
  nano server/.env                       # вписать реальные значения (см. §5)
  VITE_API_URL=/api npm --prefix client run build   # или как в скриптах сборки: npx vite build
  ```
- [ ] Первый запуск (long-running; держите отдельным ssh-окном или через `nohup`):
  ```bash
  docker compose up -d --build
  docker compose ps                       # app/db/nginx/redis/grafana/prometheus — healthy
  ```
- [ ] **Проверки по одной:**
  ```bash
  curl http://localhost:3002/health                       # 200
  curl http://localhost:8080/healthz                      # 200 (nginx)
  curl http://localhost:8080/api/hangouts                 # JSON, не 50x
  docker compose logs app | grep -iE "redis|adapter"     # "[redis] ... connected", "[ws] Redis adapter attached"
  ```
- [ ] Если в compose/nginx что-то поправлено под VPS — закоммитить обратно в репо.

## 5. Секреты (server/.env на VPS) — «первый рубль» и безопасность

> Полный порядок ротации каждого ключа и смоуки: `docs/runbook-keys.md`.
> Итоговая проверка всех ключей разом: `pwsh -File scripts/check-keys.ps1` (Windows) или `grep -cE '^[A-Z_]+=.+' server/.env`.

**Обязательное (без них прод не пускать/блокеры):**
- [ ] `JWT_SECRET` — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` → вставить. Проверка: логин + `/api/profile/me`.
- [ ] `CLIENT_URL`, `CORS_ORIGIN` = `https://<domain>`.
- [ ] Stripe: `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_WEBHOOK_SECRET=whsec_...`, `STRIPE_LIVE=true` (после успешного test-флоу). Проверка: checkout-сессия премиума + webhook без `invalid signature`.
- [ ] SMTP (Resend/SendGrid/SES): `SMTP_HOST/PORT/SECURE/USER/PASS/FROM`, `EMAIL_FROM`. Проверка: сброс пароля → письмо приходит.
- [ ] OpenAI: `OPENAI_API_KEY` + `OPENAI_MODEL=gpt-4o-mini`. Проверка: icebreaker через AI, модерация триггер-слова в логах.

**Опционально, по мере готовности:**
- [ ] Sentry: `SENTRY_DSN` (back) + `VITE_SENTRY_DSN` (front, требует пересборки бандла).
- [ ] S3: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, `S3_ENDPOINT` (Selectel/DO: добавить `S3_ENDPOINT`). Проверка: загрузка фото → файл в бакете.
- [ ] VAPID (web push): `npx web-push generate-vapid-keys` → `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` + `VITE_VAPID_PUBLIC_KEY`.
- [ ] FCM: `FCM_SERVER_KEY`, `FCM_SERVICE_ACCOUNT` (base64 — см. runbook-keys §FCM).
- [ ] Twilio: `TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER`.
- [ ] RevenueCat: `REVENUECAT_WEBHOOK_SECRET` + `VITE_REVENUECAT_API_KEY` (front).
- [ ] Redis: `REDIS_URL=redis://db:6379` (контейнер) — в compose Redis уже есть, убедиться, что сервис включён.

**После ввода каждой группы:** `docker compose restart app` (или рестарт через scheduler) + целевой смоук.

## 6. GitHub secrets + авто-деплой (deploy.yml)

- [ ] В GitHub-репо: Settings → Secrets and variables → Actions → New repository secret:
  - `DEPLOY_HOST` — IP VPS
  - `DEPLOY_USER` — `deploy`
  - `DEPLOY_SSH_KEY` — содержимое `~/.ssh/id_ed25519_vps` (приватный) деплой-пользователя
- [ ] Проверить, что публичный ключ деплоя добавлен в `authorized_keys` у `deploy`.
- [ ] Запушить в `main` (или rerun существующего `deploy.yml` workflow) — дождаться зелёного.
- [ ] **Проверка на сервере:** стики из workflow применили миграции —
  ```bash
  docker compose -f /app/swiftmatch/docker-compose.yml exec -T app node database/migrations/migrate.js
  docker compose -f /app/swiftmatch/docker-compose.yml exec -T app node scripts/schema-validate.mjs   # OK
  ```
- [ ] Проверить, что `.env` на VPS НЕ перезаписан деплоем (workflow не должен rsync-ить `server/.env`; если трогает — сделать исключение в `.gitignore`/rsync-фильтре).

## 7. Smoke на проде

- [ ] `/health` — 200 через домен.
- [ ] Регистрация нового пользователя → email-верификация приходит.
- [ ] Логин, редактирование профиля, загрузка фото (S3 или диск), чат.
- [ ] Premium checkout (Stripe test) → успех → role/премиум-перки.
- [ ] WS `wss://<domain>/socket.io` подключается, 60s+ не обрывается.
- [ ] E2E против staging: `npx playwright test` (или CI job) — зелёный селект сценариев.

## 8. Бэкапы + restore smoke (внешнее хранилище)

- [ ] cron на VPS (ежедневный дамп DB-контейнера в `/var/backups`):
  ```bash
  0 3 * * * docker exec $(docker compose -f /app/swiftmatch/docker-compose.yml ps -q db) mysqldump -uroot -proot swiftmatch1bd | gzip > /var/backups/swiftmatch_$(date +\%F).sql.gz
  ```
- [ ] Retention 30 дней (`find /var/backups -name 'swiftmatch_*.sql.gz' -mtime +30 -delete`).
- [ ] Выгрузка НА ДРУГОЙ диск/бакет (rclone/S3 sync).
- [ ] Restore smoke: `node scripts/verify-backup.mjs` — PASS (в CI этот шаг уже есть в `deploy.yml`).

## 9. Нагрузка (k6 на staging, честно)

- [ ] Прогнать на staging с pacing/мульти-IP (не локальный 1 IP — лимитер 600/1m/IP даст 429):
  ```bash
  k6 run k6/load-test.js -e API_URL=http://<staging>/api -e USER_EMAIL=user5@mail.ru -e USER_PASSWORD=demo123456
  ```
- [ ] Держать цель: **errors < 1%**, p95 < 2s. Мониторить `free -m` и `Threads_connected`.
- [ ] При росте лимитеров (429 у реальных юзеров) — поднять значения в `server/src/limiters.js` и PR.

## 10. Мониторинг + алерты

- [ ] UptimeRobot: HTTP(s) монитор на `https://<domain>/health` + порт проверки WS → алерты на почту/Telegram.
- [ ] Grafana уже в compose (логин `admin`/`swiftmatch`): зайти, убедиться, что dashboards provisioned, добавить alert-канал Telegram/Slack (CPU, 5xx, DB connections).
- [ ] Prometheus: закрыть порт 9090 наружу (`ufw deny 9090` / только internal).
- [ ] Sentry: убедиться, что события приходят, `beforeSend` не утекает secrets.

---

## Чек-лист «продакшен-готов» (итог)

- [ ] `https://<domain>` — 200, валидный SSL, авто-renew.
- [ ] `wss://` стабильно держит WS.
- [ ] Все обязательные ключи введены и прошли смоук (STRIPE_LIVE=true только после test-флоу).
- [ ] deploy.yml зелёный, миграции применены, schema-validate OK.
- [ ] k6 (staging, pacing/multi-IP): errors < 1%, p95 < 2s.
- [ ] Бэкап ежедневно во внешнее хранилище + restore smoke зелёный.
- [ ] UptimeRobot + Grafana алерты работают.
- [ ] Android (если релиз): keystore, AAB, assetlinks.json, внутренний трек (см. environment-setup §10).

После выполнения — дописать в `Что доделать.txt` (новый блок), синхронизировать `test/` и закоммитить.