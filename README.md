# SwiftMatch — приложение для знакомств

React + Express + MySQL, реальный-time (Socket.IO), нативная сборка под Android
(Capacitor). Репозиторий `elips0675-web/swiftmatch1bdnoutprodpart` — он же
источник прод-деплоя: `.github/workflows/deploy.yml` по пушу в `main` делает
rsync на VPS и `docker compose up -d --build`.

Изначально репозиторий был локальной копией с **реальной** MySQL-БД (а не
Supabase), с портами 3002/8081, чтобы не мешать основной версии на 3001.
Сейчас это продакшен-ветка: деплой, миграции, бэкапы и аудиты — в одном месте.

---

## На чём собрано

Версии — из `package.json`, `server/package.json`, `docker-compose.yml`,
`Dockerfile` и обоих workflow. Числа тестов проверяет гейт
`scripts/test-counter-audit.mjs` (перезапускает vitest и сверяет с документацией),
поэтому расхождение с прогоном ловится в CI, а не «глазами».

### Фронтенд — `src/`

| Слой | Технология | Версия |
|------|-----------|--------|
| Сборка | Vite | 8.0.16 |
| UI-библиотека | React / React DOM | 18.3.1 |
| Язык | TypeScript (strict, без `any`) | 5.9.3 |
| Стили | Tailwind CSS + shadcn/ui (Radix UI) | 3.4.19 |
| Серверное состояние | TanStack Query | 5.101.0 |
| Роутинг | react-router-dom | 6.30.4 |
| Real-time | socket.io-client | 4.8.4 |
| Формы | React Hook Form + resolvers | 7.78.0 |
| Анимации | framer-motion | 12.40.0 |
| Графики | recharts | 3.8.1 |
| Мониторинг | @sentry/react | 9.14.0 |
| Тесты | vitest + @testing-library/react + jsdom | 3.2.6 / 16.3.2 / 20.0.3 |
| Линт | ESLint 9 + typescript-eslint | 9.39.4 / 8.61.0 |

### Бэкенд — `server/`

| Слой | Технология | Версия |
|------|-----------|--------|
| Runtime | Node.js | 22 (образ `node:22-alpine`) |
| HTTP | Express | 4.21.0 |
| Real-time | Socket.IO (+ Redis adapter) | 4.8.4 / 8.3.0 |
| БД | MySQL через mysql2 | 8.x (образ `mysql:8`) / 3.11.0 |
| Кэш и очереди | ioredis + Bull | 5.11.1 / 4.16.5 |
| Аутентификация | jsonwebtoken + otplib + bcryptjs | 9.0.2 / 13.5.0 / 2.4.3 |
| Платежи | Stripe (Checkout + webhooks) | 22.3.0 |
| Рассылка | Nodemailer + web-push + Twilio | 10.0.13 / 3.6.7 / 6.0.2 |
| Модерация | OpenAI API + AWS Rekognition | 7.5.0 / 3.1131.0 |
| Фото | multer + sharp + S3 SDK | 2.4.0 / 0.35.4 / 3.800.0 |
| Метрики | prom-client | 15.1.3 |
| API-документация | swagger-jsdoc + swagger-ui-express | 6.3.0 / 5.0.1 |
| Тесты | vitest + supertest | 4.1.9 / 7.2.2 |

### Инфраструктура

| Слой | Что | Версия / порт |
|------|-----|---------------|
| MySQL | локально Laragon на **3306**, в compose образ `mysql:8` на **3307** | 8.x |
| Redis | `redis:7-alpine` | 6379 |
| Reverse proxy | nginx (в compose) | 1.27-alpine, хост-порт 8080 |
| Мониторинг | Prometheus / Grafana | 9090 / 3001 |
| Пуш в Android | Capacitor 8 + камера/файлы/гео/преferences/push + AdMob + RevenueCat | 8.4.1 |
| Нагрузочное тестирование | k6 (`k6/load-test.js`) | — |

> `mysql:8` в compose слушает **3307**, чтобы не конфликтовать с локальным MySQL
> Laragon на 3306. Локально фронт и API ходят на 3306 (Laragon), в контейнерах —
> на 3307.

---

## Быстрый старт

### Вариант 1 — одним батником (Windows)

```bat
запуск-всего.bat
```

Поднимает MySQL (Laragon, 3306) → API (3002) → фронт в **production-режиме**
(`vite build` + `vite preview`, 8081) и открывает браузер. Пути внутри батника
относительные (`%~dp0`) — репозиторий можно переносить.

