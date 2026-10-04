# SwiftMatch — продуктовый roadmap (разделы 21–34 из `Промты.txt`)

> **Перенос 04.10.2026 (этап 32).** Раньше эти 14 разделов лежали в `Промты.txt`
> (разделы 21–34, 775 строк) — вперемешку с правилами проекта, которые живут в
> `docs/AGENTS-*.md`. Здесь только продуктовые и инфраструктурные идеи; текст перенесён
> **дословно**, без правок, чтобы ничего не потерять.
>
> **Это не план работ и не обещание.** Здесь нет ни одного измеренного числа и ни одной
> ссылки на «текущее состояние»: почти все пункты уже частично или полностью закрыты
> (список этапов — `docs/roadmap.md`, бэклог с приоритетами — `Что доделать.txt`).
> Пользуйтесь этим файлом как списком идей, а не как описанием проекта.
>
> Правила проекта, гейты и чек-листы — `AGENTS.md` и `docs/AGENTS-*.md`.
> Сводка документации — `test/СВОДКА.md` (локальное зеркало, в `.gitignore`).

---
## 21. Production Roadmap — что нужно для продакшена

### 🔴 Критично — без этого не запустить/не масштабировать

#### 21.1 CI/CD Pipeline (GitHub Actions)
```yaml
# .github/workflows/ci.yml
- Lint + TypeScript strict check
- Unit tests (Vitest) + Server tests (Jest/Vitest)
- Playwright E2E (parallel shards, 4 workers)
- Build Vite + Docker build server
- Deploy staging on PR, production on tag
```

#### 21.2 Docker / Docker Compose
- `Dockerfile` (multi-stage: deps → build → prod)
- `docker-compose.yml`: app + mysql + redis + nginx + s3mock (minio)
- Нужно для идентичных окружений dev/staging/prod

#### 21.3 Background Jobs (Bull + Redis)
- `server/src/queue.js`:
  - emailQueue (приветственные письма, дайджесты)
  - matchQueue (расчёт совместимости, уведомления о мэтче)
  - imageQueue (ресайз фото, NSFW-проверка, WebP-конвертация)
  - notificationQueue (push-уведомления, email-оповещения)

#### 21.4 Redis Adapter для Socket.IO
- Горизонтальное масштабирование WebSocket:
  ```js
  const { createAdapter } = require("@socket.io/redis-adapter");
  io.adapter(createAdapter(pubClient, subClient));
  ```
- Без этого при 2+ серверах WS-сообщения теряются между инстансами

#### 21.5 Geospatial Search (ближайшие пользователи)
- MySQL 8.0+ Spatial: `POINT` + `SRID 4326` + `SPATIAL INDEX`
- `ST_Distance_Sphere(location, POINT(?, ?)) <= radius`
- Дейтинг без "люди рядом" — не дейтинг. `ORDER BY sqrt(pow(...))` убивает БД на 10k пользователей

### 🟠 Высокий приоритет — без этого будет больно через 3 месяца

#### 21.6 Push Notifications (Firebase Cloud Messaging)
- `src/lib/push.ts`: requestPermission → FCM token → save to `/api/devices`
- Server: `sendMulticast()` на мэтч/сообщение
- Capacitor: `@capacitor/push-notifications`
- Socket.IO не работает, когда приложение в фоне — теряете 60% engagement

#### 21.7 SMS Verification (Twilio / Vonage)
- `server/src/sms.js`: sendVerificationCode + verifyCode
- rate-limit: 3 SMS/час на номер
- Дейтинг = высокий риск фейков. Верификация телефона снижает ботов на 80%

#### 21.8 AI Content Moderation (фото + текст)
- AWS Rekognition / Google Vision: detect nudity, violence
- Sightengine / Azure Content Moderator: текстовый токсичный контент
- `moderation_status: 'pending' | 'approved' | 'rejected'` (уже есть в schema)
- Автоматический бан при confidence > 0.85
- "Banned words" — это 2010-й. Нужна модерация изображений в реальном времени

#### 21.9 Image Processing Pipeline (Sharp + S3 + CloudFront)
- Sharp: resize 800x800, 400x400, 200x200 (thumbnails)
- WebP/AVIF конвертация
- Blur hash для placeholder
- S3 upload с uuid + CloudFront CDN
- Без ресайза = 10s загрузка профиля, $$$ на трафик

#### 21.10 Video / Voice Calls (WebRTC)
- PeerConnection, ICE servers (Twilio STUN/TURN или coturn)
- Сигналинг через существующий Socket.IO
- offer → answer → ICE candidates → stream
- Конкуренты (Tinder, Bumble) уже имеют видеозвонки

