# SwiftMatch — Project Context

## Stack

| Технология | Версия | Конфиг |
|---|---|---|
| React | 18 | Concurrent Features, hooks |
| Vite | 8 | ESM, HMR, proxy `/api→localhost:3002` |
| TypeScript | 5 | strict mode |
| Tailwind CSS | 3 | `tailwind.config.ts` + `tailwindcss-animate` |
| React Router | 6 | `react-router-dom` |
| TanStack Query | 5 | `@tanstack/react-query` |
| React Hook Form | 7 | + Zod 4 валидация |
| Framer Motion | 12 | анимации |
| Socket.IO | 4 | клиент + сервер |
| shadcn/ui | — | Radix primitives + кастомные стили |

## Design System

### Colors (HSL)
```css
--primary: 343 99% 62%;     /* #fe3c72 — розовый */
--primary-foreground: 355.7 100% 97.3%;
--secondary: 0 0% 96.1%;
--muted: 240 4.8% 95.9%;
--muted-foreground: 240 3.8% 46.1%;
--destructive: 0 84.2% 60.2%;
--border: 240 5.9% 90%;
--ring: 343 99% 62%;
--radius: 1.25rem;            /* 20px — скругления */
```

### Typography
- **Headlines**: Poppins, sans-serif (`font-headline`)
- **Body**: Quicksand, sans-serif (`font-body`)
- All weights: 400, 500, 600, 700, 800, 900

### CSS Utilities
- `cn()` — `clsx` + `tailwind-merge` (из `src/lib/utils.ts`)
- `.gradient-text` — градиентный текст `#fe3c72 → #ff8e53`
- `.gradient-bg` — градиентный фон `#fe3c72 → #ff8e53`
- `.app-shadow` — кастомная тень
- `.safe-pb` — padding с safe-area-inset-bottom
- `.no-scrollbar` — скрыть скроллбар

## Component Library (shadcn/ui)

Все компоненты в `src/components/ui/`:
`button`, `input`, `dialog`, `select`, `card`, `badge`, `avatar`, `toast`, `tabs`, `switch`, `popover`, `tooltip`, `dropdown-menu`, `scroll-area`, `sheet`, `table`, `form`, `label`, `radio-group`, `slider`, `checkbox`, `carousel`, `textarea`

Импорт: `import { Button } from "@/components/ui/button"`

### Component Pattern
```tsx
import { cn } from "@/lib/utils"
// Radix UI primitives
// Tailwind через cn()
// TypeScript с полной типизацией
```

## API Layer

- Базовый URL: `/api` (Vite proxy → `localhost:3002`)
- Auth: JWT Bearer в `Authorization` header
- Hook: `useApi()` из `src/hooks/use-api.ts` — обёртка над fetch
- React Query: `useQuery`, `useMutation` с автоматическим рефетчем

### Типы API
```ts
// src/types.ts — глобальные типы
// src/lib/constants.ts — константы (интересы, цели, знаки зодиака)
```

## i18n

- Кастомный `LanguageContext` (RU/EN)
- `useLanguage()` → `{ t, language, setLanguage }`
- `t(key)` — перевод по ключу
- Ключи в формате: `interest.sport`, `goal.serious_relationship`, `common.zodiac.leo`
- Все данные в БД хранятся как ключи переводов (не рус/англ текст)

## State Management

- **Серверное состояние**: TanStack Query (React Query v5)
- **Клиентское состояние**: React Context (custom `LanguageContext`, `FeatureFlagsProvider`)
- **Формы**: React Hook Form + Zod
- **Локальное**: `useState`, `useReducer`

## Routing