> Фронт намеренно **не** dev-сервер: в dev первый заход в админку тормозил
> горячей компиляцией модулей (~2.6 с). `vite preview` работает как прод без
> on-demand компиляции, а `vite.config.ts` описывает `preview.proxy` для `/api`
> и `/socket.io`. Нужен HMR — запускайте `npx vite` вручную.

### Вариант 2 — вручную

```bash
# 1. БД
mysql -u root swiftmatch < database/mysql_schema.sql
mysql -u root swiftmatch < database/demo_data.sql
node database/migrations/migrate.js        # применить миграции сверх схемы

# 2. API (строго из server/, иначе dotenv не подхватит .env)
cd server && npm install && node src/index.js     # → http://localhost:3002

# 3. Фронт
npm install
npx vite build && npx vite preview --port 8081 --host   # → http://localhost:8081
```

### Порты

| Сервис | Порт | Где |
|--------|------|-----|
| API (Express) | 3002 | локально и в контейнере |
| Фронт | 8081 | `vite preview` |
| MySQL | 3306 (Laragon) / 3307 (compose) | — |
| Redis | 6379 | — |
| nginx (compose) | 8080 → 80 | только в Docker |
| Prometheus / Grafana | 9090 / 3001 | только в Docker |

Vite проксирует `/api` и `/socket.io` на `http://localhost:3002` — несоответствие
портов даёт 502.

### Демо-доступы

| Email | Пароль | Роль |
|-------|--------|------|
| `admin@mail.ru` | `demo123456` | Админ |
| `user2@mail.ru` | `demo123456` | Обычный пользователь |
| `user4@mail.ru` … `user50@mail.ru` | `demo123456` | 47 демо-пользователей |
| `user1@mail.ru` | `demo123456` | Забанен (is_active=0) |

> После `git pull` запустить `node server/src/seed.js`, если добавились новые
> demo-пользователи.

---

## Команды и гейты

Все гейты блокирующие: каждый из них уже ловил реальный дефект, а не «для
галочки». Запуск перед коммитом:

```bash
npx tsc --noEmit                 # типы, strict
npx eslint src/                  # линт фронта
npx vite build                   # прод-сборка
npm test                         # фронт-тесты
cd server && npm test            # серверные тесты
```

| Гейт | Команда | Что ловит |
|------|---------|-----------|
| Дрейф схемы | `node scripts/schema-drift-audit.mjs --offline` | колонка, которую читает код, есть в `database/mysql_schema.sql`, но её не создаёт ни одна миграция → живой 500 (стоило 500 на `/profile/edit`). В CI — джоба `schema-drift` в `ci.yml` |
| Дрейф схемы (на БД) | `node scripts/schema-drift-audit.mjs` (нужен `MYSQL_BIN`) | то же + сверка с **живой** MySQL. **В CI не подключён**: `server-test` в `deploy.yml` гоняет `schema-validate`, а не live-дрейф — гейт живёт только локально (в бэклоге, E1) |
| Секреты | `node scripts/secrets-leak-audit.mjs` | `.dockerignore` пропускает `server/.env`/`.jwt-dev-secret`; rsync без `--exclude .env` стирает прод-`.env`; **значение секрета, вписанное в отслеживаемый файл** (был VAPID-ключ в `README.md`) |
| Персистентность деплоя | `node scripts/deploy-persistence-audit.mjs` | каталог записи фото не смонтирован volume'ом → `docker compose up --build` удаляет все фото; сверяет путь из кода с compose |
| Счётчики тестов | `node scripts/test-counter-audit.mjs` (`--fix` переписывает) | числа тестов в `README.md`, `project-context.md`, `test/README.md`, `test/project-context.md`, `test/ИНВЕНТАРЬ-ТЕСТОВ.md` разошлись с прогоном |
| Уязвимости prod-зависимостей | `npm run audit:prod` (корень и в `server/`) | `npm audit --omit=dev --audit-level=high` по обоим lock-файлам: в образ едет только прод-часть |
| Порты и ключи | `npm run check:ports` | порты vite/proxy/`.env`/`CORS_ORIGIN` + `console.log` в `server/src` |
| Конфиг Android | `node scripts/check-native-config.mjs` | cleartext для native-сборок |
| EXPLAIN всех SQL | `node scripts/sql-explain-audit.mjs` (нужна БД) | запросы без индекса |
| Мохибейк | `node scripts/scan-mojibake.mjs` | сломанная кодировка в текстах (локально, в CI не подключён) |
| Обязательность E2E | `npm run check:e2e` | джобы `e2e` в `ci.yml` нет / у неё `continue-on-error` или `if:` / триггер ограничен ветками / `deploy` не зависит от `e2e-test`; рецепт без сида демо-данных, без миграций, без `vite preview --strictPort`, с `sleep` вместо `wait-for-url.mjs`, без `upload-artifact`; команды Playwright в двух workflow разошлись |
| Целостность зависимостей | `npm run check:deps` | необъявленный импорт (в т.ч. `import()`) или мёртвая runtime-зависимость в `package.json` |
| Раскладка документации | `npm run check:docs` | `Промты.txt` снова стал источником правил (шапка пропала, вернулись разделы 0–20 или 21–34); битая ссылка в таблице канона; `docs/product-roadmap.md` потерял один из 14 разделов идей, похудел или набрал чужих правил; запрещённые формулировки (правила `admin-auth-passive` и `zod-version-claim`, буквальные примеры — в `hint` гейта) в отслеживаемых `.md`/`.txt`; архив `context.txt` без пометки «ИСТОРИЧЕСКИЙ СРЕЗ», без даты среза и без ссылки на канон; гейт не вызывается из `ci.yml`/`deploy.yml`, джоба переименована или помечена `continue-on-error`/`if: false` |
| SQL внутри цикла | `npm run check:n-plus-one` | `pool.query`/`conn.execute` в теле цикла по коллекции → 51 запрос вместо 2 (рассылка уведомлений об отмене встречи делала по два запроса на участника, профиль — по INSERT на интерес); **протухшее оправдание** из `JUSTIFIED` (номер строки разошёлся с кодом, якорь `expect` не найден); оправдание без якоря; гейт не вызван из `ci.yml`/`deploy.yml` (этап 33) |

