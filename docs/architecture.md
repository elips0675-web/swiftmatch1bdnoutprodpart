# Architecture & Reference

## Capacitor Android

### Структура
- `android/` — нативный Android проект (должен быть в git)
- `capacitor.config.ts` — конфиг (appId, webDir, plugins, cleartext)
- `src/lib/native.ts` — адаптер fetch/WS для нативного режима

### Сборка APK (требуется Android Studio + Java)
1. `VITE_API_URL=https://swiftmatch.app npm run build`
2. `npx cap copy android`
3. Открыть `android/` в Android Studio → Build → Build Bundle(s) / APK

### Live Reload (разработка на устройстве)
```bash
npx cap run android --livereload=http://<IP>:8081 --open
```
`<IP>` — локальный IP машины (192.168.x.x). Устройство должно быть в той же сети.

### Нативные фичи (доступны)
- **Камера**: `@capacitor/camera` (нативный UI, фото preview)
- **Файлы**: `@capacitor/filesystem`
- **Хранилище**: `@capacitor/preferences` (замена localStorage)
- **Пуши**: через Web Push + VAPID (сервис-воркер) или PushNotifications plugin

### Адаптация API для нативного режима
В `src/lib/native.ts`:
- Перехватывает `fetch('/api/...')` → `https://swiftmatch.app/api/...` в режиме native
- WebSocket в `use-websocket.ts` использует `VITE_WS_URL` или `wss://swiftmatch.app`
- Все 80+ прямых fetch-вызовов работают без изменений

### CORS
На сервере настроен `cors({ origin: '*' })` — подходит для Capacitor.

## Redis + Кэширование

### Подключение
- `server/src/redis.js` — lazy singleton с ioredis, getRedis()/withRedis()/disconnectRedis()
- Graceful connect при старте, disconnect на SIGTERM
- Без Redis — тихий fallback (не падает)

### Cache module (`server/src/cache.js`)
| Функция | Назначение |
|---------|-----------|
| `cacheRoute(ttl)` | Кэширование по URL (express middleware) |
| `cacheRoutePerUser(ttl)` | Кэширование по userId + URL |
| `setCached(key, data)` | Низкоуровневый set |
| `getCached(key)` | Низкоуровневый get |
| `invalidate(pattern)` | Сброс по паттерну (scanStream) |

### Кэшируемые роуты
- `GET /api/profile/:id` — 60s, сброс на PUT profile
- `GET /api/matches` — 30s per-user, сброс на POST like→match

### Конфиг
- `CACHE_TTL` в `server/.env.example` (по умолчанию 60s)
- Включить: раскомментировать `REDIS_URL` в `server/.env`

## MySQL Backup

### Скрипт `scripts/backup-mysql.ps1`
- auto-detect mysqldump (8 путей)
- `cmd.exe /c` для вызова mysqldump (избежать проблем PowerShell с ANSI)
- retention 7 дней
- Размер файла в выводе
- Task Scheduler: ежедневно в 03:00

## DB Migrations

- Новые колонки — через `database/migrations/`, НЕ ручным ALTER TABLE
- `database/migrations/migrate.js` — запуск миграций (таблица `_migrations`)
- Нумерованные .sql файлы (001_..., 002_..., etc.)
- `git diff` НЕ должен содержать `ALTER TABLE` в `.js`/`.ts` файлах (только в `migrations/`)
- Если в роуте используется новая колонка — она должна быть в `mysql_schema.sql` И в отдельном файле миграции
- Запуск: `node database/migrations/migrate.js`
- Перед написанием SQL в server routes — проверить колонки через `DESCRIBE table`. Схема в `mysql_schema.sql` может отличаться от реальной БД

---

## Integration Thinking: компоненты не существуют в вакууме

Прежде чем создать файл, ответить на 3 вопроса:

1. **Кто его потребляет?**  
   Swagger без валидных JWT-схем — бесполезен для фронта. Docker без `/health` — убивается оркестратором. Nginx без `proxy_read_timeout` — убивает WS.

2. **Что произойдёт в 3 ночи, когда это сломается?**  
   Нет healthcheck → Kubernetes перезапускает контейнер каждые 2 минуты.  
   Нет Sentry → ошибка в Stripe webhook остаётся незамеченной 8 часов.  
   Нет логов → не воспроизвести баг.

3. **Как я проверю это без ручного клика?**  
   Если ответ «открою браузер и посмотрю» — плохо. Нужен curl/API call/тест.

