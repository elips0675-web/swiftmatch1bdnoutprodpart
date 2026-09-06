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

## Требования пользователя (обязательные, верить не могу)

1. **Всё запускается через `запуск-всего.bat`** из корня проекта: MySQL (Laragon, порт 3306) → API (3002) → фронт (8081) → открывает браузер. Пути в батниках **только относительные** (`%~dp0`) — хардкод `D:\...` или `C:\...` ломал запуск и давал «ошибку сохранения» в `/admin/content`.
2. **Frontend запускается в production-режиме** (`npx vite build && npx vite preview --port 8081`), НЕ dev-server с HMR. Причина: в dev первый заход в админку тормозил (горячая компиляция модулей, ~2.6 с), пользователь жаловался «тупит приложение и админка». `vite.config.ts` содержит `preview.proxy` для `/api` и `/socket.io` — preview работает как прод-сервер без on-demand компиляции. Если нужно HMR для разработки — запускать `npx vite` вручную.
3. **После тестов (E2E/k6) ничего не должно ломаться и не оставаться мусора.** E2E-юзеры регистрируются с префиксом `e2e_*`/`layout_*` и плодят дубли hangouts в ленте. Playwright `globalTeardown` удаляет их из БД после каждого прогона (FK CASCADE подчищает связи). Запускать `npm run test:e2e` без последующей чистки БД нельзя.
4. **`/admin/content` (http://localhost:8081/admin/content) должен сохранять без ошибок.** Причина бага была в том, что сервер не стартовал из-за хардкода пути в `.bat`; PUT-backend (`server/src/routes/admin/content.js`) работает корректно.
5. **Профиль (`/profile`, `/profile/edit`) должен редактироваться и сохраняться.** Два фикса (сент 2026): (а) в `server/src/routes/profile.js` маршруты `/api/profile/:id` (GET/PUT) были зарегистрированы ДО статических `/api/profile/aliases`, `/api/profile/verification`, `/api/profile/me` — Express ловил их как `id="aliases"` → 404. Перенес `:id`-роуты в конец файла; (б) в `src/pages/profile-edit.tsx` `handleSave` делал `fetch PUT` БЕЗ заголовка `Content-Type: application/json` (тело не парсилось → изменения не применялись, но тост «Сохранено» всё равно показывался) и без проверки `res.ok` (ложный успех при ошибке), а при пустом списке фото из БД страница не подгружала дефолтные фото и блокировала сохранение проверкой `photos.length === 0`. Теперь: PUT с заголовками, проверка статуса, тост ошибки вместо фейкового успеха, дефолтные фото подставляются если в БД их нет.

## Git & CI

- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- `git commit --no-verify` когда changes проверены (тесты зелёные, сборка проходит)
- Перед PR: `npx vite build`, `npm run test` (frontend), `cd server && npm run test`
- **Никогда** не коммитить `.env` с секретами. `.env.example` — в репо.

---
**Extended docs:** [Architecture](docs/architecture.md) | [Past Mistakes](docs/past-mistakes.md)