### 🟡 Средний приоритет — нужно для роста и команды

#### 21.11 Feature Flags Service (Unleash / Flagsmith)
- `isEnabled('new_chat_ui')` → постепенный rollout (5% → 50% → 100%)
- A/B тест цен: `isEnabled('premium_v2')`
- server-side: флаги в middleware (отключить лайки при overload)

#### 21.12 Product Analytics (PostHog / Amplitude)
- `track('profile_view', { source: 'search' | 'match' })`
- `track('swipe', { direction: 'left' | 'right', duration_ms })`
- funnel: register → profile_complete → first_like → first_match → first_message
- "0 failures в тестах" ≠ "продукт работает". Нужно знать, где дропаются пользователи

#### 21.13 Advanced Monitoring (Grafana + Prometheus + Loki)
- metrics: HTTP request duration, DB query time, WS connections, Redis memory
- alerts: P99 latency > 500ms, DB connections > 80%, error rate > 1%
- Loki: агрегация Winston-логов
- Sentry ловит ошибки, но не ловит "сайт тормозит"

#### 21.14 Load Testing (k6 / Artillery)
- 1000 VU делают `/api/search` одновременно
- 500 VU отправляют сообщения в чат
- Проверка: P95 < 200ms, 0% ошибок, DB CPU < 70%
- Дейтинг имеет пики (14 февраля, вечер пятницы)

#### 21.15 Data Warehouse / ETL (BigQuery / ClickHouse)
- `analytics.events`: event_time, user_id, event_type, properties (JSON)
- ETL: MySQL → ClickHouse каждые 15 мин
- Dashboard: retention cohorts, LTV, CAC, churn prediction
- Аналитика на production БД = смерть. Отдельный warehouse для BI

### 🟢 Нужно для зрелости и compliance

#### 21.16 GDPR / Data Privacy Compliance
- `DELETE /api/me` — полное удаление (каскад: user → profile → photos → messages → matches)
- `GET /api/me/export` — JSON со всеми данными пользователя
- Автоматическое удаление неактивных аккаунтов через 2 года
- Cookie consent banner
- Штраф GDPR до 4% оборота

#### 21.17 Incident Response & Runbooks
```markdown
# runbooks/
- db-down.md: включаем read-only mode, показываем заглушку
- ws-down.md: fallback на long-polling, queue сообщений
- stripe-webhook-fail.md: ручная синхронизация подписок
- on-call: PagerDuty/Opsgenie rotation
```

#### 21.18 API Versioning Strategy
```js
app.use('/api/v1', v1Routes);
// app.use('/api/v2', v2Routes); // когда breaking change
```
Мобильное приложение не обновляется мгновенно. Старые клиенты должны работать 3-6 месяцев.

#### 21.19 Multi-Environment Configuration
- `.env.development`, `.env.staging`, `.env.production`
- Сейчас в проекте есть `server/.env` и `vite.config.ts`, но нет явного разделения staging/prod

#### 21.20 Design System / Storybook
- Все shadcn/ui компоненты + кастомные (ProfileCard, MatchModal, ChatBubble)
- Visual regression testing (Chromatic)
- 3 разработчика + дизайнер = дрифт UI. Storybook — единый источник правды

---

### Сводная таблица

| # | Раздел | Приоритет | Статус |
|---|--------|-----------|--------|
| 21.1 | CI/CD Pipeline (GitHub Actions) | 🔴 | ❌ |
| 21.2 | Docker & Compose | 🔴 | ❌ |
| 21.3 | Background Jobs (Bull Queue) | 🔴 | ❌ |
| 21.4 | Redis Socket.IO Adapter | 🔴 | ❌ |
| 21.5 | Geospatial Search (MySQL Spatial) | 🔴 | ❌ |
| 21.6 | Push Notifications (FCM) | 🟠 | ✅ (VAPID + SW + API) |
| 21.7 | SMS Verification (Twilio) | 🟠 | ⚠️ (scaffold: клиент + роуты + миграция) |
| 21.8 | AI Moderation (Rekognition) | 🟠 | ⚠️ (scaffold: OpenAI + Rekognition + эвристика) |
| 21.9 | Image Pipeline (Sharp + CDN) | 🟠 | ✅ (Sharp resize + WebP + AVIF) |
| 21.10 | WebRTC Video/Voice | 🟠 | ✅ (RTCPeerConnection + STUN + сигналинг) |
| 21.11 | Feature Flags (Unleash) | 🟡 | ❌ |
| 21.12 | Product Analytics (PostHog) | 🟡 | ❌ |
| 21.13 | Monitoring (Grafana) | 🟡 | ❌ |
| 21.14 | Load Testing (k6) | 🟡 | ❌ |
| 21.15 | Data Warehouse (ClickHouse) | 🟡 | ❌ |
| 21.16 | GDPR & Data Privacy | 🟢 | ❌ |
| 21.17 | Incident Response | 🟢 | ❌ |
| 21.18 | API Versioning | 🟢 | ❌ |
| 21.19 | Multi-Environment Config | 🟢 | ❌ |
| 21.20 | Design System / Storybook | 🟢 | ❌ |