---

## Data & State Consistency (расширение правил переводов)

Всё, что касается new features, должно использовать translation keys:

- Новые интересы → `interest.new_thing` в `constants.ts` + `language-context.tsx`
- Новые статусы подписки → `premium.status.active`, не "Активна"
- Новые ошибки API → `error.stripe.webhook_failed`, не "Webhook error"

**Но:** admin-dashboard и Sentry-логи — исключение. Админ видит technical IDs (`user_123`, `stripe_session_xxx`), а не `t()`. Не оборачивать логи и email-рассылки (кроме UI-текста) в `t()`.

---

## Environment-specific Logic

Любой `if (process.env.NODE_ENV === 'development')` или `if (!STRIPE_KEY)` с mock-fallback должен быть явно задокументирован:

```js
// server/src/routes/premium.js
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY) 
  : null;

// Если stripe === null — использовать mock. Это ОК для dev, но в prod 
// STRIPE_SECRET_KEY обязателен, иначе подписки не работают.
```

**Запрещено:** тихий fallback без комментария. Пользователь не должен платить реальными деньгами и попадать в mock.

---

## Capacitor / Native-specific

- `src/lib/native.ts` перехватывает fetch. Любой новый API-роут должен работать через абсолютный URL (`VITE_API_URL`), иначе в APK запросы уйдут в `file:///api/...`
- WebSocket в нативном режиме использует `wss://`, а не `ws://`. Проверить `capacitor.config.ts` → `cleartext: true` только для dev, в prod — `false` + валидный SSL
- `@capacitor/preferences` — замена localStorage. Если фича использует localStorage, она должна иметь fallback на Preferences для Android

---

## 🏗️ Project Structure (SwiftMatch)

```
swiftmatch1bddomadm/
├── src/                          # Frontend (React 18 + Vite 8)
│   ├── components/
│   │   ├── ui/                   # shadcn/ui primitives (через CLI)
│   │   ├── layout/               # Header, AppShell, BottomNav
│   │   ├── shared/               # ErrorBoundary, AdminGuard, PremiumGuard
│   │   └── forms/                # RHF + Zod формы
│   ├── pages/
│   │   ├── admin/                # Админка (8 страниц)
│   │   └── *.tsx                 # User-facing страницы
│   ├── hooks/                    # Кастомные хуки (use-websocket, use-premium...)
│   ├── context/                  # React.Context (Language, FeatureFlags...)
│   ├── lib/
│   │   ├── utils.ts              # cn() + общие утилиты
│   │   ├── native.ts             # Capacitor fetch-адаптер
│   │   └── constants.ts          # Translation keys, options
│   ├── shim/                     # Полифиллы next-navigation (useSearchParams)
│   ├── App.tsx                   # Root: Router → Layout → lazy routes
│   └── vite-env.d.ts
├── server/                       # Backend (Express.js)
│   └── src/
│       ├── index.js              # Express entry: helmet, cors, rate-limit, WS
│       ├── ws.js                 # Socket.IO server
│       ├── mail.js               # Nodemailer + retry
│       ├── logger.js             # Winston JSON logger
│       ├── sentry.js             # Sentry init + beforeSend
│       ├── redis.js              # ioredis lazy client
│       ├── banned-words.js       # Фильтр запрещённых слов
│       ├── middleware/           # auth.js, idempotency.js, adminAuth.js
│       └── routes/
│           ├── admin/            # dashboard, users, features, content, reports...
│           └── *.js              # auth, profile, social, premium, upload...
├── database/
│   ├── mysql_schema.sql          # Полная схема БД
│   ├── demo_data.sql             # Тестовые данные
│   └── migrations/               # Нумерованные миграции
├── android/                      # Capacitor нативный проект
├── scripts/                      # setup.ps1, backup-mysql, migrate
├── nginx/                        # swiftmatch.conf
├── .github/workflows/            # CI/CD (deploy.yml)
└── test_pages.mjs                # Playwright tests
```

## 🔄 CI/CD Pipeline (.github/workflows/deploy.yml)

