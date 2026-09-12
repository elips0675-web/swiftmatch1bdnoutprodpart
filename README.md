# SwiftMatch1BD — Тестовая копия с локальной БД

Клон [основного репозитория](https://github.com/elips0675-web/swiftmatch-vite-react1-production1) для тестирования с **реальной MySQL-БД** через локальный API-сервер.

Отличается от оригинала:
- **Бэкенд:** Node.js/Express + MySQL (Laragon), а не Supabase
- **Данные:** демо-данные (50 пользователей, 30 мэтчей, 200 сообщений)
- **Порт API:** 3002 (чтобы не конфликтовать с оригиналом на 3001)
- **Порт фронта:** 8081

---

## Быстрый старт

### 1. MySQL (Laragon)

Убедитесь, что MySQL запущен. База `swiftmatch` уже создана со схемой и демо-данными.

Импортировать заново:
```bash
mysql -u root swiftmatch < database\mysql_schema.sql
mysql -u root swiftmatch < database\demo_data.sql
```

### 2. API сервер

```bash
cd server
npm install
node src/index.js
# → http://localhost:3002
```

### 3. Фронтенд

```bash
npm install
npx vite --port 8081 --host
# → http://localhost:8081
```

---

## Данные для входа

| Email | Пароль | Роль |
|-------|--------|------|
| `admin@mail.ru` | `demo123456` | Админ |
| `user2@mail.ru` | `demo123456` | Обычный пользователь |
| `user4@mail.ru` … `user50@mail.ru` | `demo123456` | 47 демо-пользователей |
| `user1@mail.ru` | `demo123456` | Забанен (is_active=0) |

> После `git pull` запустить `node seed-users.cjs` в `server/` если добавились новые demo-пользователи. Пароль всех demo-пользователей: `demo123456`.

---

## Функционал

### 👤 Пользовательский опыт
- Регистрация, анкета, лайки, мэтчи, чаты — полный цикл знакомств
- Геопоиск по радиусу (MySQL Spatial ST_Distance_Sphere)
- Smart Matching: interest overlap + age distance + compatibility + activity
- Attachment-тест для психологической совместимости
- Системные и push-уведомления (Service Worker + VAPID)
- 50 демо-пользователей для тестирования (npm run db:seed)
- i18n (русский / английский), все данные — translation keys

### 💳 Монетизация
- **Stripe Checkout** — три тарифа (Plus / Gold / Platinum), длительность 1/6/12 мес.
- **Idempotency-Key middleware** — защита от двойных списаний
- **STRIPE_LIVE** — при `true` mock отключается; без ключа → 500
- **Premium-гейтинг:** лимит 10 лайков/день для free, скрытые просмотры
- **Реклама:** фича-флаг `showAds`, конфиг AdMob/Yandex в БД, динамический импорт с `setTimeout`-fallback
- **Админка:** управление ценами и рекламными блоками

### 🛠️ Админ-панель
- Дашборд со статистикой (пользователи, активность, матчи, выручка, подписки)
- Аналитика: retention, revenue-mix, регистрации (4 endpoint: `/analytics/overview`, `/retention`, `/revenue-mix`, `/registrations`)
- Управление пользователями: поиск, фильтры, бан/разбан, массовые операции, имперсонация
- Фича-флаги: 7 toggle'ов, сохраняются в БД (с валидацией пустого body)
- Модерация: жалобы, запрещённые слова, история действий
- Контент: управление интересами, целями знакомств
- Premium-статус в карточке пользователя (из `subscriptions`)
- **A/B-тесты:** страница `/admin/experiments`, стабильный assign 50/50 по MD5-хэшу, трекинг событий (registration/like/match/premium_purchase)

### 💬 Социальные функции
- Real-time чаты через **Socket.IO** с typing indicator и read receipts
- Emoji-реакции на сообщения (happy / love / sad / angry / like)
- Онлайн-статус (зелёная точка) через WebSocket
- Группы по интересам: создание, категории, посты, комментарии, лайки
- **AI Icebreakers:** чипы первого сообщения в пустом чате (`POST /api/icebreakers/suggest` — OpenAI или fallback из БД, RU/EN, 40 вопросов из сида)
- Конкурс с голосованием и лидербордом
- Блокировка пользователей

### 🔐 Безопасность и инфраструктура
- JWT в **httpOnly cookie** (`sm_token` 24h + `sm_refresh` 7d, SameSite=Lax, Secure в prod) — ставятся на login/register/refresh/dev-login; мидлвари читают `Bearer ?? cookie` (`server/src/cookies.js`); нативные сборки работают через Bearer; `POST /api/auth/logout` чистит куку + refresh_tokens в БД; probe `GET /api/auth/me` всегда 200
- **Refresh rotation + reuse detection**: ротация в пределах `family_id`, replay ротированного токена отзывает всю семью; гонка параллельных refresh закрыта атомарным claim'ом (этап 34)
- **Revoke all sessions**: `POST /api/auth/logout-all`; смена пароля отзывает все сессии пользователя
- **Account lockout**: 5 неудачных логинов подряд → 429 на 15 мин (`server/src/lockout.js`)
- **Санитизация ввода**: свободный текст (bio, имена, посты, сообщения) хранится без HTML-тегов (`server/src/sanitize.js`)
- **Sentry:** `@sentry/react` + `@sentry/node`, `beforeSend` фильтрует PII (email, токены, пароли)
- **Helmet:** CSP, X-Frame-Options, X-Content-Type-Options и др. security headers
- **Request ID:** UUID на каждый запрос, `X-Request-Id` в ответе
- **Rate limiting:** express-rate-limit (30r/s на лайки, 5r/s на auth)
- **Модерация чатов:** проверка banned-слов при отправке сообщений
- Бан пользователя + WS `user:banned` (мгновенный разлогин)
- **API Versioning:** `/api/v1/*` → `/api/*` + заголовок `X-API-Version: v1` (обратная совместимость)
- CORS: строгий `CORS_ORIGIN` (fail-fast без него в production); CSRF — SameSite=Lax куки + Bearer для нативных

### 📁 Загрузка файлов
- MIME-фильтр: только `image/*` + whitelist расширений (.jpg, .jpeg, .png, .gif, .webp)
- `fileSize: 10MB`
- **S3 scaffold:** lazy-init — при наличии AWS_* env → `@aws-sdk/client-s3` + `multer-s3`, иначе локальный диск

### 🗄️ База данных
- MySQL через mysql2, пул соединений
- **Миграции:** `database/migrations/` — нумерованные .sql + `migrate.js` (таблица `_migrations`)
- Schema: users, profiles, photos, interests, matches, chats, messages, reactions, subscriptions, activity_log, feature_flags, reports и др.

### 📧 Коммуникации
- **SMTP:** Nodemailer с retry-логикой (3 попытки, exponential backoff 1s/2s/3s)
- Graceful skip при пустых SMTP_USER/PASS
- Push-уведомления через VAPID + web-push
- **Email-кампании:** массовая рассылка из админки (`POST /api/admin/campaigns` → `sendCustomEmail` из `mail.js`, Bull queue при реальном SMTP)

### 🛡️ Модерация и репорты
- **AI Moderation:** OpenAI Moderation + AWS Rekognition + эвристика (regex banned-words)
- **Auto-escalation:** 1 report → pending, 3+ → temp ban, 5+ → permanent ban
- Severe categories (nudity, violence) → мгновенный бан

### 📋 Аудит и soft delete
- **Soft Deletes:** `deleted_at` на 11 основных таблицах
- **Audit Log:** `audit_log` таблица со всеми мутациями (кто, что, когда)

### 🏥 Health Checks
- `/health/live` — сервер жив (always 200)
- `/health/ready` — DB + Redis check (200/503)
- Graceful shutdown: SIGTERM + SIGINT, timeout 10s

### 💾 Redis (включён)
- **REDIS_URL=redis://127.0.0.1:6379** — кэш (profile 60s, matches 30s per-user), Bull Queue (email/push/image), Socket.IO Redis adapter
- Graceful fallback без Redis — все модули работают
- Cлужба Redis установлена с автостартом

### 🎁 Реферальная система
- Уникальный referral_code для каждого пользователя
- Отслеживание приглашённых друзей и премиум-конверсий
- `GET /api/referral/code`, `POST /api/referral/apply`, `GET /api/referral/stats`

### 🧪 Тестирование
- **Фронтенд (Vitest):** 58 тестов, 12 файлов — **0 failures**
- **Сервер (Vitest):** 149 тестов, 14 файлов — **0 failures** (включая cookie-auth, rotation, lockout, sanitize)
- **E2E (Playwright):** 44 теста, 5 spec-файлов (audit-full, features, login, profile, register) — **0 failures**
- **Pre-flight:** `npm run check:ports` — сверка портов (vite/proxy/.env/CORS_ORIGIN) + warn на `console.log` в `server/src`
- **Swagger:** OpenAPI-документация с JSDoc-аннотациями

### ⚙️ Фоновые задачи (Bull Queue)
- **3 очереди:** email (SMTP с retry), push (web-push), image (Sharp resize WebP/AVIF)
- **Graceful shutdown:** closeQueues() на SIGTERM
- **Fallback** без Redis: прямой вызов или лог

### 🔄 WebSocket
- Socket.IO с pingInterval 10s / pingTimeout 5s
- **Redis Adapter:** горизонтальное масштабирование через pub/sub (при REDIS_URL)
- WebRTC сигналинг (call-user, ice-candidate, end-call)

### 📍 Geospatial Search
- **MySQL Spatial:** POINT SRID 4326 + SPATIAL INDEX
- Поиск через `ST_Distance_Sphere` (все через prepared statements)
- Миграция `005_add_spatial_location.sql`

### 🐳 DevOps
- **Docker:** multi-stage (node:22-alpine), healthcheck на `/health`, USER node, `.dockerignore`, `restart: unless-stopped`
- **Docker Compose:** app + nginx + Prometheus (`:9090`) + Grafana (`:3001`), named volumes
- **Nginx:** rate limiting (api 30r/s, auth 5r/s), `client_max_body_size 20M`, WebSocket 86400s, SSL, SPA fallback
- **CI/CD:** GitHub Actions (lint → frontend test → server test с MySQL-сервисом → E2E → deploy)
- **Monitoring:** Prometheus-метрики (HTTP rps, p50/p95/p99, DB queries, WS events, cache), 7-panel Grafana dashboard
- **Load Testing:** k6-скрипт (`k6/load-test.js`, ramp-up 10→100 users, 6 endpoints)
- **Git hooks:** Husky + lint-staged (prettier + eslint на staged файлах)
- **Логирование:** Winston (JSON, timestamp/level/msg/rid)
- **Pre-flight:** `npm run check:ports` (порты + JWT_SECRET в server/.env) и `scripts/check-keys.ps1` (какие прод-ключи не заполнены)

### 🚀 Чек-лист запуска продакшена
1. **Ключи**: заполнить `server/.env` по `server/.env.example`; проверить `powershell -File scripts/check-keys.ps1` (обязательные: `JWT_SECRET`, `DB_PASSWORD`, `CORS_ORIGIN`; для фич: Stripe, SMTP, FCM, RevenueCat, Twilio, OpenAI, S3, Sentry, Redis)
2. **Миграции**: `node database/migrations/migrate.js` (или через CI)
3. **Проверка**: `npm run check:ports` → `npm test` (server) → `npx vitest run` → `npx playwright test` → `npx vite build`
4. **Запуск**: `cd server && node src/index.js` (строго из `server/` — иначе dotenv не подхватит .env и JWT-токены «сгорят»); продакшн-процесс под pm2/systemd
5. **Без ключей сервис деградирует, но жив**: Stripe → mock (в prod 502 «not configured» — осознанно), OpenAI → fallback из БД, пуши/SMS → mock, письма → лог «would send», S3 → локальный диск, RevenueCat webhook → 503
6. **CI-deploy**: завести secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DB_HOST/USER/PASSWORD/NAME` — джоба `deploy` в `.github/workflows/deploy.yml`

### 📱 Новые фичи (июль 2026)
- **Background GPS + Geofence** — 5min polling, PUT/GET /api/location, Capacitor geolocation
- **Disappearing Messages (TTL)** — таймер самоудаления 5s-24h, WS cleanup каждые 10s, Popover-селектор
- **Video Date Scheduling** — предложение/принятие/отклонение дат с календарём, WS sync
- **Profile Score** — рейтинг полноты анкеты (0-100), бейдж на странице профиля + рекомендации
- **CI/CD** — GitHub Actions: lint → frontend test → server test (MySQL) → E2E → deploy
- **Load Testing (k6)** — ramp-up до 100 пользователей, 6 endpoints
- **Monitoring** — Prometheus (`:9090`) + Grafana (`:3001`), HTTP/DB/WS/cache метрики

### 📱 Capacitor Android
- Нативная камера (`@capacitor/camera`), файлы (`@capacitor/filesystem`), Preferences
- Адаптер fetch/WS для нативного режима (`src/lib/native.ts`)
- Live Reload на устройстве через `npx cap run android --livereload`

---

## Что осталось до продакшена

### 🔴 Требует реальных ключей (код готов, без env не работает)

| Переменная | Файл | Назначение |
|---|---|---|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `server/.env` | Реальные платежи (без ключа — mock в dev, 502 в prod) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | `server/.env` | Email (регистрация, сброс пароля) |
| `SENTRY_DSN` | `server/.env` + `.env` | Мониторинг ошибок |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_ENDPOINT` | `server/.env` | Облачное хранение файлов + Rekognition-модерация фото (без — локальный диск, варианты и модерация отрабатывают через temp) |
| `OPENAI_API_KEY` | `server/.env` | AI Icebreakers + AI-модерация текста (без — fallback БД/эвристика) |
| `FCM_SERVER_KEY`, `FCM_SERVICE_ACCOUNT` | `server/.env` | Push-уведомления Android (без — mock) |
| `REVENUECAT_WEBHOOK_SECRET` | `server/.env` | IAP webhook (без — 503, приём событий отключён) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | `server/.env` | SMS-верификация (без — mock) |
| `REDIS_URL` | `server/.env` | Кэш + Bull Queue (email/push/image) + Socket.IO adapter (без — всё off, in-memory) |
| `DB_PASSWORD` | `server/.env` | Непустой пароль для MySQL |
| `CORS_ORIGIN` | `server/.env` | Домен прода (вместо `localhost:8081`) |
| `NODE_ENV=production` | `server/.env` | Отключает Stripe mock, Sentry sampling 0.1 |

### ✅ Реализовано (без внешних ключей)

| Фича | Файлы | Статус |
|------|-------|--------|
| **Ghost Mode** (инкогнито + premium gate) | `profile.js`, `social.js`, `settings-privacy.tsx`, миграция 009 | ✅ |
| **Passport Mode** (показ в другом городе + premium gate) | Те же файлы, что Ghost Mode | ✅ |
| **GDPR Compliance** (data export, erase, consent) | `routes/gdpr.js`, миграция 010, UI в settings-privacy | ✅ |
| **AI Icebreakers** (чипы первого сообщения) | `icebreakers.js`, `chats.tsx`, миграция 018 | ✅ |
| **A/B Testing + Product Analytics** | `experiments.js`, `useExperiment.ts`, `admin-experiments.tsx`, миграция 019 | ✅ |
| **API Versioning** (`/api/v1` + X-API-Version) | глобальный middleware в `index.js` | ✅ |
| **Video Date Scheduling** | `schedule.js`, `schedule.tsx`, WS `schedule:updated`, миграции 013/015, E2E ✅ | ✅ |
| **Safety Check-in** (экстренные контакты) | `date-checkin.js`, миграция 015, E2E ✅ | ✅ |
| **Profile Score** | `profile.js` PUT `/api/profile/score`, миграция 014, E2E ✅ | ✅ |
| **GDPR Consent flow** | чекбокс регистрации + `consent_log` + тумблер настроек (этап 7) | ✅ |

### 🟠 Код готов — ждут ключи API

| Задача | Ключи |
|--------|-------|
| Push FCM для Android | `FCM_SERVER_KEY` |
| Deep Links | Настроить домен + SHA256 |
| RevenueCat IAP | Webhook secret + проект |
| SMS-верификация (Twilio) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` |
| AI-модерация фото | `OPENAI_API_KEY` или AWS Rekognition |
| CDN для фото | S3 bucket + AWS keys |

### 🟢 Ещё не начато

- AI Icebreakers (OpenAI в чаты) — ✅ сделано, fallback из БД без ключа OpenAI
- A/B Testing + Product Analytics — ✅ сделано (таблицы experiments, assign/track API, админка)
- API Versioning — ✅ сделано (`/api/v1` alias)
- Design System/Storybook

---

## Структура

| Папка/Файл | Назначение |
|------------|-----------|
| `server/` | API на Express + MySQL (auth, profile, social, chats, premium, reports, referral, admin) |
| `server/src/routes/admin/` | Админка (dashboard, users, analytics, reports, content, features, messaging, monetization) |
| `server/src/ws.js` | Socket.IO (чат, уведомления, онлайн-статус) |
| `server/src/queue.js` | Bull Queue (email/push/image фоновые задачи) |
| `server/src/jobs/` | Процессоры очередей (email.job.js, push.job.js, image.job.js) |
| `server/src/redis.js` | ioredis lazy client (3 клиента: main/pub/sub) |
| `server/src/audit.js` | Soft delete + audit log helpers |
| `server/src/seed.js` | Генератор тестовых данных (50 users, 30 matches, 200 msgs) |
| `server/src/routes/report.js` | POST /api/reports + auto-ban escalation |
| `server/src/routes/referral.js` | Реферальная система (code, apply, stats) |
| `src/` | Фронтенд на React + Vite + Tailwind |
| `database/` | `mysql_schema.sql` + `demo_data.sql` + `migrations/` (23 миграции) |
| `server/src/routes/gdpr.js` | GDPR API (data export, erase, consent logging) |

## Резервное копирование MySQL

Скрипты в `scripts/`:

### Windows (PowerShell)
```powershell
# Единоразово
.\scripts\backup-mysql.ps1 -DbName swiftmatch -DbUser root

# Установить задачу в планировщик (ежедневно в 3:00)
# Запусти install-backup-task.bat от имени Администратора:
.\scripts\install-backup-task.bat
```

### Linux / Docker
```bash
# Тестовый запуск
./scripts/backup-mysql.sh swiftmatch root

# Cron (ежедневно в 3:00)
crontab -l | { cat; echo "0 3 * * * /path/to/swiftmatch1bd/scripts/backup-mysql.sh swiftmatch root '' localhost 3306 /path/to/backups 7 >> /var/log/swiftmatch-backup.log 2>&1"; } | crontab -
```

Бэкапы сохраняются в `backups/swiftmatch_YYYY-MM-DD_HHmmss.sql`, автоматически удаляются через 7 дней.

## Capacitor Android

Нативное Android-приложение через Capacitor (WebView + нативные плагины).

### Структура
- `android/` — Gradle-проект (в git)
- `capacitor.config.ts` — конфиг (appId `com.swiftmatch.app`, webDir, cleartext для LAN-тестов)
- `src/lib/native.ts` — адаптер fetch/WS для нативного режима
- `@revenuecat/purchases-capacitor` — IAP-клиент (`src/lib/iap.ts`)

### Требования
- Android Studio + SDK (platform 35/36, build-tools 35) — ставятся через cmdline-tools
- **JDK 21** (Temurin): Gradle 8.14.3 не работает на JBR Java 25 из Android Studio
- AGP 8.13.2, compileSdk 36

### Сборка APK (проверено, APK собирается)
```powershell
npm run build            # или с VITE_API_URL=http://<LAN-IP>:3002 для теста на устройстве
npx cap sync android     # из корня; подтягивает capacitor-cordova-android-plugins
# строго из папки android/ (Gradle берёт root от CWD):
$env:JAVA_HOME="<путь к JDK 21>"; android\gradlew.bat :app:assembleDebug
# → android\app\build\outputs\apk\debug\app-debug.apk
```
> Грабля: если `compressDebugAssets` падает с «Failed to create MD5 hash ...jar as it does not exist» — прогнать задачу standalone (`gradlew :app:compressDebugAssets`), затем полный `assembleDebug`. Детали в AGENTS.md (#29).

Для релиза: домен вместо LAN-IP, подпись keystore, ключ RevenueCat в .env, App Links.

### Live Reload (отладка на устройстве)
Запустить на ПК:
```bash
npm run dev
```
В другом терминале (устройство в той же сети):
```bash
npx cap run android --livereload=http://192.168.x.x:8081 --open
```

### Нативные фичи
- **Камера**: `@capacitor/camera` — нативный UI фото/видео
- **Файлы**: `@capacitor/filesystem`
- **Хранилище**: `@capacitor/preferences` + sessionStorage/localStorage для JWT (Bearer)
- **IAP**: RevenueCat (`VITE_REVENUECAT_API_KEY`)
- **Пуши**: VAPID-ключи в `server/.env` готовы

### Как это работает
На сервере строгий CORS_ORIGIN (для нативных сборок авторизация идёт через Bearer-заголовок, не cookie).
В нативном режиме `src/lib/native.ts` перехватывает все `fetch('/api/...')` и подставляет `VITE_API_URL`.
WebSocket в `use-websocket.ts` использует `VITE_WS_URL` или `wss://swiftmatch.app`.

---

## Настройка .env

Быстрый старт: `powershell -File scripts\setup.ps1` — скопирует `.env.example` → `.env`, сгенерирует `JWT_SECRET`, установит зависимости.

`server/.env` уже настроен для локальной работы:
```
PORT=3002
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=swiftmatch
CORS_ORIGIN=http://localhost:8081
REDIS_URL=redis://127.0.0.1:6379
VAPID_PUBLIC_KEY=BEygaffoNfy9XaaH0QqILW1Kzuf-7WoVL4oAvQpC1ebFkZ8X828d8Fv8TXcqBuykDK4IWJdZMA6TOkQfSBP8N8o
VAPID_PRIVATE_KEY=b370faewrsuKX2yUXBZ-2-axZiScdesTmpXHPq0yJN4
```
