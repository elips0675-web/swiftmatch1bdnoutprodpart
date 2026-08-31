# Security Rules & Absolute Bans

## What to NEVER do (absolute bans)

- **Никогда** не коммитить `.env` с реальными секретами. `.env` в `.gitignore`, `.env.example` — в репо
- **Никогда** не оставлять `console.log` в продакшен-логике платежей, писем, авторизации. Использовать `req.log` (структурированный лог) или winston
- **Никогда** не добавлять `cors({ origin: '*' })` в веб-версии продакшена. Только для Capacitor (`native.ts` определяет режим)
- **Никогда** не использовать `fs.writeFile` для пользовательских загрузок без валидации пути. Только uuid имена, только `/uploads/` директория
- **Никогда** не возвращать `adminAuth` из активного в пассивный/blocking-режим и не снимать гейт `/api/admin` — это откроет админку без авторизации. `dev-login` в production возвращает 404 — не открывать его заново
- **Никогда** не хранить `refresh_token` в localStorage/Preferences без httpOnly альтернативы. (Сейчас проект использует Bearer в заголовке — это ок, но не добавлять новые sensitive токены в storage)

---

## 🛡️ Security Rules (быстрый чеклист)

- `adminAuth` middleware — **ACTIVE** (с этапа 9): 401 без/невалидный токен, 403 не-админ. Единый гейт `app.use('/api/admin', ...)` в index.js; публичен только `GET /api/admin/features`; `dev-login` → 404 в production
- **ПРАВИЛО adminAuth (qwen #1, этап 37):** защита админ-эндпоинтов — ТОЛЬКО через active-check middleware `adminAuth` (сам валидирует JWT и роль, сам отвечает 401/403). ЗАПРЕЩЕНО: (а) пассивные проверки вида `if (!req.user) next()` без ответа; (б) ручные проверки `req.user.role !== 'admin'` внутри хендлеров вместо middleware; (в) обход/удаление единого гейта `app.use('/api/admin', adminAuth)`. Новые админ-роуты наследуют защиту автоматически; проверка при ревью: запрос без токена обязан вернуть 401 ДО логики хендлера
- Все SQL-запросы — prepared statements (`??` в mysql2). Никакой конкатенации строк.
- Server-side только uuid для имён файлов, ограничение 5MB, только image/*
- CORS: `*` для Capacitor (dev), env-переменная для production
- Sentry beforeSend: фильтрует authorization, cookie, email, IP
- Stripe webhook: `express.raw({ type: 'application/json' })` ДО express.json()
- JWT: 256-bit ключ, 7d expiry, Bearer header
- **Auth-модель (этап 28, ADR):** основной Bearer-токен хранится в sessionStorage (`src/lib/token.ts`) — стандарт для SPA; переход на httpOnly cookie отложен: требует CSRF-защиты, credentials:include во всех 80+ fetch и переписывания E2E. Включать только отдельным этапом с полным прогоном тестов. НЕ добавлять новые sensitive токены (refresh_token) в storage — они в httpOnly-недоступных местах или БД (refresh_tokens)
- Rate limit: `/api/auth/` 60 req/min, общий `/api/` 30 req/s
- Helmet: CSP, X-Frame-Options, X-Content-Type-Options, и др. security headers
- Request ID: UUID на каждый запрос, X-Request-Id в ответе
- Модерация чатов: проверка banned-слов при отправке сообщений
- Бан пользователя + WS `user:banned` (мгновенный разлогин)

## Пользовательский текст (этап 34+)

Свободные текстовые поля юзера чистятся сервером через `stripHtml` из `server/src/sanitize.js` (profile PUT, register display_name, посты групп, сообщения чатов). Новый текстовый input = обязательно добавь stripHtml.