---

## 22. DevEx & Onboarding

### 22.1 LOCAL_SETUP.md — запуск с нуля за 5 минут
```bash
# Чек-лист для нового разработчика
git clone → cp .env.example .env → docker compose up → npm run dev → open http://localhost:5173
```
Явно прописать: версия Node, глобальные зависимости, порты, которые должны быть свободны.

### 22.2 Database Seeding & Fixtures
```ts
// scripts/seed.ts
// - 50 тестовых пользователей с фото (unsplash/placeholder)
// - 10 мэтчей, 200 сообщений
// - 1 admin, 1 banned user, 1 premium user
// - npm run db:seed и npm run db:reset
```
Фиксит: ручное создание данных для тестирования чата/мэтчей.

### 22.3 .nvmrc + engines в package.json
```json
{ "engines": { "node": ">=20.11.0", "npm": ">=10.2.0" } }
```
Фиксит: «У меня на Node 18 не собирается».

---

## 23. Архитектура & State Management

### 23.1 State Management Decision Tree
- Client-only (theme, UI) → React Context
- Server state (API) → TanStack Query
- Cross-component sync (websocket, cart) → Zustand / Valtio
- Form state → React Hook Form (никогда не в Context)

### 23.2 Error Handling Strategy (единый формат)
```ts
// Все API-ошибки:
{ "error": "ERROR_CODE", "message": "Human readable", "details": {}, "requestId": "uuid" }
// Frontend: axios interceptors → toast для 4xx, Sentry для 5xx, retry для 429
```

### 23.3 Request Validation (Zod на обеих сторонах)
```ts
// shared/schemas/auth.ts — используется и на фронте, и на бэке
export const LoginSchema = z.object({ email: z.email(), password: z.min(8) });
```
Фиксит: дублирование валидации, рассинхрон схем.

---

## 24. Performance & Quality

### 24.1 Performance Budget
```yaml
# budgets.json
- First Contentful Paint: < 1.2s
- Time to Interactive: < 2.5s
- Bundle size (initial): < 150 KB gzip
- Lighthouse: > 90 все категории
- Core Web Vitals: LCP < 2.5s, CLS < 0.1, INP < 200ms
```
Проверять в CI. Фиксит: «Почему на 3G приложение не юзабельно?»

### 24.2 PWA / Service Worker
```ts
// vite-plugin-pwa
// - Offline fallback page (cache-first для статики)
// - Background sync для сообщений (отправлено в offline → sync when online)
// - Push notifications (FCM)
```
Фиксит: пользователь в метро отправляет сообщение → «Failed to fetch».

### 24.3 Image Strategy (Responsive Images)
```html
<picture>
  <source srcset="avatar.avif" type="image/avif">
  <img src="avatar.webp" loading="lazy" decoding="async" alt="...">
</picture>
```
Правило: всегда lazy, всегда WebP/AVIF, всегда размеры.

---

## 25. Accessibility & UX

### 25.1 a11y Checklist
- [ ] Все интерактивные элементы ≥ 44×44px (touch target)
- [ ] Focus trap в модалках (react-focus-lock)
- [ ] Skip-to-content link
- [ ] aria-live для динамических уведомлений (новый мэтч)
- [ ] Reduced motion respect (prefers-reduced-motion)
- [ ] Color contrast ≥ 4.5:1
Фиксит: Apple/Google review отклоняют за плохую a11y.

### 25.2 Loading States & Skeletons
Правило: никаких «Loading...» текстов
- <Skeleton /> для карточек профилей
- <Spinner /> только для кнопок действий
- Optimistic UI для лайков/сообщений

---

## 26. Database & Backend Patterns