```tsx
<Routes>
  <Route path="/" element={<Home />} />
  <Route path="/login" element={<Login />} />
  <Route path="/register" element={<Register />} />
  <Route path="/search" element={<Search />} />
  <Route path="/matches" element={<Matches />} />
  <Route path="/chats" element={<Chats />} />
  <Route path="/chats/:chatId" element={<ChatById />} />
  <Route path="/profile" element={<Profile />} />
  <Route path="/profile/edit" element={<ProfileEdit />} />
  <Route path="/profile/:userId" element={<Profile />} />
  <Route path="/premium" element={<Premium />} />
  <Route path="/premium/success" element={<PremiumSuccess />} />
  <Route path="/premium/cancel" element={<PremiumCancel />} />
  <Route path="/admin/*" element={<Admin />} />
  <Route path="/groups" element={<Groups />} />
  <Route path="/groups/:category" element={<CategoryFeed />} />
  <Route path="/contest" element={<Contest />} />
  <Route path="/activity" element={<Activity />} />
  <Route path="/onboarding" element={<Onboarding />} />
  <Route path="/settings" element={<Settings />} />
  <Route path="/about" element={<About />} />
  <Route path="/faq" element={<Faq />} />
  <Route path="/support-chat" element={<SupportChat />} />
  <Route path="/forgot-password" element={<ForgotPassword />} />
  <Route path="/reset-password" element={<ResetPassword />} />
  <Route path="/verify-email" element={<VerifyEmail />} />
  <Route path="/schedule" element={<Schedule />} />
  <Route path="/safety" element={<Safety />} />
</Routes>
```

## Project Structure

```
src/
├── components/
│   ├── ui/          # shadcn/ui компоненты
│   ├── dialogs/     # Модальные окна
│   └── shared/      # AdminGuard, AppHeader, BottomNav
├── context/         # React Contexts
├── hooks/           # Custom hooks (use-premium, use-websocket, use-toast)
├── lib/             # Утилиты, константы, env, native adapter
├── pages/           # Страницы (по одному файлу на роут)
├── types/           # TypeScript типы
├── main.tsx         # Entry point
├── App.tsx          # Router + Layout
└── vite-env.d.ts    # Vite env типы

server/
├── src/
│   ├── routes/      # Express роуты
│   │   ├── admin/   # Админ API
│   │   └── schedule.js  # Video Date Scheduling
│   ├── middleware/   # idempotency, auth
│   ├── index.js     # Server entry
│   ├── db.js        # MySQL pool
│   ├── mail.js      # SMTP
│   ├── ws.js        # Socket.IO (+ TTL cleanup, WS metrics)
│   ├── logger.js    # Winston
│   ├── sentry.js    # Sentry init
│   ├── redis.js     # ioredis client
│   ├── metrics.js   # Prometheus HTTP/DB/WS/cache metrics
│   ├── cache.js     # Redis cache middleware
```

## Vite Config Highlights

```ts
proxy: { '/api': { target: 'http://localhost:3002', changeOrigin: true } }
alias: { '@': path.resolve(__dirname, './src') }
build: { target: 'es2020', minify: 'esbuild', chunkSizeWarningLimit: 600 }
```

## Feature Flags

Загружаются из `GET /api/admin/features`:
`videoCalls`, `aiIcebreakers`, `aiCompatibility`, `groupsPage`, `contest`, `showAds`, `autosearch`, `ttlMessages`, `dateScheduling`, `profileScore`, `hangoutsEnabled`, `partnerOffers`

## Hangouts (Встречи) — v2 (Этап 54)

