# CRITICAL: Don't break admin save / auth

- **`adminAuth` is ACTIVE** (since этап 9): 401 without/invalid token, 403 for non-admin (`server/src/middleware/adminAuth.js` + local copy in `server/src/index.js:92`)
- All `/api/admin/*` routes are protected by a single gate in `server/src/index.js:195` (`app.use('/api/admin', ...)`) — the ONLY public admin route is `GET /api/admin/features` (the app calls it without a token)
- New admin routes are mounted under `/api/admin` and automatically get the gate; do NOT remove or bypass it
- `AdminGuard` (`src/components/shared/admin-guard.tsx`) does `dev-login` to OBTAIN a token (frontend-side), then sends it as Bearer; `dev-login` returns 404 in production
- **Do NOT change badge/oval CSS in admin-content.tsx** — the user is very sensitive about this

## Правило adminAuth (qwen #1, этап 37)

Защита админ-эндпоинтов — ТОЛЬКО через active-check middleware `adminAuth` (сам валидирует JWT и роль, сам отвечает 401/403). ЗАПРЕЩЕНО:
- (а) пассивные проверки вида `if (!req.user) next()` без ответа;
- (б) ручные проверки `req.user.role !== 'admin'` внутри хендлеров вместо middleware;
- (в) обход/удаление единого гейта `app.use('/api/admin', adminAuth)`.

Новые админ-роуты наследуют защиту автоматически; проверка при ревью: запрос без токена обязан вернуть 401 ДО логики хендлера.

## Ограничения админ-роутов

- Все новые админ-роуты возвращают массивы для таблиц (`[{...}, {...}]`), а не объекты `{data: [...]}` — Recharts и DataTable ломаются
- SQL-запросы обёрнуты в try/catch, пустой результат заменяется на `[]` или `{}` — никаких `chartData.slice is not a function`
- Пути внутри admin-роутеров ОТНОСИТЕЛЬНЫЕ (`router.get('/partners')`), не полные (`/api/admin/partners`) — иначе двойной префикс → тихий 404 на проде