### 26.1 Database Query Optimization
- [ ] Все JOIN с EXPLAIN ANALYZE перед merge
- [ ] N+1 запрещены (DataLoader или JOIN)
- [ ] Индексы на всех foreign keys
- [ ] Индексы на частых WHERE (email, user_id, created_at)
- [ ] Composite indexes для частых комбинаций (user_id + status)
- [ ] Пагинация: cursor-based для ленты, offset только для админки

### 26.2 Soft Deletes & Audit Log
```sql
-- Все таблицы: deleted_at TIMESTAMP NULL
CREATE TABLE audit_log (
  id, table_name, record_id, action, old_values JSON, new_values JSON,
  user_id, ip_address, created_at
);
```
Фиксит: «Пользователь жалуется, что фото пропало» — нет истории. GDPR + безопасность.

### 26.3 Idempotency Keys (универсальные)
```ts
// Все мутации POST/PUT/PATCH:
Headers: { 'Idempotency-Key': uuid }
// Redis: SET idempotency:key:uuid "processed" EX 86400
```
Фиксит: двойная оплата, двойный лайк, дубли сообщений при плохом соединении.

### 26.4 Circuit Breaker для внешних API
```ts
// Stripe, Twilio, S3, FCM
// - 5 ошибок подряд → OPEN (fallback на queue/ретрай)
// - 30 секунд → HALF-OPEN (1 тестовый запрос)
```
Фиксит: каскадный отказ. Если Stripe down — приложение не должно падать.

---

## 27. Security Deep Dive

### 27.1 Content Security Policy (CSP) Strict
```ts
// Helmet CSP:
default-src 'self';
script-src 'self' 'nonce-{random}';
style-src 'self' 'unsafe-inline';
img-src 'self' blob: data: https://cdn.swiftmatch.app;
connect-src 'self' wss://api.swiftmatch.app;
```

### 27.2 Webhook Signature Verification
```ts
// Не только Stripe — любой webhook:
const signature = req.headers['x-signature'];
const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
if (!crypto.timingSafeEqual(signature, expected)) throw 401;
```
Фиксит: фейковые webhook-запросы.

### 27.3 Secrets Rotation Playbook
1. Сгенерировать новый JWT_SECRET
2. Деплой с поддержкой 2 ключей (verify: [old, new], sign: new)
3. Ждать 7d (TTL токена)
4. Убрать old key
5. Аналогично для DB password, Stripe keys, SMTP

---

## 28. Observability & Reliability

### 28.1 Structured Logging (Winston JSON)
```json
{
  "level": "error", "message": "Payment failed",
  "service": "swiftmatch-api", "version": "1.2.3",
  "requestId": "uuid", "userId": "123", "traceId": "jaeger-trace",
  "timestamp": "ISO8601"
}
```

### 28.2 Health Checks (Readiness vs Liveness)
```ts
// /health/live — сервер запущен (always 200)
// /health/ready — DB, Redis, S3 доступны (200/503)
// Kubernetes использует readiness для трафика, liveness для рестарта
```

### 28.3 Graceful Shutdown
```ts
process.on('SIGTERM', async () => {
  server.close(); // stop accepting new connections
  await redis.disconnect();
  await db.end();
  await queue.close();
  process.exit(0);
});
```
Фиксит: потеря WebSocket-сообщений и background jobs при деплое.

---

## 29. Testing & Quality Gates

### 29.1 Testing Pyramid (требования)
- Unit: 70% coverage (business logic, utilities)
- Integration: 20% (API routes, DB queries)
- E2E: 10% (критические флоу: регистрация → лайк → чат → оплата)
- Mutation testing (optional): stryker-js

### 29.2 Visual Regression Testing
```ts
// Chromatic / Storybook + Loki
// - Все состояния компонентов: empty, loading, error, success
// - Скриншоты в CI при каждом PR
```
Фиксит: «После обновления Tailwind кнопка поехала».

### 29.3 Contract Testing (Pact)
```ts
// Frontend consumer ↔ Backend provider
// Гарантия: если бэк меняет API, фронт сломается в CI, не в проде
```
Фиксит: рассинхрон фронта и бэка после «быстрого фикса».

---

## 30. DevOps & Infrastructure

### 30.1 Infrastructure as Code (Terraform / Pulumi)
```hcl
# terraform/
# - AWS: ECS/EKS, RDS, ElastiCache, S3, CloudFront
# - Cloudflare: DNS, WAF, DDoS protection
# - Stripe: webhook endpoints (prod/staging)
```

### 30.2 Blue-Green / Canary Deployment
- Новая версия на 5% трафика → метрики (error rate, latency) → 100%
- Автоматический rollback при error rate > 1%
Фиксит: баг в проде → откат за 30 секунд, не 30 минут.