Каждый гейт обязан падать на сломанном входе — иначе это декорация
(см. `docs/AGENTS-pitfalls.md`).

### Тесты

- **Фронтенд (Vitest):** 358 тестов, 32 файла — **0 failures**
- **Сервер (Vitest):** 785 тестов, 55 файлов — **0 failures** (включая cookie-auth, rotation, lockout, sanitize, дрейф схемы)
- **E2E (Playwright):** 150 тестов, 19 spec-файлов — живой прогон требует стек 3002/8081/3306; после прогона `globalTeardown` чистит `e2e_*`/`layout_*` из БД

### Зависимости

`npm run audit:prod` = `npm audit --omit=dev --audit-level=high`. Флаги
обязательны: без `--omit=dev` считается dev-дерево, которого в проде нет, без
`--audit-level=high` гейт краснеет на moderate/low, которые чинятся только
мажорными обновлениями. Сейчас: **0 critical, 0 high** (корень — 2 moderate,
`server/` — 25 moderate; остаток: `@sentry/node`, `firebase-admin`, `bull`/`uuid`,
`react-router-dom` 6 → 7). Аудить надо **оба** lock-файла: в контейнер едут обе
половины.

---

## CI/CD

Два workflow. Каждый гейт выше подключён хотя бы в одном из них.

### `.github/workflows/ci.yml` — на **любой** push и PR (Node 20)

| Джоба | Что делает |
|-------|-----------|
| `lint` | `tsc --noEmit` → `eslint src/` → `vite build` |
| `lint-server` | `eslint` по `server/src` (этап 29) |
| `e2e` | **обязательный E2E на любом push/PR** (этап 30): MySQL 8.0 сервис → схема → `seed-migrations` → `migrate.js` → **`server/src/seed.js`** → API 3002 + `vite preview --strictPort` 8081 → `wait-for-url` → `npm run test:e2e` → `upload-artifact` при `always()` |
| `e2e-gate` | `npm run check:e2e` — E2E-джоба обязательна, рецепт способен стать зелёным, команды Playwright в двух workflow совпадают |
| `test` | фронт-тесты (vitest) |
| `test-server` | серверные тесты (vitest, без БД) |
| `schema-drift` | `schema-drift-audit.mjs --offline` |
| `secrets-leak` | `secrets-leak-audit.mjs` |
| `test-counters` | `test-counter-audit.mjs` (нужны оба `node_modules`) |
| `deploy-persistence` | `deploy-persistence-audit.mjs` |
| `dependency-audit` | `npm run audit:prod` в корне и в `server/` (без `npm ci` — аудиту нужен только lock-файл) |
| `docs-canon` | `npm run check:docs` — раскладка документации: правила только в `docs/AGENTS-*.md`, идеи 21–34 в `docs/product-roadmap.md`, архив помечен, запрещённых формулировок в отслеживаемых `.md`/`.txt` нет (этап 32) |
| `n-plus-one` | `npm run check:n-plus-one` — SQL внутри цикла по коллекции (2N запросов вместо 2) + протухшие оправдания `JUSTIFIED` (этап 33, N5) |

