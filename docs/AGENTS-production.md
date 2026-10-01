# Production: Definition of Done и Pre-flight Checklist

## Golden Rule: Production ≠ File Created

Если задача звучит как «добавить X в продакшен», Definition of Done — не `git commit`, а **проверенный рабочий флоу**.

| Создано | Не значит «готово» |
|---|---|
| `Dockerfile` | Образ собирается, healthcheck отвечает, `docker-compose up` не падает |
| `nginx/swiftmatch.http.conf` | `location /api` проксирует, WS не обрывается (`proxy_read_timeout 86400s`), `client_max_body_size 20M`, `limit_req` настроен. **Именно этот файл попадает в образ** (`Dockerfile:30`); корневой `nginx.conf` — конфиг хостового nginx на VPS (TLS 443, редирект с 80) и в образ не едет |
| `sentry.ts` | DSN в `.env`, source maps генерируются, `beforeSend` фильтрует JWT/пароли |
| `swagger.js` | Все новые роуты имеют JSDoc, авторизация через Bearer описана |
| Тесты Vitest/Playwright | **0 failures** — «pre-existing» не оправдание. Упавший тест = баг или мок сломан |
| Миграция применена | В VALUES, которые реально пишет код, **умещаются в колонку**: `CHECK`, `ENUM`, `UNSIGNED`, длина строки |
| Код сохранения формы | Форма на живой стойке заполняется и **читается обратно из БД**, а не просто отдаёт 200 |
| `Dockerfile` с `COPY server/ ./server/` | В образ **нет** `server/.env`, `server/.jwt-dev-secret` и `server/node_modules` (`node scripts/secrets-leak-audit.mjs` — exit 0) |
| Прод-`.env` на VPS | Переживает `rsync --delete`: в строке `switches:` есть `--exclude .env`. Иначе деплой тихо подменяет `JWT_SECRET` публичным значением из `.env.example` |
| Каталог с данными в коде | Смонтирован **именованным** volume'ом (`node scripts/deploy-persistence-audit.mjs` — exit 0). Иначе `docker compose up --build` удалит его, и страницы будут отдавать 200 со ссылками на несуществующие файлы |
| Счётчики тестов в `.md` | Совпадают с прогоном (`node scripts/test-counter-audit.mjs` — exit 0). Число в документации не доказывает ничего: оно устаревает молча и перепечатывается в оценки проекта (питфолл 47) |
| Маршрут, отдающий данные другого юзера | Учитывает `user_blocks` **в SQL** (`server/src/user-blocks.js`, `notBlocked`) — не только фид. Возвращает **404**, не 403, чтобы не подтверждать существование. Если ответ зависит от смотрящего — middleware кэша `cacheRoutePerUser`, и **все** `invalidate()` под этот маршрут переписаны под префикс `user:` |
| Прод-зависимости | `npm run audit:prod` — **exit 0** в корне и в `server/` (джоба `dependency-audit` в `ci.yml`, шаг в `lint-and-typecheck` в `deploy.yml`). High/critical в prod-дереве блокируют деплой; moderate/low — нет (питфолл 49) |
| Секрет, вписанный в документ | `node scripts/secrets-leak-audit.mjs` — exit 0 **и по именам файлов, и по значениям**. Гейт смотрел только на имена, и настоящий VAPID-приватный ключ в `README.md` уехал на GitHub вместе с историей. Ключи генерируются локально (`npx web-push generate-vapid-keys`) и в репозиторий не пишутся |

---

## Pre-flight Checklist (перед каждым закрытием production-задачи)

Проверить **все** пункты, даже если задача казалась «только про фронт»:

### 1. Security grep (30 секунд)
```bash
grep -rE "dev-secret|localhost:300[0-9]|password.*=.*$|JWT_SECRET.*=.*key" \
  --include="*.env" --include="*.ts" --include="*.js" \
  --exclude-dir=node_modules --exclude-dir=dist
```
Если нашлось — не коммитить. Сгенерировать `crypto.randomBytes(32).toString('hex')` и вынести в `.env.example` (без реальных значений).

### 2. Конфигурационная консистентность

Все порты должны совпадать по цепочке:
- `server/.env` → `PORT=3002`
- `vite.config.ts` → `proxy: { '/api': 'http://localhost:3002' }`
- `capacitor.config.ts` / `src/lib/native.ts` → `VITE_API_URL` указывает на тот же хост
- `.env` (root) → `VITE_WS_URL`, `VITE_API_URL` для Vite dev-сервера

Несоответствие = 502 Bad Gateway на проде.

### 3. База данных: миграции, не ALTER TABLE