### 30.3 Database Migration Safety
- Migrations: только additive (добавить колонку), никаких DROP/RENAME в одном PR
- Backfill: отдельный скрипт, не в миграции (блокирует таблицу)
- Shadow database для проверки миграций в CI
Фиксит: ALTER TABLE на 10M записей = downtime.

---

## 31. Бизнес-логика (универсальная)

### 31.1 Subscription Lifecycle Deep Dive
- Trial → Active → Past_due (grace period 3 дня) → Unpaid → Cancelled
- Proration: при апгрейде/даунгрейде
- Retention offers: при попытке отмены — скидка 30%
- Invoice history: PDF generation
Фиксит: пользователь отменяет → теряете revenue. Нет стратегии удержания.

### 31.2 Referral / Invite System
```ts
// invite_codes таблица
// - Каждый пользователь: реферальная ссылка
// - Пригласил 3 друзей → 1 неделя Premium бесплатно
// - Tracking: utm_source, referrer_id
```
Фиксит: органический рост. Дейтинг без вирусности — дорогой paid acquisition.

### 31.3 Rate Limiting Granular
```ts
// - /api/upload: 5/min (фото)
// - /api/like: 30/min free, 100/min premium
// - /api/report: 3/day (флуд репортами)
// - /api/search: 60/min
// - WebSocket: max 100 msg/min
```
Фиксит: abuse API. Пользователь бот-фермы лайкает всех.

---

## 32. Production-паттерны (для этого проекта)

### 32.1 Outbox Pattern (релиабельные события)
```ts
// Вместо прямой отправки в Bull/Socket.IO из HTTP-хендлера:
// 1. INSERT в outbox (table, record_id, event_type, payload JSON)
// 2. Отдельный worker читает outbox и отправляет в queue/WS
// 3. После подтверждения — DELETE из outbox или пометить sent_at
```
Фиксит: потеря событий при падении сервера между commit и queue.send(). Особенно критично для мэтчей и платежей.

### 32.2 Dead Letter Queue + Retry Strategy
```ts
// Для Bull Queue (section 21.3):
// - 3 попытки с exponential backoff + jitter (1s, 4s, 16s)
// - После 3х неудач → DLQ (отдельная очередь)
// - Алерт при > 10 сообщений в DLQ за час
// - Ручной ретрай/скип через админку
```
Фиксит: «Сообщение упало и никто не узнал». Email не отправился, NSFW-проверка не прошла.

### 32.3 Distributed Tracing (OpenTelemetry + Jaeger)
```ts
// server/src/tracing.js
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
// - traceId в каждый HTTP-ответ (X-Trace-Id)
// - Spans: HTTP request, DB query, Redis call, Queue job
// - Jaeger UI: поиск по userId/traceId
```
Фиксит: «Почему запрос занял 3 секунды?» — без трейсинга неизвестно, где тормозит (БД? Redis? Внешний API?).

### 32.4 Cache Strategy + Invalidation Patterns
- Cache-Aside (уже есть в cache.js): GET → если нет в Redis → query → set cache
- Write-Through: PUT → update DB + set cache в одном потоке
- Invalidation on write (уже есть: PUT profile → invalidate, POST like → invalidate matches)
- **Чего не хватает:** TTL с jitter (не сбрасывать весь кэш разом), partial invalidate (только изменённые поля)
Фиксит: «После обновления фото профиля — старая фотка ещё 60 секунд».

### 32.5 Backup Verification
```bash
# После backup-mysql.ps1:
# 1. Создать тестовую БД: CREATE DATABASE swiftmatch_verify;
# 2. Восстановить: mysql ... swiftmatch_verify < backup.sql
# 3. Проверить: SELECT COUNT(*) FROM users > 0
# 4. Удалить тестовую БД: DROP DATABASE swiftmatch_verify;
```
Фиксит: «Бэкапы есть, но восстанавливаются ли они?» — распространённая проблема.

### 32.6 Database Connection Pooling
```ts
// mysql2 pool config для production:
{
  connectionLimit: 20,      // не 10, не 100
  queueLimit: 0,
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000
}
// Мониторинг: pool._allConnections.length, pool._freeConnections.length
// Алерт: если все 20 коннектов заняты > 5 секунд
```
Фиксит: «БД перестала отвечать» — часто из-за истощения пула соединений (неправильный connectionLimit).