### `.github/workflows/deploy.yml` — push в `main`/`develop`, PR в `main` (Node 22)

| Джоба | Что делает |
|-------|-----------|
| `lint-and-typecheck` | `check:ports` → `lint` → `lint:server` → `tsc` → **`secrets-leak`**, **`deploy-persistence`**, **`audit:prod` ×2**, **`check:e2e`**, **`check:docs`**, **`check:n-plus-one`** (блокируют деплой) |
| `frontend-test` | витест + `check-native-config` + `vite build` |
| `server-test` | MySQL 8.0 сервис: схема → `seed-migrations` → `migrate.js` → `schema-validate` → `sql-explain-audit` → `verify-backup` → витест с живой БД |
| `test-counters` | сверка чисел с прогоном |
| `e2e-test` | Playwright на поднятом стеке (needs: lint, frontend, server) + выгрузка отчёта; с этапа 30 рецепт идентичен `e2e` в `ci.yml` (сид демо-данных, `wait-for-url` вместо `sleep`, `vite preview --strictPort`) |
| `docker-config-check` | `docker compose config` + сборка образов `server`/`web` + Trivy (сейчас `exit-code: 0`, режим baseline) |
| `deploy` | **только push в `main`**: rsync на VPS (с `--exclude .env`, `uploads`, ключи) → `docker compose up -d --build` → `migrate.js` → `schema-validate.mjs` |

`deploy` в `needs`: `lint-and-typecheck`, `frontend-test`, `server-test`,
`e2e-test`, `test-counters`.

> Расхождение, которое стоит знать: `ci.yml` гоняет тесты на Node **20**,
> `deploy.yml` и образ — на Node **22**. Продовый рантайм — 22, это же значение
> стоит перенести в `ci.yml` (в бэклоге, P1).

---

## Функционал

### 👤 Пользовательский опыт
- Регистрация, анкета, лайки, мэтчи, чаты — полный цикл знакомств
- Геопоиск по радиусу (MySQL Spatial `ST_Distance_Sphere`)
- Smart Matching: interest overlap + age distance + compatibility + activity
- Attachment-тест для психологической совместимости
- Системные и push-уведомления (Service Worker + VAPID)
- 50 демо-пользователей для тестирования (`npm run db:seed` в `server/`)
- i18n (русский / английский): в БД и state — translation keys, UI через `t()`

### 💳 Монетизация
- **Stripe Checkout** — тарифы Plus / Gold / Platinum, длительность 1/6/12 мес.
- **Idempotency-Key middleware** — защита от двойных списаний
- `STRIPE_LIVE` — при `true` mock отключается; без ключа в prod → 502 «not configured»
- **Premium-гейтинг:** лимит 10 лайков/день для free, скрытые просмотры
- **Реклама:** фича-флаг `showAds`, конфиг AdMob/Yandex в БД, динамический импорт с `setTimeout`-fallback
- **Админка:** управление ценами и рекламными блоками

### 🛠️ Админ-панель
- Дашборд со статистикой (пользователи, активность, матчи, выручка, подписки)
- Аналитика: retention, revenue-mix, регистрации (`/analytics/overview`, `/retention`, `/revenue-mix`, `/registrations`)
- Пользователи: поиск, фильтры, бан/разбан, массовые операции, имперсонация
- Фича-флаги: toggle'и, хранятся в БД (с валидацией пустого body)
- Модерация: жалобы, запрещённые слова, история действий
- Контент: интересы, цели знакомств
- **A/B-тесты:** `/admin/experiments`, стабильный assign 50/50 по MD5, трекинг событий
- **Единый гейт:** все `/api/admin/*` (кроме публичного `GET /api/admin/features`) проходят `adminAuth` и отвечают 401/403