- Таблицы: `hangouts` (author_id, category, title, event_date, location_text, max_companions, status, **hangout_type ENUM('date','company')**), `hangout_responses`, `hangout_chats`, **`hangout_likes`** (liker_id→liked_id, UNIQUE), **`hangout_participants`** (hangout_id, user_id, role), **`hangout_checkins`** (hangout_id, user_id, lat/lng, geofence_verified), **`hangout_reviews`** (hangout_id, reviewer_id, rating 1–5, comment, tags JSON)
- Роуты: `/api/hangouts` (GET лента с фильтром type, POST с hangout_type), `/:id` (GET v2 — likes/participants/checkins + my_like/my_participant), `/:id/respond`, `/:id/responses/:rid` (PUT accept/decline), `/by-chat/:chatId`, **`/:id/like`**, **`/:id/skip`**, **`/:id/join`**, **`/:id/leave`**, **`/:id/checkin`**, **`/:id/review`**
- **Mutual like**: при взаимном лайке → автоматический chat + уведомление `hangout_mutual_like`
- **Company mode**: join/leave/create group chat; лимит participants
- **Check-in**: haversine ≤ 500м от hangout lat/lng, rate-limiter 5/min
- Rate limiters: like 30/min, join 20/min, checkin 5/min, review 10/5min
- Категории: cinema/theater/exhibition/cafe/concert/sport/other (`src/lib/hangouts.ts`)
- Страницы: `/hangouts` (тоглл All/Date/Company), `/hangouts/my`, `/hangouts/:id` (date → like/skip, company → join/leave/checkin/participants); флаг `hangoutsEnabled`; баннер на Home
- Уведомления: таблица `notifications` + GET /api/notifications; WS `notification:new`; типы hangout_response/accepted/declined/cancelled, **hangout_mutual_like**, invite, like
- **i18n**: 26 ключей RU/EN (`hangout.type.*`, `hangout.action.*`, `hangout.toast.*`, `hangout.label.*`, `hangout.form.type*`)

## Partners (Партнёрская экосистема, Wave 1 + 2)

- Таблицы (миграции 030–036): `partners` (type api/deeplink/saas, commission_rate, hmac_secret, UNIQUE name), `partner_offers` (10 категорий, deeplink VARCHAR(500), placement SET hangout/chat/profile/passport/attachment_result, valid_from/to, lat/lng), `partner_conversions` (click/booking/purchase/lead, amount/commission, status pending/approved/paid, external_order_id, partner_offer_id), `partner_orders` (stripe_session_id, offer_id, user_id, recipient_name/phone/message, amount, status), `partner_payouts` (partner_id, amount, status pending/approved/rejected, details, processed_by/at)
- **Wave 1 API** (сервер): GET `/api/partners/offers?category=&city=&placement=&lat=&lng=&radius=` (FIND_IN_SET, ST_Distance_Sphere + HAVING), POST `/api/partners/track` → INSERT conversion + deeplink c `utm_source=swiftmatch&ref={referral_code}`
- **Wave 2 API**: POST `/api/partners/postback/:id` (HMAC-подпись через hmac_seeds, идемпотентность через uq_conversions_external), GET `/api/partners/offers/:id` (детали оффера), POST `/api/partners/order` (Stripe Checkout для цветов), POST `/api/partners/order/webhook` (Stripe webhook, express.raw), GET `/api/partners/orders/my` (история заказов), POST `/api/partners/booking` (бронирование ресторанов), POST `/api/partners/booking/share` (WS partner:restaurant_shared)
- **Wave 3 API**: GET `/api/partners/offers/hotel?city=` (Redis-кэш), POST `/api/partners/hotel/book`, POST `/api/partners/spa/book` (spa/experience бронирование, валидация date+time)
- **Админ**: `server/src/routes/admin/partners.js` — ОТНОСИТЕЛЬНЫЕ пути (/partners, /offers, /conversions, /payouts, /stats/daily), монтируется на `/api/admin`; страница `/admin/partners` (5 вкладок: Partners/Offers/Conversions/Payouts/Stats)
- **Фронт**: chat-partner-actions.tsx (чипы в чате + FlowerOrderDialog + RestaurantBookingDialog), «Выбрать из афиши» в hangout-create.tsx, блок отелей в settings-privacy.tsx при passport_mode, partner-order-success/cancel pages
- **Сид**: 9 партнёров + 15 офферов (Яндекс Go, Кинопоиск, Рестоклуб, Островок, 1Сwipe, LoveLocal, FitBro, PlantGift, LoveSpa, EcoTrip, TaskMood, Flowwow, Bouquet.ru, Yandex Lavka), hmac_secret для каждого
- **Грабля #53 (AGENTS.md)**: admin-роутеры монтируются на `/api/admin` → пути ОТНОСИТЕЛЬНЫЕ; пользовательские роутеры (`partners.js`) — ПОЛНЫЕ пути без префикса

