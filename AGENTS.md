# Project Notes

> **Before starting any task:** прочитай `docs/AGENTS-production.md` (Golden Rule: Production ≠ File Created) и прогони Pre-flight Checklist перед закрытием production-задачи.

## Быстрая навигация (AGENTS разбит на модули)

| Модуль | Что внутри |
|--------|-----------|
| [System Prompt & Core Rules](docs/AGENTS-system-prompt.md) | Персона, стек (React 18, Tailwind v3, shadcn/ui, TS strict), Code Quality, Code Style, Response Format |
| [Pitfall'ы](docs/AGENTS-pitfalls.md) | 93 грабли из опыта (JSX-скобки, JWT_SECRET, Redis fallback, banned-words, WS-realtime, канон интересов vs таблица interests, синонимы-дубли, колонка без миграции, мок-хук вешает vitest, DATE уезжает на сутки, `\|\| 0` ломает CHECK, мок БД принимает любые параметры, семантика `.dockerignore`, `rsync --delete` vs прод-`.env`, деплой удаляет непримонтированные данные, блок-лист фильтрует только фид + смена кэш-ключа ломает `invalidate()`, ASI склейка `const f = …` + `[[x]] = …`, счётчики тестов в доках устаревают молча, падение 1 из 4 = гонка по времени, а не флак, `npm audit` без флагов — гейт, который всегда красный или всегда зелёный, гейт по секретам с одним каналом утечки зеленеет на утечке в содержимом, фикстура воспроизводит то, что создаёт тестируемый код, пересказ чужой оценки воспроизводит её числа + «ссылка на этап N» проверяется не в том файле, пустое хранилище выглядит как рабочее + IDOR-тест зелёный на уязвимом коде из-за сдвига параметров, ломка гейта, которая ломает не то, доказывает ноль, мёртвая переменная = незакрытая функция, гейт с несуществующим glob честно зелёный, `*/` в JSDoc рвёт комментарий, `lintFiles` в jsdom, гейт принимает строку-заглушку инвентаря, E2E-гейт живёт только в `deploy.yml` + `INSERT`-сиды из миграций теряются на свежей БД, токен после `goto()` не переживает редирект на `/login`, гейт доволен упоминанием в комментарии, `DELETE FROM partners` без очистки `partner_payouts` = флак на первом прогоне, три копии правил вместо одной (протухающая копия читается как истина), гейт на запрещённой формулировке с исключением для журналов, «граница блока» по `/^\s*\S/` совпадает с любой отступной строкой, `git ls-files` экранирует не-ASCII, гейт по документации против чужих удалений, проверка ссылки не должна требовать зеркала, которого нет в CI, оправдание гейта по номеру строки протухает молча, тест, повторяющий форму проверки вместо самой проверки, тест кода, который пишет в цикл, закрепляет сам N+1, курсор пагинации по времени умирает на TTL-уборке, ответ-страница без признака «есть ещё» неотличим от «это всё», курсор в состоянии расходится с тем, что на экране, недоеденная очередь `mockResolvedValueOnce` переживает `clearAllMocks`, `git checkout --` стирает незакоммиченную работу, гейт сверяет реальность с собственной константой, проверка по наличию незакоммиченного файла в CI зелёна по построению, семантика шаблонов rsync и docker противоположна, `^` без флага `m` привязан к началу блока, ломка по первому совпадению бьёт не туда, `afterAll` выполняется после падения `beforeAll`, пропуск теста честен локально и замаскирован в CI, ломка не той правкой доказывает другой класс дефектов, механическое отбрасывание окончания ломает английские слова, «файл обращается к таблице» ≠ «список относится к ней», экспорт без учёта объявляет живой список мёртвым, покрытие ограничения ищется и среди читателей, `helmet()` на API ≠ заголовки статики (документы отдаёт nginx), собственный `add_header` в `location` обнуляет все заголовки уровня `server`, `npm audit fix --omit=dev` вычищает dev-зависимости) |
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
- **Дрейф схемы = живой 500.** Колонка, которую читает код, обязана быть и в `database/mysql_schema.sql`, **и создаваться миграцией**. Проверка: `node scripts/schema-drift-audit.mjs --offline` (без MySQL) и `node scripts/schema-drift-audit.mjs` (с живой БД, нужен `MYSQL_BIN`). Мок БД не доказывает, что колонка существует.
- **Ограничение в схеме = проверка в коде.** CHECK/ENUM из `database/mysql_schema.sql` отвечают 500, а не 400: клиент должен быть отбит кодом раньше. Правило: диапазонный CHECK обязан быть проверен в том файле, который **пишет** в таблицу (`intField(col,{min,max})` или ручное `< A … > B`), а белый список кода — не шире ENUM. Гейт: `npm run check:enum-constraints` (`scripts/check-enum-constraints.mjs`, джоба `enum-constraints` в `ci.yml` + шаг в `lint-and-typecheck` `deploy.yml`).
- **Прод-зависимости = два lock-файла.** `npm run audit:prod` (корень) и `npm run audit:prod` в `server/` — exit 0 = нет high/critical. Флаги обязательны: `--omit=dev` (в образ едет только прод-часть) и `--audit-level=high` (иначе гейт красный от moderate/low, которые чинятся мажорными обновлениями). Гейт в CI блокирующий: джоба `dependency-audit` + шаги в `lint-and-typecheck` (`deploy.yml`).
- **Заголовки безопасности = периметр, а не middleware.** `helmet()` в `server/src/index.js` отвечает только за ответы Express; SPA и статику отдаёт **nginx** (`nginx/swiftmatch.http.conf` едет в образ, `Dockerfile:30`) и `vercel.json` — там заголовки обязаны быть продублированы. Правило nginx: если в `location` объявлен хоть один свой `add_header` (обычно `Cache-Control`), верхнеуровневые заголовки не действуют — каждый такой `location` повторяет полный набор, а `add_header` без `always` уходит только на 2xx. Гейт: `npm run check:headers` (`scripts/check-security-headers.mjs`, джоба `security-headers` в `ci.yml` + шаг в `lint-and-typecheck` `deploy.yml`).
- **Один источник правил.** Правила — только в `AGENTS.md` + `docs/AGENTS-*.md`; идеи 21–34 — в `docs/product-roadmap.md`; `Промты.txt` — указатель (таблица «тема → где правило»), а не копия. Архивы (`context.txt`, `docs/roadmap.md`) несут в шапке дату среза и ссылку на канон. Гейт: `npm run check:docs` (`scripts/docs-canon-audit.mjs`, джоба `docs-canon` в `ci.yml` + шаг в `deploy.yml`). Написать правило в третий файл = вернуть дыру, которую закрыли в коде.
- **Никогда** не коммитить `.env` с секретами; `.env.example` — в репо.

## Требования пользователя (обязательные, верить не могу)

1. **Всё запускается через `запуск-всего.bat`** из корня проекта: MySQL (Laragon, порт 3306) → API (3002) → фронт (8081) → открывает браузер. Пути в батниках **только относительные** (`%~dp0`) — хардкод `D:\...` или `C:\...` ломал запуск и давал «ошибку сохранения» в `/admin/content`.
2. **Frontend запускается в production-режиме** (`npx vite build && npx vite preview --port 8081`), НЕ dev-server с HMR. Причина: в dev первый заход в админку тормозил (горячая компиляция модулей, ~2.6 с), пользователь жаловался «тупит приложение и админка». `vite.config.ts` содержит `preview.proxy` для `/api` и `/socket.io` — preview работает как прод-сервер без on-demand компиляции. Если нужно HMR для разработки — запускать `npx vite` вручную.
3. **После тестов (E2E/k6) ничего не должно ломаться и не оставаться мусора.** E2E-юзеры регистрируются с префиксом `e2e_*`/`layout_*` и плодят дубли hangouts в ленте. Playwright `globalTeardown` удаляет их из БД после каждого прогона (FK CASCADE подчищает связи). Запускать `npm run test:e2e` без последующей чистки БД нельзя.
4. **`/admin/content` (http://localhost:8081/admin/content) должен сохранять без ошибок.** Причина бага была в том, что сервер не стартовал из-за хардкода пути в `.bat`; PUT-backend (`server/src/routes/admin/content.js`) работает корректно.
5. **Профиль (`/profile`, `/profile/edit`) должен редактироваться и сохраняться.** Два фикса (сент 2026): (а) в `server/src/routes/profile.js` маршруты `/api/profile/:id` (GET/PUT) были зарегистрированы ДО статических `/api/profile/aliases`, `/api/profile/verification`, `/api/profile/me` — Express ловил их как `id="aliases"` → 404. Перенес `:id`-роуты в конец файла; (б) в `src/pages/profile-edit.tsx` `handleSave` делал `fetch PUT` БЕЗ заголовка `Content-Type: application/json` (тело не парсилось → изменения не применялись, но тост «Сохранено» всё равно показывался) и без проверки `res.ok` (ложный успех при ошибке), а при пустом списке фото из БД страница не подгружала дефолтные фото и блокировала сохранение проверкой `photos.length === 0`. Теперь: PUT с заголовками, проверка статуса, тост ошибки вместо фейкового успеха, дефолтные фото подставляются если в БД их нет.

## Git & CI

- Правила вклада (для новых участников): `CONTRIBUTING.md` — стек, гейты, шаблон PR. Рубика «Оценка и улучшение промтов» — `docs/AGENTS-workflow.md`.
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`
- `git commit --no-verify` когда changes проверены (тесты зелёные, сборка проходит)
- Перед PR: `npx vite build`, `npm run test` (frontend), `cd server && npm run test`
- **Никогда** не коммитить `.env` с секретами. `.env.example` — в репо.
- **Локальное зеркало репозитория (страховка от недоступности GitHub/2FA):** `E:\swiftmatch-backup.git` — bare-копия, создана `git clone --mirror`. После каждого закоммиченного изменения обновлять: `E:\swiftmatch-backup.git\update.cmd` (`git -C ... remote update --prune`). GitHub — только удалённая копия; полная история всегда есть локально в `.git` и в зеркале.
- **Облачный бэкап (папка `E:\swiftmatch-backup`, скидывать на облако после значимых изменений):**
  - git-история одним файлом: `git -C "E:\Eswiftmatch1bdnoutprodpart1" bundle create "E:\swiftmatch-backup\swiftmatch-backup.bundle" --all`
  - исходники zip (без node_modules/.git/dist/playwright-report/.auth/*.log): `tar.exe -a -c -f "E:\swiftmatch-backup\swiftmatch-src.zip" --exclude=node_modules --exclude=.git --exclude=dist --exclude=playwright-report --exclude=test-results --exclude="e2e/.auth" --exclude="*.log" -C "E:\Eswiftmatch1bdnoutprodpart1" .`
  - Суммарно ~28 MB; восстановление кода из zip — распаковать + `npm install`; из bundle — `git clone bundle`.
  - дамп MySQL в `E:\swiftmatch-backup\db\`: `powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\backup-mysql.ps1" -DbName swiftmatch -BackupDir "E:\swiftmatch-backup\db" -RetentionDays 30` (auto-detect mysqldump, retention 30 дней). Восстановление: `mysql -uroot swiftmatch < swiftmatch_<timestamp>.sql`.

---
**Extended docs:** [Architecture](docs/architecture.md) | [Past Mistakes](docs/past-mistakes.md)