### 💬 Социальные функции
- Real-time чаты через **Socket.IO** с typing indicator и read receipts
- Emoji-реакции (happy / love / sad / angry / like)
- Онлайн-статус (зелёная точка) через WebSocket
- Группы по интересам: категории, посты, комментарии, лайки
- **AI Icebreakers:** чипы первого сообщения (`POST /api/icebreakers/suggest` — OpenAI или fallback из БД, RU/EN)
- Блокировка пользователей: применяется и в фиде, и на прямом `GET /api/profile/:id`

### 🔐 Безопасность и инфраструктура
- JWT в **httpOnly cookie** (`sm_token` 24h + `sm_refresh` 7d, SameSite=Lax, Secure в prod); мидлвари читают `Bearer ?? cookie` (`server/src/cookies.js`); `POST /api/auth/logout` чистит куку и refresh-токены
- **Refresh rotation + reuse detection:** ротация в пределах `family_id`, replay отзывает всю семью, параллельный refresh защищён атомарным claim'ом
- **Revoke all sessions:** `POST /api/auth/logout-all`; смена пароля отзывает все сессии
- **Account lockout:** 5 неудачных логинов → 429 на 15 мин (`server/src/lockout.js`)
- **Санитизация ввода:** свободный текст (bio, имена, посты, сообщения) хранится без HTML-тегов (`server/src/sanitize.js`)
- **Sentry:** `@sentry/react` + `@sentry/node`, `beforeSend` фильтрует PII
- **Helmet:** CSP, X-Frame-Options, X-Content-Type-Options и др.
- **Request ID:** UUID на запрос, `X-Request-Id` в ответе
- **Rate limiting:** express-rate-limit (лайки, auth) + лимитер `/api` (600 req/мин на IP) + nginx `limit_req`
- **Модерация чатов:** banned-слова при отправке сообщений
- Бан пользователя + WS `user:banned` (мгновенный разлогин)
- **Версионирование API:** `/api/v1/*` → `/api/*` + заголовок `X-API-Version: v1`
- CORS: строгий `CORS_ORIGIN` (fail-fast без него в production)
- **Прод-`.env` переживает деплой:** rsync исключает `.env`; `middleware.js` в production отвергает плейсхолдеры и секреты короче 32 символов

### 📁 Загрузка файлов
- MIME-фильтр: только `image/*` + whitelist (.jpg, .jpeg, .png, .gif, .webp), лимит 10MB
- **S3 scaffold:** lazy-init — при `AWS_*` в env → `@aws-sdk/client-s3` + `multer-s3`, иначе локальный диск
- Каталог фото переживает пересоздание контейнера (именованный volume `uploads_data`)

### 🗄️ База данных
- MySQL через mysql2, пул соединений
- **Миграции:** `database/migrations/` — 51 пронумерованный `.sql` + `migrate.js` (таблица `_migrations`)
- Эталон схемы: `database/mysql_schema.sql` (его и сверяет дрейф-аудит)

### 📧 Коммуникации
- **SMTP:** Nodemailer с retry (3 попытки, backoff 1s/2s/3s), graceful skip без ключей
- Push через VAPID + web-push
- **Email-кампании:** массовая рассылка из админки (`POST /api/admin/campaigns`)

### 🛡️ Модерация и репорты
- **AI-модерация:** OpenAI Moderation + AWS Rekognition + regex banned-words
- **Auto-escalation:** 1 report → pending, 3+ → temp ban, 5+ → permanent ban

### 📋 Аудит и soft delete
- **Soft delete:** `deleted_at` в 13 таблицах (`006` + `043`), запись только через `softDelete`/`softDeleteWhere` (`server/src/audit.js`), чтение — предикат `activeUser()`
- **Audit log:** `softDelete` и массовый `softDeleteWhere` пишут `audit_log` (кто, что, когда)

### 🏥 Health Checks
- `GET /health` (`server/src/index.js:307`) — единственный health-эндпоинт: `SELECT 1` → `200 {status:'ok', db:'connected'}`, при ошибке БД → `503 {status:'error', db:'disconnected'}`. Отдельных `/health/live` и `/health/ready` в проекте **нет**
- Graceful shutdown по `SIGTERM` (`index.js:337`): `closeQueues()` → `disconnectRedis()` → `pool.end()` → `httpServer.close()`. `SIGINT` и сторожевой таймаут **не** обрабатываются — см. бэклог
- В контейнере у nginx есть `location = /healthz` (`nginx/swiftmatch.http.conf:24`) — это балансировщик/healthcheck, не API