```yaml
# GitHub Actions — lint → build → test → deploy
name: CI/CD
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npx tsc --noEmit

  test:
    runs-on: ubuntu-latest
    services:
      mysql:
        image: mysql:8.4
        env: { MYSQL_ROOT_PASSWORD: test, MYSQL_DATABASE: swiftmatch_test }
        options: --health-cmd="mysqladmin ping" --health-interval=10s
    steps:
      - uses: actions/checkout@v4
      - run: cd server && npm ci
      - run: mysql -h127.0.0.1 -uroot -ptest swiftmatch_test < database/mysql_schema.sql
      - run: cd server && npm test

  build-and-deploy:
    needs: [lint-and-typecheck, test]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npx vite build
      - run: cd server && npm ci
      # deploy step (scp / docker push / vercel)
```

## 📋 Git Workflow

| Правило | Значение |
|---------|----------|
| Ветки | `main` (production), `develop`, `feature/*`, `bugfix/*`, `hotfix/*` |
| Коммиты | `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:` |
| PR | TypeScript check + lint + tests passing |
| Секреты | `.env` в `.gitignore`, `.env.example` в репо |
| Husky | pre-commit: lint-staged (eslint + prettier). Использовать `git commit --no-verify` если changes проверены |

## 🧪 Testing Strategy

| Уровень | Инструмент | Команда | Что тестируем |
|---------|-----------|---------|--------------|
| Unit (frontend) | Vitest + RTL | `npm run test` | hooks, utils, компоненты |
| Unit (backend) | Vitest (mock mysql2) | `cd server && npm run test` | routes, middleware |
| E2E | Playwright | `npm run test:e2e` | 28+ pages, console errors, user flows |
| E2E (UI mode) | Playwright UI | `npm run test:e2e:ui` | Interactive debugging |
| API | Curl / tests | — | Healthcheck, все роуты |

### Unit-тесты (ключевые файлы)
- `language-context.test.tsx` — проверка translation keys (RU/EN), mock `t()`
- `feature-flags-context.test.tsx` — API fallback, default flags при отсутствии Supabase
- `use-websocket.test.tsx` — connect с токеном, null без токена, disconnect при unmount
- `auth-context.test.tsx` — login/logout, token lifecycle
- `use-premium.test.ts` — tiers, subscription status

### Playwright структура

```
e2e/
├── audit-full.spec.ts       # Полный аудит (health, auth, admin API, pages, chat)
├── login.spec.ts            # Существующие тесты логина
├── register.spec.ts         # Существующие тесты регистрации
├── profile.spec.ts          # Существующие тесты профиля
├── helpers/
│   ├── audit.ts             # console/network/page error tracker
│   └── api.ts               # apiCall(), loginViaApi(), healthCheck()
├── setup/
│   └── global-setup.ts      # Health check + DB verify перед тестами
└── visual/                  # Скриншотные тесты (будущие)
```

### Сценарии в `audit-full.spec.ts` (12 сьюитов)
1. `Health & Infrastructure` — API healthcheck, frontend loads без ошибок
2. `Registration flow` — регистрация через UI, затем логин
3. `Negative auth tests` — wrong password stays on /login, empty email validation
4. `Like → Match → Chat` (два пользователя) — API лайки user4→user5, проверка match, отправка сообщения
5. `Admin flow` — дашборд без ошибок, toggle feature flag, save/reset кнопки, search users
6. `Public pages` — /, /login, /register, /forgot-password без console errors
7. `Settings` — toggle switches, logout button
8. `Chat functionality` — открыть чат, проверить message input
9. `Groups` — открыть диалог создания
10. `Negative & security` — XSS в bio экранирован, wrong password, empty email
11. `WebSocket real-time` — сообщение появляется без перезагрузки
12. `WebSocket two-browser` — браузер A отправляет, браузер B получает без reload

### Конфигурация
- **screenshot**: `only-on-failure` — скриншот при падении
- **video**: `retain-on-failure` — видео при падении
- **trace**: `on-first-retry` — HAR + console + network на первом ретрае
- **reporter**: `html` + `json` (`test-results.json`) + `list`
- **globalSetup**: проверка `/health` + MySQL перед запуском

### Селекторы: `data-testid` (must have для ИИ-тестов)

Все интерактивные элементы должны иметь `data-testid`:

| Страница | Селектор | Где |
|----------|----------|-----|
| login.tsx | `[data-testid="email"]` | Input email |
| login.tsx | `[data-testid="password"]` | Input password |
| login.tsx | `[data-testid="phone"]` | Input phone |
| login.tsx | `[data-testid="submit-login"]` | Кнопка входа |
| register.tsx | `[data-testid="name"]` | Input имени |
| register.tsx | `[data-testid="email"]` | Input email |
| register.tsx | `[data-testid="password"]` | Input пароля |
| register.tsx | `[data-testid="submit-register"]` | Кнопка регистрации |
| forgot-password.tsx | `[data-testid="email"]` | Input email |
| forgot-password.tsx | `[data-testid="submit-forgot-password"]` | Кнопка отправки |
| settings.tsx | `[data-testid="switch-*"]` | Переключатели (push, email, location, discovery, incognito, data-consent) |
| settings.tsx | `[data-testid="logout-button"]` | Кнопка выхода |
| settings.tsx | `[data-testid="delete-account-button"]` | Кнопка удаления |
| profile-edit.tsx | `[data-testid="profile-name"]` | Input имени |
| profile-edit.tsx | `[data-testid="profile-bio"]` | Textarea био |
| profile-edit.tsx | `[data-testid="save-profile"]` | Кнопка сохранения |
| groups.tsx | `[data-testid="create-group-button"]` | Кнопка создать |
| groups.tsx | `[data-testid="group-name"]` | Input названия |
| groups.tsx | `[data-testid="group-description"]` | Textarea описания |
| groups.tsx | `[data-testid="submit-create-group"]` | Кнопка создания |
| search.tsx | `[data-testid="change-filters"]` | Кнопка фильтров |
| search.tsx | `[data-testid="prev-profile"]` | Назад |
| search.tsx | `[data-testid="next-profile"]` | Вперёд |
| search-filters.tsx | `[data-testid="apply-filters"]` | Применить фильтры |
| premium-success.tsx | `[data-testid="back-home-button"]` | На главную |
| admin-features.tsx | `[data-testid="save-features"]` | Сохранить флаги |
| admin-features.tsx | `[data-testid="reset-features"]` | Сбросить флаги |
| admin-users.tsx | `[data-testid="search-users"]` | Поиск пользователей |
| admin-messaging.tsx | `[data-testid="messaging-title"]` | Тема рассылки |
| admin-messaging.tsx | `[data-testid="messaging-body"]` | Текст рассылки |
| admin-messaging.tsx | `[data-testid="send-campaign"]` | Отправить |
| chats-chatId.tsx | `[data-testid="message-input"]` | Поле ввода сообщения |
| chats-chatId.tsx | `[data-testid="send-button"]` | Кнопка отправки |
| chats-chatId.tsx | `[data-testid="message-list"]` | Контейнер сообщений |
| chats.tsx | `[data-testid="message-input"]` | Поле ввода (десктопный чат) |
| chats.tsx | `[data-testid="send-button"]` | Кнопка отправки (десктопный чат) |
| chats.tsx | `[data-testid="chat-search"]` | Поиск чатов |
| activity.tsx | `[data-testid="reveal-profile"]` | Кнопка раскрытия профиля |
| contest.tsx | `[data-testid="close-photo-viewer"]` | Закрыть просмотр фото |
| safety.tsx | `[data-testid="add-contact-button"]` | Добавить контакт |
| safety.tsx | `[data-testid="save-contact-button"]` | Сохранить контакт |
| safety.tsx | `[data-testid="start-checkin-button"]` | Начать чек-ин |
| safety.tsx | `[data-testid="checkin-now-button"]` | Я в безопасности |

### Promt для DeepSeek: аудит через Playwright

```
Ты — senior QA engineer. У тебя есть:
- Playwright тесты в e2e/
- Работающее приложение на localhost:8081
- API на localhost:3002
- Отчёт playwright-report/

### Задача:
1. Запусти: npx playwright test --reporter=json
2. Для каждого FAILED теста:
   - Открой trace viewer: npx playwright show-trace test-results/{trace}.zip
   - Посмотри скриншот
   - Прочитай console errors
   - Найди соответствующий код в src/ и server/src/
3. Классифицируй ошибку:
   - FE: баг во фронтенде
   - BE: баг в API
   - DB: расхождение схемы и кода
   - TEST: тест неактуален (изменился UI)
4. Для каждой ошибки предложи фикс с конкретными файлами

### Формат ответа:
## Найдено X ошибок
### 1. [FE/BE/DB/TEST] Краткое описание
- **Тест:** e2e/...spec.ts:line
- **Причина:** что сломано
- **Код:** фрагмент с багом
- **Фикс:** конкретные изменения
- **Приоритет:** 🔴/🟠/🟡
```