### 32.7 Incident Post-Mortem Process
1. Инцидент обнаружен (Sentry / Grafana / пользователь)
2. Contain: откат фичи / блокировка пользователя / read-only mode
3. Diagnose: найти root cause (логи + трейсы + метрики)
4. Fix: deploy + verify
5. Post-mortem: что произошло, почему, что делаем, чтобы не повторилось
Фиксит: «Одна и та же ошибка — каждый месяц». Без post-mortem команда не учится.

---

## 33. Production Launch Playbook

### Проблема: код написан — продукт не готов

Текущий план (разделы 1–32) отлично покрывает **разработку**: код, тесты, архитектура. Но не покрывает **эксплуатацию** (как это работает под нагрузкой), **рост** (как привлекать и удерживать) и **комплаенс** (как не получить штраф).

Ниже — 10 категорий, которые превращают прототип в полноценный продукт.

---

### 33.1 DevOps & Инфраструктура

| Что | Детали | Статус |
|-----|--------|--------|
| **CI/CD Pipeline** | GitHub Actions: lint → test → build → deploy на staging/prod | `.github/workflows/deploy.yml` — есть, расширить |
| **Docker Compose** | `docker-compose.yml` для локальной разработки (MySQL + Redis + Server + Client) | ❌ |
| **Dockerfile** | Multi-stage: deps → build → prod, healthcheck | Есть, но нужен compose |
| **Nginx prod** | gzip/brotli, rate limiting на уровне nginx, WebSocket proxy_pass, SSL (Let's Encrypt) | `nginx/swiftmatch.conf` — есть |
| **Health checks** | `/health` есть. `/ready` для Kubernetes (DB+Redis+S3 доступны) | ❌ `/ready` |
| **Blue-green deploy** | Zero-downtime обновления, rollback за 30s | ❌ |

### 33.2 Мониторинг и Алертинг

| Что | Детали | Статус |
|-----|--------|--------|
| **APM** | New Relic / Datadog / Sentry Performance — не только ошибки, но и slow queries | ❌ |
| **Логи** | Centralized logging: ELK / Grafana Loki / CloudWatch | Winston JSON есть, агрегации нет |
| **Метрики** | Prometheus + Grafana: мэтчи/мин, WS latency, failed payments, banned rate | ❌ |
| **Алерты** | PagerDuty/Opsgenie: /health падает, Stripe webhook 500, Redis/MySQL offline | ❌ |

### 33.3 Мобильный опыт (Capacitor)

| Что | Детали | Статус |
|-----|--------|--------|
| **Push (FCM)** | Firebase Cloud Messaging для мэтчей, сообщений, лайков. Без пушей — 60% уходят | ✅ VAPID (Web Push). FCM для Android — ❌ |
| **Deep Links** | `https://swiftmatch.app/chat/123` → открывается сразу в чате | ❌ |
| **Background sync** | Загрузка сообщений при возвращении из background | ❌ |
| **App Store / Play Store** | Скриншоты, описание, privacy policy, age rating (17+ для дейтинга) | ❌ |

### 33.4 Безопасность и Compliance

| Что | Детали | Статус |
|-----|--------|--------|
| **GDPR / CCPA** | «Delete my account» физически удаляет данные. Экспорт данных пользователя | ❌ |
| **Privacy Policy + ToS** | Обязательны для App Store и Stripe | ❌ |
| **Age verification** | Дейтинг 18+. Флаг при регистрации + модерация | ❌ |
| **AI moderation** | AWS Rekognition / Google Vision на nudity/violence + ручная очередь | ⚠️ scaffold |
| **Report escalation** | Auto-ban при N репортах, очередь для модератора, приоритеты | ❌ |

### 33.5 Аналитика и Рост

| Что | Детали | Статус |
|-----|--------|--------|
| **Product Analytics** | Amplitude / Mixpanel / PostHog: funnel (регистрация → первый лайк → первый мэтч → первое сообщение) | ❌ |
| **A/B Testing** | Optimizely / GrowthBook: цвета кнопок, порядок фото, цены премиума | ❌ |
| **Crashlytics** | Firebase Crashlytics для мобильного приложения | ❌ |
| **SEO** | SSR или prerender для публичных профилей (если «поделиться профилем») | ❌ |

### 33.6 Платежи и Монетизация

| Что | Детали | Статус |
|-----|--------|--------|
| **Subscription management** | Upgrade/downgrade/cancel, grace period, proration | ⚠️ частично |
| **In-app purchases** | Для iOS/Android обязательны Apple Pay / Google Pay. Stripe внутри приложения — нарушение правил Apple | ❌ |
| **Promo codes / Referrals** | «Пригласи друга — 7 дней премиума» | ❌ (раздел 31.2 не реализован) |
| **RevenueCat** | Абстракция над Stripe + Apple IAP + Google IAP. Рекомендуется для мобильного дейтинга | ❌ |

### 33.7 Производительность и Масштабирование

| Что | Детали | Статус |
|-----|--------|--------|
| **CDN** | Cloudflare / AWS CloudFront для фото (не гонять 5MB аватарки через сервер) | ❌ |
| **Image optimization** | WebP/AVIF, responsive sizes. Sharp pipeline есть, CDN нет | ⚠️ Sharp есть, CDN нет |
| **DB optimization** | Индексы, read replicas, SPATIAL INDEX для geo | ⚠️ частично |
| **Connection pooling** | Pool max = 20+ для нагрузки. Мониторинг пула | ⚠️ scaffold |
| **Load balancing** | >1 инстанс сервера → Socket.IO Redis Adapter | ❌ |

### 33.8 UX / Продуктовые фичи

| Что | Детали | Статус |
|-----|--------|--------|
| **Onboarding flow** | Интерактивный туториал: «Свайпни вправо», «Напиши приветствие» | ❌ |
| **Smart matching** | Score на основе интересов, активности, ELO-подобный рейтинг | ❌ (сейчас просто geo + gender) |
| **Icebreakers** | Подсказки первого сообщения («Спроси про фото с собакой») | ❌ |
| **Stories / Moments** | Ephemeral content (как Tinder/Bumble) — повышает retention | ❌ |
| **Video chat UX** | WebRTC есть (Stage 1), но нет UI для инициирования, очереди звонков | ⚠️ базовая интеграция |

### 33.9 Тестирование (дополнение)

| Что | Детали | Статус |
|-----|--------|--------|
| **Load Testing** | k6/Artillery: 1000 concurrent WS, 100 лайков/сек | ❌ |
| **Chaos Engineering** | Что если Redis упадёт? Graceful fallback к DB | ❌ |
| **Visual Regression** | Percy/Chromatic для UI-компонентов shadcn/ui | ❌ |

### 33.10 Документация и API

| Что | Детали | Статус |
|-----|--------|--------|
| **OpenAPI (Swagger)** | Полный coverage всех роутов + примеры ответов | ⚠️ начат, не полный |
| **API Versioning** | `/api/v1/...` — обязательно до первого релиза, иначе сломаешь мобильные клиенты | ❌ |
| **Postman Collection** | Для тестирования и onboarding новых разработчиков | ❌ |

---

### 33.11 Priority Timeline (что делать в каком порядке)

| Фаза | Что делать | Почему срочно |
|------|-----------|---------------|
| **Неделя 1-2** | Push-уведомления (FCM) + Deep Links | Без этого мобильное приложение — мёртвое |
| **Неделя 3-4** | CI/CD + Docker + nginx + SSL | Ручной деплой = боль и ошибки |
| **Неделя 5-6** | Apple/Google IAP через RevenueCat | App Store отклонит без нативных платежей |
| **Неделя 7-8** | CDN для фото + Image optimization | Трафик фото убьёт сервер первым |
| **Месяц 2** | Analytics + A/B testing | Нельзя оптимизировать то, что не измеряешь |
| **Месяц 2-3** | AI-модерация фото + GDPR compliance | Бан в App Store или штраф GDPR = смерть проекта |

---

## 34. Product & Infrastructure Concepts (дополнения к существующим разделам)

### 34.1 Deep Links (универсальные ссылки)

```ts
// Пример: https://swiftmatch.app/chat/123
// Настройка:
// 1. Apple App Site Association: /.well-known/apple-app-site-association
// 2. Android: assetlinks.json в корне
// 3. Capacitor: @capacitor/app-launcher
// 4. Route: /chat/:chatId → openChat(chatId) (React Router)
// 5. Web: history.pushState → navigator.serviceWorker → focus window
```
Фиксит: пользователь кликает ссылку из пуша — попадает на главную, а не в чат.

### 34.2 In-App Purchases (Apple/Google IAP)

**Правило Apple:** любое цифровое преимущество (Premium, лайки, суперлайки) должно оплачиваться через Apple IAP, иначе App Store отклоняет приложение.

```ts
// Стратегия:
// 1. RevenueCat как абстракция (один SDK для Stripe + Apple + Google)
// 2. Сервер верифицирует receipt через RevenueCat REST API
// 3. В iOS: только IAP. В Android: IAP + Google Pay. В Web: Stripe.
// 4. Проверка entitlement на сервере при каждом запросе
```
Фиксит: App Store rejection + loss of 30% revenue если использовать Stripe внутри iOS приложения.

### 34.3 Stories / Moments (Ephemeral Content)

```ts
// Таблица: user_stories (id, user_id, media_url, created_at, expires_at)
// - 24 часа живут, потом DELETE или archive
// - View tracking: story_views (user_id, story_id, viewed_at)
// - UI: горизонтальный ряд кругов сверху, тап → переключение
```
Фиксит: Tinder и Bumble имеют stories — повышают DAU на 20%. Без них приложение выглядит устаревшим.

### 34.4 Smart Matching Algorithm

```ts
// matching_score = 
//   w1 * interest_overlap     (0-1, общие интересы / всего интересов)
//   + w2 * age_distance       (обратная разница: 1 - |age1-age2|/50)
//   + w3 * location_proximity (0-1, чем ближе тем выше)
//   + w4 * activity_score     (0-1, когда последний раз был онлайн)
//   + w5 * elo_rating         (0-1, нормализованный ELO)
```
Фиксит: «Почему мне показывают людей, с которыми у меня 0 общего?». Случайный порядок убивает конверсию в мэтч.

### 34.5 Crashlytics (Mobile)

```ts
// Capacitor: @capacitor/crashlytics (Firebase)
// Или Sentry: @sentry/capacitor
// - symbolication для JS stacktraces
// - Breadcrumbs перед крашем
// - User ID в контексте (чтобы знать, кто падает)
```
Фиксит: краши на мобильном устройстве невидимы в Sentry на вебе. JS ошибки ≠ нативные краши.

### 34.6 SEO для публичных профилей

```html
<!-- Если планируется «поделиться профилем» -->
<meta property="og:title" content="Анна, 25" />
<meta property="og:description" content="Люблю собак и путешествия" />
<meta property="og:image" content="https://cdn.swiftmatch.app/avatars/user_123.jpg" />
```
Если нет SSR — использовать prerender.io или `@prerenderer/express` для статической генерации страниц профилей.

### 34.7 Age Verification / Age Rating (17+)

**Требования App Store:**
- Дейтинг = 17+ (без parental gate)
- При регистрации: обязательное поле возраста (select date)
- Модерация: фото с детьми запрещены (даже если это ваш ребёнок)
- Бан: пользователи младше 18 (если обнаружено)

### 34.8 Privacy Policy + Terms of Service

**Обязательны для:**
- App Store / Google Play
- Stripe (без Privacy Policy не активируют live режим)
- GDPR (штраф до 4% оборота)

**Минимальное содержание:**
- Какие данные собираем (email, фото, геолокация, интересы)
- Как используем (мэтчи, подборки, реклама)
- Cookie policy (есть ли трекеры)
- Как удалить аккаунт
- Контакты DPO

### 34.9 Report Escalation Flow

```sql
-- Автоматическая эскалация репортов:
-- 1 репорт → помечается, фото скрывается (pending)
-- 3+ репорта на пользователя → авто-бан на 24ч
-- 5+ репортов → перманентный бан, уведомление админу
-- Тяжёлые категории (nudity, violence) → мгновенный бан
```
Фиксит: модератор не успевает обрабатывать репорты вручную. Нужен авто-pilot.

### 34.10 Apple Pay / Google Pay (Native Mobile Payments)

```ts
// Capacitor: @capacitor/pay
// - Только для физических товаров / услуг (дейтинг = цифровой продукт → IAP)
// - Для пожертвований / «кофе» = можно Apple Pay
// - Иначе: только IAP через RevenueCat
```

### 34.11 Chaos Engineering (Resilience Testing)

```ts
// Тесты на отказ компонентов:
// 1. Redis недоступен → сервер работает (без кэша), fallback на DB
// 2. SMTP недоступен → письма в очередь, ретрай через 5 мин
// 3. S3 недоступен → загрузка на локальный диск (временный fallback)
// 4. Stripe недоступен → покупки отклоняются с понятной ошибкой
// 5. MySQL read replica недоступен → все запросы на master (degraded)
```
Фиксит: «Мы не знали, что без Redis всё падает» — должно деградировать gracefully.

### 34.12 APM (Application Performance Monitoring)

```ts
// Sentry Performance:
// Sentry.startTransaction({ name: 'GET /api/search', op: 'http.server' })
// → traceId в ответе
// → custom metrics: db.query time, external API calls
// → Slow query tracking (mysql2 + Sentry integrations)
```
Фиксит: Sentry ловит ошибки, но не ловит «сайт тормозит». Нужны traces + spans.