## Translation Keys

| Префикс | Пример | Файл |
|---|---|---|
| `interest.*` | `interest.sport` | `constants.ts` → `INTEREST_OPTIONS` |
| `goal.*` | `goal.serious_relationship` | `constants.ts` → `DATING_GOALS` |
| `common.zodiac.*` | `common.zodiac.leo` | `constants.ts` → `ZODIAC_SIGNS` |
| `education.*` | `education.higher` | `constants.ts` → `EDUCATION_OPTIONS` |
| `circadian.*` | `circadian.early_bird` | `constants.ts` → `CIRCADIAN_RHYTHM_OPTIONS` |
| `attach.*` | `attach.style.secure` | `attachment-styles.ts` |
| `chats.theme.*` | `chats.theme.romantic` | `chats.tsx` → `CHAT_THEMES` |
| `error.*` | `error.stripe.webhook_failed` | — |
| `premium.*` | `premium.status.active` | — |
| `ad.*` | `ad.profile_unlocked` | — |
| `auth.*` | `auth.email` | — |
| `button.*` | `button.watch` | — |
| `common.*` | `common.loading` | — |
| `register.*` | `register.name_placeholder` | — |
| `activity.*` | `activity.unlock_title` | — |
| `schedule.*` | `schedule.title` | — |
| `profile_score.*` | `profile_score.title` | — |
| `recommendation.*` | `recommendation.avatar` | — |
| `ttl.*` | `ttl.off_message` | — |

Переводы: RU — `language-context.tsx:12-931`, EN — `:935-1980`

## Premium Features (новые)

| Фича | Колонки | API | Premium gate |
|------|---------|-----|-------------|
| **Ghost Mode** (инкогнито) | `user_profiles.incognito` | `GET/PUT /api/settings/privacy` | Да (403 без подписки) |
| **Passport Mode** (другой город) | `passport_mode`, `passport_city`, `passport_lat`, `passport_lng` | `GET/PUT /api/settings/privacy` | Да (403 без подписки) |