### 💾 Redis
- **Кэш** (профиль 60s, matches 30s per-user), **Bull Queue** (email/push/image), **Socket.IO Redis adapter**
- Graceful fallback без Redis: in-memory, без 500 на всех роутах

### 🎁 Реферальная система
- Уникальный referral_code, трекинг приглашений и премиум-конверсий
- `GET /api/referral/code`, `POST /api/referral/apply`, `GET /api/referral/stats`

### ⚙️ Фоновые задачи (Bull Queue)
- **3 очереди:** email (retry), push, image (Sharp → WebP/AVIF)
- **Fallback** без Redis: прямой вызов или лог

### 🔄 WebSocket
- Socket.IO, pingInterval 10s / pingTimeout 5s
- **Redis Adapter** — горизонтальное масштабирование
- WebRTC сигналинг (call-user, ice-candidate, end-call)

### 📍 Геопоиск
- **MySQL Spatial:** POINT SRID 4326 + SPATIAL INDEX, `ST_Distance_Sphere` (везде prepared statements)
- Миграция `005_add_spatial_location.sql`

### 🐳 DevOps
- **Docker:** multi-stage (`node:22-alpine` → `nginx:1.27-alpine`), healthcheck, non-root, `.dockerignore`, `restart: unless-stopped`
- **Docker Compose:** app + nginx + MySQL + Redis + Prometheus + Grafana, именованные volume'ы
- **Nginx в контейнере** (`nginx/swiftmatch.http.conf` — единственный, что копируется в образ, `Dockerfile:30`): `limit_req` 60r/s на `/api` и 10r/s на `/api/auth`, `client_max_body_size 20M`, WebSocket `proxy_read_timeout 86400s`, `location = /healthz`, SPA fallback
- **Nginx на VPS** — файла два, и **они расходятся между собой**: `nginx/swiftmatch.conf` (TLS 443, редирект с 80, `limit_req` 30r/s/5r/s, 20M, 86400s) и корневой `nginx.conf` (TLS 443, редирект с 80, `proxy_read_timeout 60s`, **без** `limit_req` и без `client_max_body_size`). Ни один в образ не попадает; какой из двух применять на сервере — в бэклоге (P2)
- **Мониторинг:** Prometheus-метрики (HTTP rps, p50/p95/p99, DB, WS, cache) + Grafana
- **Load Testing:** `k6/load-test.js` (ramp-up 10→100 users, 6 endpoints)
- **Git hooks:** Husky + lint-staged (ESLint + Prettier на staged)
- **Логирование:** Winston (JSON: timestamp/level/msg/rid)

---

## Чек-лист запуска продакшена

1. **Ключи:** заполнить `server/.env` по `server/.env.example` (в контейнере
   compose читает **корневой** `.env`, `docker-compose.yml:83`) и проверить
   `powershell -File scripts/check-keys.ps1` — скрипт читает `server/.env`,
   проверяет 18 ключей (Stripe, SMTP, FCM, RevenueCat, Twilio, OpenAI, Sentry,
   AWS/S3, Redis) и отдельно помечает `JWT_SECRET` как `!REQUIRED!`; без
   `DB_PASSWORD`/`CORS_ORIGIN` в списке он не смотрит — их проверяет
   `middleware.js` в production
2. **Миграции:** `node database/migrations/migrate.js` (или через CI)
3. **Проверка:** `node scripts/secrets-leak-audit.mjs` → `npm test` (server) →
   `npx vitest run` (фронт) → `npx playwright test` → `npx vite build`
4. **Запуск:** `cd server && node src/index.js` (строго из `server/`); в проде —
   pm2/systemd или контейнер
5. **Без ключей сервис деградирует, но жив:** Stripe → 502 «not configured»,
   OpenAI → fallback из БД, пуши/SMS → mock, письма → лог, S3 → локальный диск
6. **CI-deploy:** завести ровно три секрета — `DEPLOY_HOST`, `DEPLOY_USER`,
   `DEPLOY_SSH_KEY` (`deploy.yml:361-370`, rsync + SSH). Переменные БД в
   секретах GitHub не нужны: миграции на VPS берут их из `server/.env`

Полный чеклист — `docs/AGENTS-production.md` (DoD + Pre-flight, 10 пунктов).

### Требует реальных ключей