Новые колонки добавляются через `database/migrations/`, а не ручным ALTER TABLE в консоли MySQL.
Если в руте используется новая колонка — она должна быть в `mysql_schema.sql` и в отдельном файле миграции.

Правило: `git diff` не должен содержать `ALTER TABLE` в `.js`/`.ts` файлах (только в `migrations/`).

### 4. Платежный флоу (если touched Stripe)

- [ ] `STRIPE_SECRET_KEY` и `STRIPE_WEBHOOK_SECRET` в `server/.env` (не `sk_test_...` если задача про «live»)
- [ ] Убрать `mockFallback` из прод-ветки или завернуть в `if (process.env.NODE_ENV !== 'production')`
- [ ] Добавить idempotency key на `checkout.sessions.create`
- [ ] Webhook роут использует `express.raw({ type: 'application/json' })` перед `express.json()`
- [ ] Проверить цепочку: выбор тарифа → редирект на Stripe → success/cancel → подписка в `subscriptions` таблице

### 5. Email / SMTP (если touched auth/notify)

- [ ] `server/src/mail.js` не содержит `console.log` как единственный транспорт в проде
- [ ] `.env` содержит `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (или fallback на Mailgun/Resend API key)
- [ ] Регистрация с реальным email отправляет письмо (проверить через Mailtrap или логи)

### 6. WebSocket reliability (если touched ws.js / use-websocket.ts)

- [ ] Сервер (`server/src/ws.js`) настроен `pingInterval: 10000, pingTimeout: 5000`
- [ ] Клиент (`src/hooks/use-websocket.ts`) имеет reconnect с exponential backoff (max 30s)
- [ ] Сообщения подтверждаются (ack) — иначе при обрыве мобильного интернета сообщения теряются
- [ ] `user:banned` event разлогинивает клиента без перезагрузки страницы

### 7. File Upload Security (если touched /api/upload)

- [ ] Ограничение размера: `limits: { fileSize: 5 * 1024 * 1024 }` (5 MB)
- [ ] Фильтр типа: `file.mimetype.startsWith('image/')`
- [ ] В проде файлы идут на S3 (Selectel/R2/Yandex), а не на локальный диск. Если диск — добавить anti-virus сканирование (ClamAV) или хотя бы расширение whitelist
- [ ] Имя файла — uuid + оригинальное расширение, никаких `../` или оригинального name

### 8. Admin routes (если touched /api/admin/*)

- [ ] `adminAuth` — активный (401/403); монтируется ОДНИМ гейтом `app.use('/api/admin', ...)` в index.js; публичен только `GET /api/admin/features`
- [ ] Новые админ-роуты монтировать под `/api/admin` (получают гейт автоматически), не обходить гейт
- [ ] Все новые админ-роуты возвращают массивы для таблиц (`[{...}, {...}]`), а не объекты `{data: [...]}` — Recharts и DataTable ломаются
- [ ] SQL-запросы обёрнуты в try/catch, пустой результат заменяется на `[]` или `{}` — никаких `chartData.slice is not a function`

### 9. Sentry / Observability (если touched инфраструктура)

- [ ] `SENTRY_DSN` в `.env` (frontend и backend)
- [ ] `beforeSend` фильтрует `req.headers.authorization`, `password`, `token`
- [ ] Добавлен `/health` роут в Express:
```js
app.get('/health', (req, res) => {
  res.json({ status: 'ok', db: dbPool._connection?.state !== 'disconnected' });
});
```
- [ ] Docker healthcheck использует `curl -f http://localhost:3002/health`

### 10. Тесты