## GDPR

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/data/export` | GET | Экспорт всех данных пользователя (JSON) |
| `/api/data/erase/request` | POST | Запрос на удаление (генерация токена) |
| `/api/data/erase/confirm` | POST | Подтверждение удаления по токену (24ч) |
| `/api/consent` | POST | Логирование согласия (тип + granted) |
| `/api/consent/history` | GET | История согласий |

Таблицы: `consent_log`, `data_erase_requests` — миграция `010_add_gdpr.sql`.

## Background GPS + Geofence

| Фича | Колонки | API | Описание |
|------|---------|-----|----------|
| **GPS tracking** | `user_locations.lat`, `lng`, `accuracy`, `geofence_events` | `PUT /api/location`, `GET /api/location` | 5min polling, geofence alerts |
| Хук | `use-background-geolocation.ts` | Capacitor geolocation + fallback watchPosition |

Миграция `011_add_background_gps.sql`.

## Disappearing Messages (TTL)

| Параметр | Описание |
|----------|----------|
| `ttl_seconds` | 0 (off), 5, 30, 60, 300, 3600, 86400 |
| Cleanup | `startMessageCleanup()` в ws.js (интервал 10s) |
| WS event | `chat:message-deleted` → `user:{id}` |
| UI | TTL selector Popover (Off/5s/30s/1m/5m/1h/24h) + timer icon |

Миграция `012_add_disappearing_messages.sql`.

## Video Date Scheduling

| API | Метод | Описание |
|-----|-------|----------|
| `/api/schedule` | GET | Список дат (фильтр: pending/accepted/declined/cancelled) |
| `/api/schedule` | POST | Предложить дату (user_id, scheduled_at, duration_min, message) |
| `/api/schedule/:id` | PUT | Принять/отклонить/отменить |
| WS | `schedule:updated` | Синхронизация между участниками |

Миграция `013_add_date_schedules.sql`. UI: `src/pages/schedule.tsx`, Calendar button в чатах.

## Profile Score

| API | Описание |
|-----|----------|
| `GET /api/profile/:id/score` | Score (0-100) + массив recommendations + potential_gain |
| `calculateProfileScore()` | Полнота: аватар (15), био (15), рост (10), образование (10), zodiac (10), attach (10), goal (10), city (5), gender (5), lookingFor (5), 3+ фото (5) |

UI: зелёный badge ≥80, жёлтый ≥50, красный <50; список рекомендаций с potential_gain.

## CI/CD Pipeline

`.github/workflows/deploy.yml`:
1. **lint** — eslint + prettier check
2. **frontend test** — `npx vitest run` (81 tests)
3. **server test** — `cd server && npm test` с MySQL-сервисом (299 tests)
4. **E2E** — `npx playwright test` с webServer (55 tests)
5. **deploy** — SCP + pm2 на продакшен (только main)

## Monitoring

| Сервис | Порт | Описание |
|--------|------|----------|
| Prometheus | `:9090` | Сбор метрик с `/metrics` endpoint |
| Grafana | `:3001` | 7-panel dashboard (HTTP rps, p50/p95/p99, DB queries, WS events, cache hit/miss, memory, CPU) |
| k6 | CLI | `k6/load-test.js` — ramp-up 10→100 users, 6 endpoints |

`server/src/metrics.js` использует prom-client: counters (http_requests_total, db_queries_total, ws_events_total) + histograms (http_request_duration_ms, db_query_duration_ms).

## Актуальный статус (август 2026, этапы 27–52)

> Детали: «Что сделано.txt» (этапы 30–53), «Что доделать.txt», AGENTS.md (грабли #27–53).

- **Тесты: 388/388** — сервер 307/307, фронт 81/81; vite build ✅, lint 0 errors, schema-validate 54 таблиц
- **CI/CD:** миграции БД выполняются на сервере перед pm2 restart (секреты DB_* не нужны)
- **Redis:** подключен локально (127.0.0.1:6379), graceful fallback
- **Этапы 30–31:** починены скрытые 500 (invites-дрейф колонок, iap.js updated_at, location.js user_id→id); все SQL сверены EXPLAIN'ом со схемой
- **Этап 32 (Android):** toolchain готов (SDK 35/36 + JDK 21, AGP 8.13.2), debug APK собран; RevenueCat IAP-клиент подключён
- **Этап 33 (auth):** JWT в httpOnly cookie sm_token/sm_refresh (SameSite=Lax, Secure в prod), мидлвари читают Bearer ?? cookie, /api/auth/me probe + /api/auth/logout; web-фронт не хранит токен в JS-storage (XSS-safe), нативные — Bearer
- **Этап 34 (безопасность):** refresh rotation + reuse detection (отзыв семьи при replay, миграция 025), `/api/auth/logout-all`, revoke всех сессий при смене пароля, account lockout 5→15 мин, ws.js без query-token
- **GDPR-консент:** работает и покрыт E2E (регистрация блокируется без согласия, consent_log пишется)
- **Этап 35:** schema-validate.mjs в CI/deploy; идемпотентные миграции 018-023; cleartext только debug + guard; backup 30 дней; security headers тесты. 258/258
- **Этапы 36-37:** RevenueCat SDK 13.4.1 + dynamic import; AGENTS.md правило adminAuth (active-check only)
- **Этап 38:** Admin TOTP 2FA (миграция 026, otplib v13, totp-2fa.js через adminAuth, login требует totp_code + lockout, UI two-fa-settings.tsx, i18n two_fa_*; смоук 8/8). Закрыт пробел i18n common.zodiac.* x12
- **Этап 39:** Stripe webhook идемпотентность (миграция 027 webhook_events UNIQUE provider+event_id, INSERT IGNORE дедуп) + upload security тесты (+5)
- **Этап 40:** лимитеры в middleware/limiters.js (фабрики для тестов); ratelimit.test.js — 60 ок → 61-й auth 429, api 600 → 429; i18n.test.ts RU↔EN; E2E icebreakers починен (диапазон кандидатов 20..199)
- **Этап 41:** docs/runbook-keys.md — ротация всех ключей, порядок для каждого провайдера, чеклист при утечке
- **Этап 42:** Redis fallback crash fix (queue.js probe); __Host- cookie в prod; cleanup revoked refresh-токенов; RevenueCat webhook unit-тесты (×6). 296/296
- **Этапы 43-45:** E2E security-blind-spots (GDPR cascade, refresh race, cookie edge cases); кросс-браузер firefox/webkit; XSS-фильтр sanitize.js v2. 300/300
- **Этап 46:** фича «Встречи» (Hangouts) — миграция 028, CRUD + respond/accept/decline/cancel, авто-чат при accept, уведомления WS, контекст встречи в чате, баннер Home, XSS-чистка legacy bio (миграция 029). 345/345
- **Этап 47:** партнёрская экосистема Wave 1 (Mesta.txt) — миграция 030 (partners, partner_offers, partner_conversions), API offers+track, админ-CRUD, чат-экшены, афиша, passport-mode, флаг partnerOffersEnabled. 369/369
- **Этап 48:** хвосты Hangouts (edit, дат-фильтры, free-лимит 1/день), deeplink-плейсхолдеры ({lat}/{lng}/{city}), S2S postback (миграция 033), admin conversions, координаты Geolocation. 380/380
- **Этап 49:** HMAC-подпись postback (миграция 034 hmac_seeds), сиды 7 партнёров + 11 офферов, hmac_secret в админке, 4 HMAC-теста
- **Этап 50:** Stripe Checkout для цветов (миграция 035 partner_orders), webhook, offers/:id, orders/my, flower-order-dialog.tsx, success/cancel pages
- **Этап 51:** POST /api/partners/booking + booking/share, restaurant-booking-dialog.tsx, WS partner:restaurant_shared, 6 новых тестов
- **Этап 52:** админка выплат партнёрам (миграция 036 partner_payouts), GET/POST payouts, PUT approve/reject, GET stats/daily (30-дневная агрегация), UI с 5 вкладками, i18n (11 ключей RU/EN), 7 новых тестов
- **Этап 53:** отели в passport-mode + Redis-кэш — GET /api/partners/offers/hotel?city= (Redis TTL 1ч), POST /api/partners/hotel/book, HotelBookingDialog, chat-partner-actions hotel→dialog, settings-privacy карусель отелей, 10 ключей i18n partner.hotel.*, 8 новых тестов (mock cache.js). Route ordering fix (hotel routes выше offers/:id). 388/388
- **Этап 54:** Hangouts 2.0 — миграция 037 (hangout_type ENUM, hangout_likes/hangout_participants/hangout_checkins/hangout_reviews), 6 новых эндпоинтов (like/skip/join/leave/checkin/review) с rate-limiter'ами, mutual like → auto-chat, чек-ин haversine ≤ 500м, фронт toggle All/Date/Company + context-aware detail, 26 ключей i18n, 388/388
- **Этап 56:** Wave 3 часть 2 — миграция 038 (сид LoveSpa + FitBro, 4 оффера spa/experience), POST /api/partners/spa/book, SpaBookingDialog, интеграция в chat-partner-actions, 10 ключей i18n partner.spa.*, 388/388
- **Этап 57:** Псевдонимы — миграция 039 (user_aliases), CRUD (GET/POST/PUT primary/DELETE), UI в profile-edit (бейджи + ввод + выбор primary), отображение в profile под именем, 7 ключей i18n, 388/388
- **Этап 58:** B2B-маркетплейс — миграция 040 (partners user_id, partner_subscriptions, b2b flag), 8 эндпоинтов (register, dashboard, offers CRUD, conversions, subscribe), PartnerGuard, PartnerRegister, PartnerDashboard (4 вкладки), 80 ключей i18n, 388/388
- **Этап 59:** Анти-кот верификация — миграция 041 (user_verifications + photo_verified), 4 эндпоинта (submit/status/admin approve), VerificationBadge + VerificationDialog, интеграция в profile, 17 ключей i18n, 388/388