| Переменная | Назначение |
|-----------|-----------|
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | реальные платежи (без ключа — 502 в prod) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | email (регистрация, сброс пароля) |
| `SENTRY_DSN` | мониторинг ошибок |
| `AWS_*`, `S3_BUCKET`, `S3_ENDPOINT` | S3-хранилище фото + Rekognition (без — локальный диск) |
| `OPENAI_API_KEY` | Icebreakers + AI-модерация (без — fallback) |
| `FCM_SERVER_KEY`, `FCM_SERVICE_ACCOUNT` | push Android (без — mock) |
| `REVENUECAT_WEBHOOK_SECRET` | IAP webhook (без — 503) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` | SMS (без — mock) |
| `REDIS_URL` | кэш + очереди + Socket.IO adapter (без — in-memory) |
| `JWT_SECRET` | подпись токенов; в prod обязателен и ≥32 символов |
| `CORS_ORIGIN` | домен прода (вместо `localhost:8081`) |
| `NODE_ENV=production` | отключает Stripe mock, Sentry sampling 0.1 |

> **VAPID-ключи генерируются локально:** `npx web-push generate-vapid-keys` →
> `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` в `server/.env` и
> `VITE_VAPID_PUBLIC_KEY` на фронте. Значения ключей **никогда** не пишутся в
> репозиторий — это проверяет `scripts/secrets-leak-audit.mjs`.

---

## Структура репозитория

| Папка/Файл | Назначение |
|------------|-----------|
| `src/` | Фронтенд: страницы, компоненты, хуки, `lib/api.ts` |
| `server/src/routes/` | API: auth, profile, social, hangouts, chats, premium, reports, referral, admin |
| `server/src/routes/admin/` | Админка: dashboard, users, analytics, reports, content, features, messaging, monetization |
| `server/src/ws.js` | Socket.IO: чат, уведомления, онлайн-статус |
| `server/src/queue.js`, `server/src/jobs/` | Bull Queue и процессоры (email/push/image) |
| `server/src/redis.js` | ioredis lazy client (main/pub/sub) |
| `server/src/audit.js` | soft delete + audit log |
| `server/src/seed.js` | Генератор демо-данных (50 users, 30 matches, 200 msgs) |
| `database/` | `mysql_schema.sql` + `demo_data.sql` + `migrations/` (51 SQL) |
| `scripts/` | Гейты и утилиты (аудит схемы/секретов/счётчиков/персистентности, бэкап, EXPLAIN) |
| `e2e/` | Playwright-спеки (19) |
| `android/` | Capacitor/Gradle-проект |
| `k6/` | Нагрузочный сценарий |
| `docs/` | Инструкции по модулям (см. ниже) |

---

## Документация: что где правда

| Файл | Что это | Актуальность |
|------|---------|--------------|
| `AGENTS.md` | Правила проекта для ИИ-агента: порты, стек, гейты, требования владельца, Git/CI | правило проекта, читается всегда |
| `docs/AGENTS-*.md` | Модули правил: production-чеклист, pitfalls, workflow, i18n, admin-auth, startup, security, deployment, system-prompt | правила, не «отчёт о прогоне» |
| `README.md` | Этот файл: стек, запуск, гейты, CI, функционал | числа тестов проверяет `test-counter-audit` |
| `project-context.md` | Сводный срез по проекту | счётчик проверяет гейт |
| `docs/architecture.md`, `docs/past-mistakes.md` | Архитектура и разбор прошлых ошибок | справочно |
| `docs/roadmap.md` | Журнал этапов до 06.09.2026 (чистая UTF-8 сводка, отслеживается в git) | исторический журнал, сверяйтесь с `Что сделано.txt` |
| `docs/product-roadmap.md` | Продуктовые идеи: разделы 21–34 из бывшего `Промты.txt`, перенесены дословно (14 разделов, 645 непустых строк) | идеи, не «сделано»; правил не содержит — это проверяет `npm run check:docs` |
| `Промты.txt` | Указатель канона: таблица «тема → где правило» + что убрано и почему | **не источник правил**; разделы 0–20 живут в `docs/AGENTS-*.md`, идеи 21–34 — в `docs/product-roadmap.md` |
| `Что сделано.txt` | Журнал этапов: что, зачем, чем проверено | исторический журнал, числа в заголовке — срез на дату |
| `Что доделать.txt` | Бэклог: открытые P0/P1/P2 с основаниями | рабочий список |
| `context.txt` | Старый лог этапов (до `Что сделано.txt`), 992 строки | **исторический срез 26.09.2026** — в шапке баннер и отсылка к `project-context.md`; числа внутри — снимки своих дат |
| `docs/STATUS.md` | Не существует; ссылки на него помечены «файл не создан» | — |

Правило: числа тестов сначала измеряются гейтом, потом вписываются в документы.
`test/` — локальное зеркало этих же файлов (в `.gitignore`).

Раскладка (этап 32, проверяется `npm run check:docs`): **правила** — только
`AGENTS.md` и `docs/AGENTS-*.md`; **продуктовые идеи** — `docs/product-roadmap.md`;
**история** — `Что сделано.txt` и `Что доделать.txt`; **архивы** (`context.txt`,
`docs/roadmap.md`) обязаны нести в шапке дату среза и ссылку на канон.
`Промты.txt` — указатель с таблицей «тема → где правило», а не копия правил:
дублирование правил опаснее их отсутствия, потому что протухающая копия
читается как истина (этот файл и предлагал сделать `adminAuth` пассивным —
снятие защиты `/api/admin`, закрыто этапом 24).

---

## Окружение (`.env`)

Быстрый старт: `powershell -File scripts\setup.ps1` — копирует `.env.example` →
`.env`, генерирует `JWT_SECRET`, ставит зависимости.

Локальный `server/.env` (без секретов — значения по умолчанию, как в
`server/.env.example`):

```
NODE_ENV=development
PORT=3002
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_NAME=swiftmatch
CORS_ORIGIN=http://localhost:8081
REDIS_URL=redis://localhost:6379
```

> В контейнере подключение к БД подставляет **сам compose**:
> `DB_HOST=db`, `DB_USER=root`, `DB_PASSWORD=root`, `DB_NAME=swiftmatch1bd`
> (`docker-compose.yml:85-94`), и эти ключи `environment:` перекрывают
> `env_file`. Поэтому на VPS от корневого `.env` реально нужны `JWT_SECRET`
> и `CORS_ORIGIN`, остальное compose достраивает сам.

Полный список переменных с назначением — `server/.env.example` и
`docs/environment-setup.md`. Значения секретов в репозитории не хранятся:
`.env` в `.gitignore`, примеры содержат только плейсхолдеры, гейт
`secrets-leak-audit.mjs` проверяет и имена файлов, и **значения** в текстах.

---

## Резервное копирование MySQL

```powershell
# Windows (PowerShell)
.\scripts\backup-mysql.ps1 -DbName swiftmatch -DbUser root
# задача в планировщик (ежедневно 3:00) — из-под администратора:
.\scripts\install-backup-task.bat
```

```bash
# Linux / Docker: swiftmatch.sh <db> <user> <pass> [host] [port] [dir] [retention]
./scripts/backup-mysql.sh swiftmatch root '' localhost 3306 /var/backups/swiftmatch 30
0 3 * * * /path/to/swiftmatch/scripts/backup-mysql.sh swiftmatch root '' localhost 3306 /var/backups/swiftmatch 30 >> /var/log/swiftmatch-backup.log 2>&1
```

Бэкапы: `swiftmatch_YYYY-MM-DD_HHmmss.sql`, автоудаление по умолчанию через
**30 дней** (`-RetentionDays` в PowerShell, 7-й позиционный аргумент в shell).
Проверка восстановления — `scripts/verify-backup.mjs` (создаёт БД
`swiftmatch_verify_backup`, гоняется в джобе `server-test` на тестовой БД).

---

## Capacitor Android

Нативная обёртка WebView + нативные плагины.

- `android/` — Gradle-проект (в git), `capacitor.config.ts` — конфиг (appId `com.swiftmatch.app`)
- `src/lib/native.ts` — адаптер fetch/WS для нативного режима (Bearer вместо cookie)
- Плагины: камера, файлы, гео, preferences, push, AdMob, RevenueCat IAP

### Сборка APK

```powershell
npm run build                       # или с VITE_API_URL=http://<LAN-IP>:3002
npx cap sync android
# строго из папки android/ (Gradle берёт root от CWD):
$env:JAVA_HOME="<путь к JDK 21>"; android\gradlew.bat :app:assembleDebug
# → android\app\build\outputs\apk\debug\app-debug.apk
```

Требования: Android Studio + SDK (platform 35/36, build-tools 35), **JDK 21**
(Temurin) — Gradle 8.14.3 не работает на JBR Java 25.

Live reload на устройстве: `npm run dev` на ПК, затем
`npx cap run android --livereload=http://<LAN-IP>:8081 --open`.