- [ ] `npm run test` (frontend) — 0 failures
- [ ] `cd server && npm run test` — 0 failures. «Pre-existing» — не причина оставлять. Если тест мокает БД — мок должен возвращать ту же структуру, что реальный `mysql2`
- [ ] Playwright: `npx playwright test` проходит (требует запущенного сервера; добавить `webServer` в `playwright.config.ts`)
- [ ] **Дрейф схемы:** `node scripts/schema-drift-audit.mjs --offline` — exit 0 (код ↔ `database/mysql_schema.sql`). Если доступна живая БД: `$env:MYSQL_BIN="<путь к mysql.exe>"; node scripts/schema-drift-audit.mjs` — exit 0. Ненулевой exit = в коде есть колонка, которой нет в БД → живой 500
- [ ] **Секреты и мусор не уезжают в артефакты:** `node scripts/secrets-leak-audit.mjs` — exit 0. Проверяет, что в контекст образа не попадают `.env`/`*.secret`/`*.pem`/`*.key` и вложенные `node_modules`/`dist`, а rsync-строка в `deploy.yml` исключает `.env`/`*.secret`/`uploads`. Правило: `COPY server/ ./server/` требует `**/`-паттернов — `.env` и `node_modules` без `**/` исключают только корневой файл (питфолл 43), а `--delete` в rsync стирает всё, что живёт только на сервере (питфолл 44)
- [ ] **Данные на диске переживают деплой:** `node scripts/deploy-persistence-audit.mjs` — exit 0. Правило: `docker compose up -d --build` пересоздаёт контейнер, и всё, что не смонтировано **именованным** volume'ом, исчезает. Если задача добавляет запись на диск — новый путь обязан быть под volume'ом и указан в гейте (питфолл 45)
- [ ] **Миграция применена:** `cd database/migrations && node migrate.js` — `All migrations applied`, и новая колонка видна в `information_schema`. Правило: любая колонка, которую читает код, появляется и в `database/migrations/` (питфолл 38)
- [ ] **Счётчики тестов в документации совпадают с прогоном:** `node scripts/test-counter-audit.mjs` — exit 0. Перезапускает vitest (корень + `server/`) и `playwright test --list`, сверяет измеренные числа с `README.md`, `project-context.md`, `test/README.md`, `test/project-context.md`, `test/ИНВЕНТАРЬ-ТЕСТОВ.md`. Правило: задача, добавившая или удалившая тест, обязана обновить числа — иначе «807 зелёных тестов» в документации остаётся ложью, которую перепечатывают дальше (питфолл 47). Чинить: `--fix` (переписывает сам); без живой БД — `--skip-e2e` (E2E считается статически, `--list`; без Playwright-браузеров — `--skip-e2e --no-per-file`)
- [ ] **Фильтр блокировок стоит везде, а не только в фиде:** сплошной поиск `FROM user_profiles` по `server/src/routes/` — каждый маршрут, отдающий данные **другого** юзера, содержит `notBlocked(...)` (питфолл 46). Правила: предикат живёт **в SQL** (отдельный запрос «проверил, потом прочитал» оставляет окно гонки), зритель передаётся параметрами, ответ при блокировке — **404**, и если ответ зависит от смотрящего, middleware кэша обязан быть `cacheRoutePerUser`, а все `invalidate()` под маршрут — переписаны под префикс `user:` (иначе правка профиля живёт в кэше до TTL)
- [ ] **Прод-зависимости без high/critical:** `npm run audit:prod` (корень) и `npm run audit:prod` в `server/` — exit 0. Обязательно после любого `npm install`/`npm update`: обновление пакета тянет транзитивные зависимости, и регресс приезжает без предупреждения (этап 18 вычистил 11 high/critical, но тогда это проверяли руками, а гейта в CI не было). Правила: аудировать `--omit=dev` (в образ едет только прод-часть, `Dockerfile`), порог `--audit-level=high` (moderate/low чинятся мажорными обновлениями и не должны ронять деплой), проверять **обе** половины — корень и `server/` (питфолл 49)

### 11. Запись в БД — обязательный смоук на живой стойке

> Добавлено 30.09.2026 после этапа 19: 807 зелёных тестов, оба режима дрейф-аудита и миграция `birth_date` — а `PUT /api/profile/:id` продолжал отдавать 500 на любое сохранение.

**Если задача пишет в БД** (форма, настройки, загрузка, редактирование профиля) — зелёные тесты и дрейф-аудит **не являются доказательством**. Обязательно:

- [ ] **Смоук в браузере на живой стойке** (3002/8081/3306): заполнить форму → сохранить → **прочитать изменённое поле обратно** через `GET /api/profile/me` (или SQL). Ответ «200» без чтения обратно не считается проверкой
- [ ] **Сравнить `CHECK` / `ENUM` / `UNSIGNED` / длины колонок из `mysql_schema.sql` с тем, что реально отправляет форма.** Дрейф-аудит проверяет *существование* колонки, а не *допустимые значения* — это другой класс дефекта (питфолл 41)
- [ ] Прогнать регрессию по краям: пустое значение каждого числового/ENUM-поля, значение вне диапазона, строка длиннее колонки. Ожидание — 200 на пустом, **400 с именем поля на мусоре**, 0 ответов 5xx
- [ ] Убедиться, что страница **не рисует редактируемую форму без сессии**: без токена — редирект на `/login`, а не форма по кэшу из `localStorage` с последующим «Ошибка сохранения»
- [ ] **Ошибка 500 видна в логе-файле, а не только в stdout.** Если текст ошибки теряется — сначала починить логирование, потом диагностировать: «почему не сохраняется» без текста ошибки диагностируется месяцами (питфолл 42)
- [ ] Пробные записи удалены из БД после проверки (FK CASCADE подчищает связи), временные скрипты сняты

