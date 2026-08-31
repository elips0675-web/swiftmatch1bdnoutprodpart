# Project Notes

> **Before starting any task:** прочитай `docs/AGENTS-production.md` (Golden Rule: Production ≠ File Created) и прогони Pre-flight Checklist перед закрытием production-задачи.

## Быстрая навигация (AGENTS разбит на модули)

| Модуль | Что внутри |
|--------|-----------|
| [System Prompt & Core Rules](docs/AGENTS-system-prompt.md) | Персона, стек (React 18, Tailwind v3, shadcn/ui, TS strict), Code Quality, Code Style, Response Format |
| [Pitfall'ы](docs/AGENTS-pitfalls.md) | 22 грабли из опыта (JSX-скобки, JWT_SECRET, Redis fallback, banned-words, WS-realtime...) |
| [Workflow (5 этапов) + Prompt Templates](docs/AGENTS-workflow.md) | Этап 0–4: чтение → план → реализация → тесты → верификация; шаблоны для AI |
| [i18n / translation keys](docs/AGENTS-i18n.md) | Golden Rule «never raw keys», data format, available keys, где лежат переводы |
| [Admin & auth guardrails](docs/AGENTS-admin-auth.md) | adminAuth ACTIVE, единый гейт `/api/admin`, ограничения админ-роутов |
| [Startup & локальная разработка](docs/AGENTS-startup.md) | `запуск-всего.bat`, порты 3002/8081, как поднимать если инфра умерла |
| [Production: DoD + Pre-flight Checklist](docs/AGENTS-production.md) | «Production ≠ File Created», 10 пунктов чеклиста перед продом |
| [Security Rules & Absolute Bans](docs/AGENTS-security.md) | Что NEVER делать, security чеклист |
| [Production Deployment](docs/AGENTS-deployment.md) | Подготовка ключей, варианты хостинга, nginx essentials |

## Гипер-краткое резюме (правила, которые нарушать нельзя)

- **Портики:** сервер **3002**, фронт **8081**, Vite proxy → `http://localhost:3002`. Несоответствие = 502.
- **TypeScript strict**, никаких `any`. Комментарии в коде НЕ добавлять.
- **Всё** в БД/state — translation keys, UI через `t()`. Ни одного raw key пользователю.
- **Все SQL** — prepared statements (`??`). Никакой конкатенации строк.
- **adminAuth ACTIVE** (401/403), единый гейт `/api/admin`, публичен только `GET /api/admin/features`.
- **Redis недоступен** → тихий in-memory fallback, никогда не падать 500 на всех роутах.
- **JWT_SECRET** — lazy getter `JWT_SECRET()`, устанавливать до `jwt.sign()` в тестах.
- **Перед «готово»** — `npx vite build`; перед коммитом — зелёные тесты.
- **Никогда** не коммитить `.env` с секретами; `.env.example` — в репо.

## Git & CI

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- `git commit --no-verify` когда changes проверены (тесты зелёные, сборка проходит)
- Перед PR: `npx vite build`, `npm run test` (frontend), `cd server && npm run test`
- **Никогда** не коммитить `.env` с секретами. `.env.example` — в репо.

---
**Extended docs:** [Architecture](docs/architecture.md) | [Past Mistakes](docs/past-mistakes.md)
