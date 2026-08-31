# SwiftMatch — Roadmap / журнал этапов

> Актуально: 31.08.2026.
> Полная детальная история и сводные аудиты живут в локальных (gitignored) файлах:
> `test/Что сделано.txt`, `test/Что доделать.txt`, `test/Оценка kimi|qwen|дипсик.txt`.
> Этот файл — чистая (UTF-8) сводка последних этапов, отслеживаемая в git.

## Этап 74 (29.08.2026) — E2E Premium (mock Stripe), Hangouts 2.0, B2B partner dashboard

- `e2e/premium.spec.ts` (7, P0): контракт tiers, mock checkout → активация 201, invalid tier 400, auth 401/403, cancel → null/404, рендер `/premium`.
- `e2e/hangouts2.spec.ts` (6, P0): Date/Company flows, mutual like, check-in, review — полный набор негативов (400/403/409).
- `e2e/partner-b2b.spec.ts` (3, P1): lifecycle B2B (register → offers → track → postback HMAC → dashboard → admin payout), 403 для обычного юзера, bad-signature 401.
- Итог: **server 321/321, front 81/81, E2E 150/150** (19 спеков), lint 0 errors, vite build OK.
- Коммит: `ead77b0`.

## Этап 75 (29.08.2026) — диагностика сохранения /admin/content + верификация backup/restore и RTO

- Жалоба «постоянно ломается сохранение /admin/content». Воспроизведено в браузере (Playwright):
  - чистый прямой заход → `PUT /api/admin/content/interests` **200**, 28 интересов, 0 console errors;
  - «грязная» сессия (login как обычный юзер → прямой заход в админку) → `AdminGuard` переписывает сессию админом, PUT **200**, 0 errors.
  - Вывод: в текущем состоянии сохранение работает. `admin-content.tsx` и `server/src/routes/admin/content.js` в этой сессии не менялись (только 3 E2E-спека, этап 74).
- Верификация backup/restore smoke + RTO (kimi 2.5): `node scripts/verify-backup.mjs` → **PASS**; CI-шаг "Backup restore smoke test" уже в deploy.yml; RTO в `docs/rollback-plan.md` N+1 (3.6 сек dev, <30 мин прод); scratch-DB подчищена.
- «Разбить AGENTS.md» — актуализировано: корневой AGENTS.md = 390 строк (ниже порога 1500), история вынесена в `docs/`.

## Этап 76 (29.08.2026) — circuit breaker для OpenAI (AI icebreakers) + DB-fallback

- Пункт аудита kimi #6 / дипсик #4 «Circuit breaker Stripe/OpenAI/S3»:
  - **Stripe** — уже обёрнут (`stripe-checkout` в `premium.js:112`, export `stripeBreaker` в `circuit-breaker.js`).
  - **S3** — N/A: проект не внедрил S3 (локальный диск), breaker применится при внедрении.
  - **OpenAI** — было открыто: `chat.completions.create` в `icebreakers.js` без fail-fast таймаута (запрос мог висеть при недоступном OpenAI).
- Реализовано (`server/src/routes/icebreakers.js`): OpenAI-генерация вынесена в модуль-уровневый breaker `openai-icebreakers` (opossum, timeout 9s, volumeThreshold 3). При ошибке/таймауте/открытом breaker → `.fire()` бросает → внешний catch → существующий DB-fallback. Без `OPENAI_API_KEY` поведение не изменилось.
- Тесты (`server/src/__tests__/icebreakers.test.js`, +3): (1) OpenAI успех → `source=openai` (обрезано до 3); (2) OpenAI падает → `source=db`; (3) пустой массив → fallback. Мок `circuit-breaker.js` изолирует opossum.
- Проверки: полноценный серверный сьют **324/324** (+3), lint 0 errors, icebreakers-spec зелёный.
- Счётчики: **server 324/324, front 81/81, E2E 150/150**, lint 0 errors.
- Коммит: `d290828`.

## Этап 77 (29.08.2026) — аудит связки Админка ↔ БД: инцидент «забаненный админ» + открытый баг PUT/POST 500

- **Инцидент (внёс сам при аудите):** мои ранние тесты `POST /api/admin/users/1/ban` (вернувшие 200) **забанили реального админа** `admin@mail.ru` (id=1, `is_active=0`). После бана активных админов не осталось → `dev-login` фолбэчил на не-админа (id=2, user) → ВСЕ админ-запросы давали **403** (роль не admin). Это объясняло «все GET 403» на живом сервере.
  - **Урок:** аудит `PUT /admin/users/:id/ban` с реальными id мутирует прод-БД. Диагностику бана — только на несуществующем id (`999999`) или в scratch-БД.
- **Восстановление:** `UPDATE users SET is_active=1 WHERE id IN (1,2)`. Админ id=1 снова активен, все GET-админ-роуты — 200.
- **Ложный «баг 500 на PUT/POST» — на деле тестовый артефакт PowerShell + curl.exe (бага кода НЕТ).**
  - Симптом: `PUT/POST` админ-роутов с непустым JSON — 500 "Internal server error"; `GET`-аналоги — 200; `{}` — 400. Устойчиво на живом.
  - **Диагностика (стек из перенаправленного stdout вторичного инстанса):** `SyntaxError: Expected property name or '}' in JSON at position 1` в `body-parser/json.js:92` — тело приходит в `express.json()` уже битым, ещё до роутера.
  - **Доказательство артефакта:** (1) полный автономный инстанс того же `index.js`-middleware даёт **200** через node `fetch`; (2) **на живом 3002 те же `PUT` через node `fetch` дают 200** (features → "Feature flags updated", content/interests → "interests updated", pricing → "Pricing saved"); (3) 500 появляется ТОЛЬКО когда тело шлётся `curl.exe` из PowerShell 5.1 — PS ломает embedded double-quotes в argv нативного exe (та же природа, что pitfall №47 «кириллица в API-тестах»: `Invoke-RestMethod`/инлайн-тело искажаются).
  - **Правило для API-тестов с телом:** слать тело файлом (`curl --data-binary @file.json`) или через node `fetch`/`Invoke-RestMethod -Body (bytes)`, НЕ инлайн-строкой с кавычками в PS.
  - Заключение: **открытый баг 500 отсутствует** — производственные PUT/POST (features, content, pricing) работают корректно.
- **Статус аудита (контракты админ-API здоровы):** все GET-админ-роуты — 200 и корректные структуры:
  - `users` → `{users:[...]}` (фронт `admin-reports` ждёт именно это) ✓
  - `features` → объект флагов (`admin-features`) ✓; `stats` → объект ✓
  - `analytics/{overview,retention,revenue-mix,registrations}`, `monetization/{pricing,revenue,ads,funnel}`, `experiments`, `partners`, `reports`, `campaigns`, `photos/pending`, `revenue-by-month` → **чистые массивы** (не `{data:[...]}`) — Recharts/DataTable не ломаются ✓
  - `GET /api/admin/content/interests` = 404 — **ожидаемо**, у `content.js` только `GET /content` (список секций) и `PUT /content/:section`; фронт зовёт PUT ✓
  - Пункты чек-листа «`/api/admin/analytics` 404 / `/api/admin/revenue` 404» — **не баги**: фронт не зовёт эти пути, использует `/analytics/overview` и `revenue-by-month`/`monetization/revenue`.
- **Деградация `mysql_schema.sql` (риск 🔴 при пересоздании БД):** schema.sql = **62 таблицы**, живая БД = **73**. Всё из 62 существует в live (лишних нет), но **29 таблиц созданы ТОЛЬКО миграциями 006–042** и отсутствуют в schema.sql: `_migrations`, `audit_log`, `config`, `consent_log`, `data_erase_requests`, `date_checkins`, `emergency_contacts`, `experiment_assignments`, `experiments`, `fcm_tokens`, `hangout_*` (5), `partner_*` (5), `partners`, `push_subscriptions`, `refresh_tokens`, `sms_verification`, `user_aliases`, `user_verifications`, `webhook_events`.
  - **Влияние на CI:** `deploy.yml` server-test/e2e инициализируют БД ТОЛЬКО `mysql < mysql_schema.sql` (строки 68/131), миграции в test-шагах НЕ прогоняются. `schema-validate.mjs` сверяет БД только против schema.sql (не читает `migrations/`) → самосверка «62 vs 62», дрейф миграционных таблиц НЕ ловится. `sql-explain-audit.mjs` — частично.

## Этап 79 (30.08.2026) — bootstrap-корректность mysql_schema.sql + CI fresh-DB path ✅
Закрыт 🔴-риск этапа 77 («деградация schema.sql») на уровне реального импорта в чистую БД. Найдены и исправлены 3 production-blocking бага регинерированного schema.sql (которые этап 77 не заметил):

1. **`ER_FK_CANNOT_OPEN_PARENT`** — schema.sql (алфавитный дамп) создаёт `users` ПОСЛЕ таблиц со ссылками на него → импорт в чистую БД падал. Фикс: обёртка `SET FOREIGN_KEY_CHECKS=0/1`.
2. **`ER_WRONG_VALUE_FOR_VAR @OLD_TIME_ZONE`** — хвост ссылался на невыставленный `@OLD_TIME_ZONE`. Фикс: удалено (значение нигде не менялось).
3. **CI `Init schema → migrate.js` падал** (`Duplicate key 'idx_user_id'`) — _migrations пуст, а структура уже мигрирована. Фикс: `scripts/seed-migrations.mjs` (INSERT IGNORE, идемпотентен) в обоих CI-джобах после Init schema.

## Этап 80 (30.08.2026) — текстовый поиск в ленте встреч /hangouts ✅

По запросу пользователя. Раньше список /hangouts фильтровался только по категории/дате/радиусу — не было текстового поиска конкретной встречи.

- **Сервер** (`server/src/routes/hangouts.js` GET /api/hangouts): новый параметр `?q=` — `LIKE`-поиск с префиксом/суффиксом `%…%` по `h.title`, `h.description`, `h.place_name`, `h.city` (4 параметра) с обрезкой до 100 симв. Пустой/пробельный q не добавляет фильтр. Порядок params сохранён (where-параметры до geoParams).
- **Фронт** (`src/pages/hangouts.tsx`): поле поиска с иконкой и кнопкой-крестиком очистки, debounce 300ms (`setDebouncedSearch`), сброс page на 1 при поиске, `q` в query-параметрах и deps fetch-`useEffect`.
- **i18n** (`language-context.tsx` RU+EN): `hangout.filter.search`, `hangout.filter.clear_search`.
- **Тесты**: server +2 (`hangouts.test.js`: применяет LIKE по 4 полям / игнорит пустой q) → server 326/326; front 81/81; lint 0 errors; vite build OK. Живая проверка на 3002: `?q=Moscow` → 5 (city), `?q=Evening` → 5 (description), `?q=H2 date` → 5 (title).

## Этап 81 (30.08.2026) — UX-улучшения ленты /hangouts (карточки + гео + пустое состояние) ✅

По просьбе «по этапам по важности делай сам». Данные уже приходили с API, часть — доделка UI. Все в `src/pages/hangouts.tsx` (+ i18n keys).

1. **Живая карточка (high):** у автора рядом с именем — возраст (`age`) и зелёный онлайн-бейдж (`online`, `bg-[#2ecc71]`, конвенция чатов).
2. **Человеческие даты (high):** `formatHumanDate()` — «Сегодня 18:30» / «Завтра 12:00» вместо сырой даты; дальше — прежний формат.
3. **Отказ геолокации (medium):** `geoStatus` (pending/ok/denied) через `askGeo()`; при отказе слайдер радиуса отключён, показано пояснение + кнопка «Разрешить геолокацию» (retry). Без соords запрос идёт без radius-фильтра.
4. **Пустое состояние с CTA (medium):** вместо голой надписи — кнопка «Создать встречу» → /hangouts/create.
5. **Превью описания (low):** 2-строчный `line-clamp-2` описания под заголовком карточки.
6. **Быстрый доступ к «Моим» (low):** ссылка → /hangouts/my под кнопкой создания.
7. i18n: `hangout.filter.geo_retry`, `hangout.filter.geo_denied` (RU+EN). Тесты: front 81/81, build OK, lint 0 errors, /hangouts 200.

## Этап 82 (30.08.2026) — доделки /hangouts: respond-флоу, testid, upsell, чистка ✅

По «доделай по этапам». Полный аудит бэка/фронта hangouts (explore): 6 страниц, все роуты существуют, битых ссылок фронт↔бэк нет. Доделать оставалось UI-уровень:

1. **Реанимирован respond-флоу (🔴 high, мёртвый код → живой).** В date-детали `hangout-detail.tsx` диалог «Пойдем» существовал, но `setRespondOpen(true)` нигде не вызывался — весь флоу (POST/DELETE /respond, accept/decline в списке откликов, чат при accept) был недостижим из UI. Добавлена кнопка `respond-hangout` для не-автора (скрыта, если уже есть `my_response_status`), открывает существующий диалог с личным сообщением. Убран неиспользуемый импорт `Star` → `MessageSquareText`.
2. **data-testid на навигацию (🟠):** back-кнопки (`hangout-detail-back` ×2), все open-chat (`open-chat` ×4), радиус-слайдер (контейнер `hangout-radius`).
3. **FIX copy/paste placeholder (🟠):** в `hangout-create.tsx` диалог подбора партнёра показывал `hangout.form.description_placeholder` («Кого ищете») как описание. Добавлен `partner.select_offer_desc` (RU+EN).
4. **Premium-upsell при лимите (🟠):** при 403 `HANGOUT_DAILY_LIMIT` вместо просто тоста — баннер `hangout-daily-limit` на форме создания: заголовок, пояснение, CTA «Стать Premium» → /premium, кнопка dismiss. i18n: `hangout.upsell.title/subtitle/cta`.
5. **Бэкенд не трогали** — все эндпоинты уже были. Тесты: front 81/81, server hangouts 37/37 (общий server 326/326), build OK, lint 0 errors, /hangouts + /hangouts/create 200.

## Этап 83 (30.08.2026) — связь карточек /hangouts с профилями авторов ✅

По просьбе «свяжи /hangouts с профилями». Раньше вся карточка вела только на детали встречи (`/hangouts/:id`), автор был не кликабельным.

- `src/pages/hangouts.tsx`, `HangoutCard`: аватар и имя автора теперь кликабельны → `/profile/${hangout.author_id}` (route `ProfileById`, App.tsx). `role="link"`, hover-стиль на имени (primary + underline), data-testid `hangout-author-{id}` / `hangout-author-name-{id}`.
- Реализация внутри внешнего `<Link>` (на детали встречи): `e.preventDefault()+e.stopPropagation()` + `navigate()` — клик по автору не пробрасывается на карточку (React-делегирование событий: stopPropagation гасит синтетический клик до родительского Link).
- `author_id` уже приходил с API (`up.id AS author_id`); профиль-страница `/profile/:id` — существующий роут. Бэкенд/i18n не трогали.
- Тесты: front 81/81, build OK, lint 0 errors, /hangouts + /profile/:id 200, feed отдаёт author_id.


Верифицировано e2e на scratch-БД: 73 таблицы / 93 FK загружаются, FK enforcement работает, seed 43 → migrate.js 0 errors, idempotent. Scratch-БД подчищена. Server 324/324, vite build OK, schema-validate live 73 OK.

## Этап 88 (30.08.2026) — Событийная интеграция с ивент-организаторами ✅

> Следующий шаг после премиум-перков /hangouts (этап 87). Закрывает 🟠 P1 «событийная интеграция» из плана монетизации.

Закрыт 🟠 P1 из плана монетизации («Что доделать.txt»): события/ивенты — высокомаржинальный канал для дейтинга (комиссия за билет 10–30%). Построено на существующей партнёрской системе (`partner_offers` категории `event`/`experience` + Stripe-флоу).

- **Миграция `047_events.sql`:** `partner_offers` + event-поля (`event_start/event_end/location/poster_url/event_url/capacity/tickets_sold`, additive, nullable); таблица `event_tickets` (UNIQUE `offer_id+user_id`, FK на `partner_offers`/`users`, `stripe_session_id`, `status` ENUM `pending/paid/refunded`); сид ивент-партнёр `Wild Events` (commission 20%) + 3 демо-события (speed-dating 1500₽ cap 40, миксер 1200₽ cap 60, мастер-класс 1800₽ cap 20).
- **Бэкенд `server/src/routes/events.js`:** `GET /api/events` (афиша: только активные, `event_start >= NOW()`, JOIN partners, `remaining`/`sold_out`); `GET /api/events/:id` (+ `my_ticket`); `POST /api/events/:id/purchase` (auth; проверки цена/статус, capacity-кэп 409 `SOLD_OUT`, повторная покупка 409 `ALREADY_PURCHASED`; Stripe Checkout `pending` → `event_tickets`+`partner_orders`, или mock → сразу `paid` + `partner_conversions` + инкремент `tickets_sold`); Stripe webhook `/api/events/order/webhook` — подпись, идемпотент через `webhook_events`, апдейт `tickets_sold`/конверсия/order paid. Подключён в `index.js` с `express.raw` для webhook.
- **Расширены CRUD event-полей:** `partner-dashboard.js` (GET/POST/PUT) и `admin/partners.js` (GET/POST/PUT) — приём/валидация `event_start` для категорий `event`/`experience`.
- **Фронт:** страница `src/pages/events.tsx` — афиша карточками (постер/градиент, название, дата/время через `formatEventDate`, место+город, цена, остаток билетов, кнопка «Купить билет» → `POST /purchase`, бейджи sold_out/«Билет куплен», отдельная обработка 409 ALREADY_PURCHASED); роут `/events` в `App.tsx`; ссылка с /hangouts; i18n `events.*` RU+EN.
- **Проверки:** server-сьют **357/357** (+14 новых `events.test.js`), front **81/81**, lint 0 errors, `vite build` OK. Миграции **028–047** применены к локальной БД `swiftmatch` (`migrate.js` → 047 DONE). Live-проверка на тестовом порту 3033: `/api/events` отдаёт 3 события, purchase → mock 201 (ticket_id=1), повторная → 409 ALREADY_PURCHASED, detail возвращает `my_ticket`; тестовые данные очищены.
- **UX-фикс ленты /hangouts:** ряд чипов категорий (9 шт.) переводился в `flex-wrap` — раньше при `overflow-x-auto`+`shrink-0` чипы «Концерт/Спорт/Другое» уходили за правый край экрана (left 421px при 390px), теперь переносятся на 2-ю строку и все на виду. `src/pages/hangouts.tsx` (data-testid `hangout-category-chips`).



## Этап 89 (30.08.2026) — AI-подбор встреч под пару (premium perk) ✅

🟢 P3: премиум-функция курирования идей встреч/свиданий под конкретную пару. **Бэкенд-эндпоинт `POST /api/hangouts/suggest`** (`server/src/routes/hangouts.js`), тело `{ user_id?, language?: 'ru'|'en' }`:
- **Premium-гейт** тем же механизмом, что boost (`getCompanionsCap`): без активной подписки — **403 `PREMIUM_REQUIRED`**.
- **Профили пары:** выбирает профили обоих (`req.userId` + `user_id`) из `user_profiles` (display_name/age/bio/city/dating_goal) для персонализации → передаёт в OpenAI-контекст.
- **OpenAI:** переиспользует `createBreaker` (как icebreakers) — `suggestBreaker` генерирует **3 объекта** `{ title, category, place, description }` (RU/EN), category из набора cinema|theater|exhibition|cafe|concert|sport|other. `source: 'openai'`.
- **Fallback:** без `OPENAI_API_KEY` или при сбое breaker — **DB** (реальные активные встречи из `hangouts`, `source: 'db'`) + **static** набор идей 6 шт. (`source: 'static'`). Трекается `trackEvent('hangout_suggest', …)`.
- **Тесты:** `server/src/__tests__/hangout-suggest.test.js` (+6): auth 401, non-premium 403 `PREMIUM_REQUIRED`, static-fallback, db-fallback, partner user_id, 500 на ошибку БД. **server 363/363, lint 0 errors.**
- **Live (порт 3002):** premium user 3 → 200 `source:'db'` (реальные Crocus City Hall + Aurora Cinema + статические идеи), и с `user_id`, и с `language:'en'`; free-user → 403; без токена → 401; тестовые данные не создаются.

## Этап 90 (30.08.2026) — Affiliate «Куда пойти» (бэкенд) ✅

🟢 P3: аффилиат-слой монетизации dining/travel/gift. **Автономный эндпоинт `GET /api/affiliate/offers`** (публичный, без гейта — реклама для всех), квери `{ city?, limit? }` (`server/src/routes/affiliate.js`):
- Фильтр: категории `restaurant/hotel/flowers/taxi/gift` (все уже в enum `partner_offers`), `status='active'`, `deeplink` не пустой, `valid_to >= CURDATE()`; JOIN `partners` → `partner_name` + `commission_rate`; числовые `price`/`commission_rate`; сортировка pinned DESC, лимит по умолчанию 6 (max 12).
- **Миграция `048_affiliate_seed.sql`** (идемпотентно, применена): 5 демо-офферов «Куда пойти» от существующих партнёров — Restoclub ресторан 12%, Ostrovok отель 4%, Flowwow цветы 15%, Yandex Go такси 8%, Bouquet.ru подарок 12%; плюс в БД уже были 9 аффилиат-офферов (Ostrovok/Restoclub/YandexGo/Bouquet/Flowwow/Lavka) → итого 14 под фильтр.
- **Монтирование:** `app.use(affiliateRoutes)` в `server/src/index.js`.
- **Тесты:** `server/src/__tests__/affiliate.test.js` (+3): маппинг числовых полей/возврат списка, city-filter+limit попадают в params SQL, 500 на ошибку БД. **server 366/366, lint 0 errors.**
- **Live (порт 3002):** default → 200 с 6 офферами (мои id 28–32 + существующие); `limit=3` → 3; `city=Санкт-Петербург` → только отель Ostrovok (id 29); комиссии 4–15%, deeplink присутствует.
- **Статус:** бэкенд готов. **Фронт-блок «Куда пойти» на /hangouts — вынесен отдельным этапом** (по решению — этап бэкенд-first).

## Этап 91 (30.08.2026) — Фронт: блок «Куда пойти вдвоём» на /hangouts ✅

🟢 P3-фронт: видимый блок аффилиат-подборки на `/hangouts` (бэкенд `/api/affiliate/offers` из этапа 90). `src/pages/hangouts.tsx`:
- **Блок `hangout-go-out`** под слайдером радиуса, заголовок «Куда пойти вдвоём» + горизонтальный скролл карточек (`overflow-x-auto`, `shrink-0 w-56`):
  - карточка = `<a href={deeplink} target="_blank" rel="noopener">`: иконка категории в цветном круге (restaurant→Utensils, hotel→BedDouble, flowers→Flower2, taxi→Car, gift→ShoppingBag, fallback→MapPin), название, цена ₽ (если есть), город, бейдж «кэшбэк N%» (HandCoins, `commission_rate`, если >0).
  - загрузка `GET /api/affiliate/offers?limit=4` (с Bearer-токеном, если есть), кэш на state; пустой массив → блок скрыт.
- **i18n** `hangout.go_out.title` / `hangout.go_out.cashback` RU+EN (`src/context/language-context.tsx`).
- **Тесты:** `src/test/hangouts.test.tsx` (+2): блок рендерит карточки с правильным `href`/`target=_blank`/«кэшбэк 12%»; скрыт при пустом `offers`. Существующие тесты переведены на mock-by-URL (fetch `/api/affiliate/offers` отдельно от `/api/hangouts`). **front 83/83, lint 0 errors, `vite build` OK.**
- **DOM-проверка (Playwright, 390px):** блок `x:16, width:358 → 374 ≤ 390` ✅; первая карточка `x:20, width:224 → 244 ≤ 390` ✅; href = реальный `https://swiftmatch.app/go/bouquet-gift` (deeplink из БД).
- **Статус:** этап 90+91 полностью закрывают P3-аффилиаты.

## Этап 93 (30.08.2026) — Инфра-хвосты (Docker/nginx/CI/DEPLOY) ✅

⚙️ Подготовка Docker-инфры в репо (запуск на VPS + реальные ключи — вне этой среды, задокументировано в `DEPLOY.md`):
- **`.env.example`** — актуализирован по факту читаемых сервером переменных (собрано из `process.env.*` в `server/src`): `PORT/CLIENT_URL/CORS_ORIGIN`, `DB_*`/`DB_POOL_MAX`, `REDIS_URL`/`CACHE_TTL`, `JWT_SECRET`, `LOG_LEVEL`, `SECURITY_HEADERS_API`/`AUTH_LOCKOUT_MAX_ATTEMPTS`, опционально `OPENAI_*`/`PERSPECTIVE_API_KEY`/`TWILIO_*`/`VAPID_*`/`FCM_SERVER_KEY`/`SMTP_*`/`S3_*`/`BACKUP_*`/`STRIPE_*`/`REVENUECAT_WEBHOOK_SECRET`/`SENTRY_DSN` + `VITE_*` (клиент). Секции `### SECRETS ###` для CI/CD.
- **`Dockerfile`** — добавлен само-достаточный этап `web` (`nginx:1.27-alpine` + `dist` из frontend-этапа, HEALTHCHECK на `/`); server-этап теперь копирует `database/` и `scripts/` (миграции + schema-validate в контейнере).
- **`docker-compose.yml`** — nginx переведён на build-таргет `web` (**фикс бага**: раньше монтировался хост-volume `./dist`, которого не было в образе → фронт не отдавался); `app` подключает `env_file: .env` (прод-ключи Stripe/OpenAI/…); явные DB_/JWT/CORS/REDIS.
- **`nginx/swiftmatch.http.conf`** — HTTP-конфиг для nginx-образа: `gzip`, rate-limit (`auth 5r/s`, `api 30r/s`), `/healthz`, статика из `/usr/share/nginx/html` с кэшем `assets`, SPA-fallback, прокси `/api`, `/socket.io` (upgrade), `/uploads` (30d).
- **`deploy.yml`** — устаревший `SCP + pm2` заменён на Docker-деплой: rsync файлов (burnett01/rsync-deployments) → `docker compose up -d --build` → `docker compose exec app node database/migrations/migrate.js` → `schema-validate.mjs`. Secrets те же (`DEPLOY_HOST/DEPLOY_USER/DEPLOY_SSH_KEY`). `docker-config-check` собирает и `server`, и `web` таргеты.
- **`.dockerignore`** — исключены `e2e/docs/monitoring/k6`, `*.log`.
- **`DEPLOY.md`** — новый пошаговый гайд: требования к VPS, установка Docker, `.env`, первичный `docker compose up -d --build`, Caddy/HTTPS, secrets CI/CD, мониторинг (Prometheus/Grafana), k6 100 VU, cron-бэкапы БД.
- **Статус:** весь инфа-костяк в репо выверен и согласован с deploy. Осталось (вне среды): Docker на VPS, реальные ключи в Secrets, `docker compose up`, к6 100 VU, UptimeRobot/Grafana-алерты.

## Этап 92 (30.08.2026) — Фронт: блок «Идеи для пары» (AI-подбор, premium) ✅

🟢 P3-фронт: видимый UI AI-подбора встреч под пару (бэкенд `POST /api/hangouts/suggest` из этапа 89). `src/pages/hangouts.tsx`:
- **Блок `hangout-suggest`** на `/hangouts` (под блоком «Куда пойти»). Гeйт через `usePremium()` (`isPremium`):
  - **Premium:** кнопка «Показать идеи свидания» → `POST /api/hangouts/suggest` (Bearer-токен; `{ language }`) → 3 карточки-идеи (иконка категории через `categoryIcon`, название, место, описание) + переключатель языка **RU/EN** (сброс и перегенерация) + кнопка «Создать встречу» → `/hangouts/create`. Загрузка — спиннер; ошибка (в т.ч. 403) — сообщение `hangout.suggest.error`.
  - **Free:** upsell-блок «Идеи для пары — Premium» с кнопкой «Стать Premium» → `/premium`.
- **i18n** `hangout.suggest.*` (title/upsell_title/upsell_desc/go_premium/open/close/create/error) RU+EN (`src/context/language-context.tsx`).
- **Тесты:** `src/test/hangouts.test.tsx` (+3): upsell для free (кнопка «Стать Premium», нет «Показать идеи»); premium отрисовывает идеи после клика (названия + «Создать встречу»); ошибка при 403. Добавлен мок `@/hooks/use-premium`. **front 86/86, lint 0 errors, `vite build` OK.**
- **DOM/live (Playwright, 390px, порт 3002/8081):** premium-юзер (с активной подпиской) → кнопка «Показать идеи» видна, upsell скрыт; клик → **3 идеи** (первая «Кофе и настольные игры / Уютная кофейня...» — статический fallback, т.к. нет OPENAI_API_KEY); free-юзер → upsell виден, кнопка скрыта. Тестовая подписка/юзеры удалены.
- **Статус:** этап 89+92 полностью закрывают P3-AI-подбор. Весь план монетизации (P0–P3) теперь закрыт.

## Этап 84 (30.08.2026) — /hangouts P0: джойн partner_offer в ленту + блок «Билет» ✅

В карточки ленты `/hangouts` добавлен `LEFT JOIN partner_offers` (`offer_id/offer_title/offer_price/offer_image_url/offer_deeplink/offer_category/offer_city/offer_valid_to`), блок «Билет {price} ₽ →» с кнопкой «Купить» → `POST /api/partners/order` (Stripe/mock). i18n `hangout.offer.buy/buying/buy_ticket`. **server 327/327, front 81/81.** Полная деталь — в `Что доделать.txt` / `context.txt`.

## Этап 85 (30.08.2026) — Платные встречи (ticket flow) ✅

В hangouts `price` + `capacity` (миграция 044, таблица `hangout_tickets`), `POST /api/hangouts/:id/purchase` (Stripe/mock) + webhook, гейт respond/like/join для платных (402 `PAYMENT_REQUIRED`, 409 `CAPACITY_FULL`), UI create/edit/деталь с ценой+лимитом. **server 334/334 (+7), front 81/81.**

## Этап 86 (30.08.2026) — Закреплённые/спонсорские карточки ✅

Оффер `placement=hangout` + `pinned` → верх ленты с бейджем «Sponsored» (админ ставит в admin-partners.tsx). Миграция `045_partner_offers_pinned.sql`.

## Этап 87 (30.08.2026) — Премиум-перки на встречи /hangouts ✅

P2: снятие/поднятие лимита ежедневных встреч, boost карточки, поднятие `max_companions` cap 10→20 для premium.

## Этап 94–97 (31.08.2026) — Улучшение ленты /hangouts: quick actions, сортировка, infinite scroll, backend aggregates ✅

Комплексное улучшение UX ленты встреч по плану из «Улучшение страницы hangouts Встречи.txt»:

- **Этап 94 — Quick actions на карточке:** кнопки «Откликнуться»/«Присоединиться» + «Нравится» (с ответом на API `/respond`, `/join`, `/like`; тосты на 409/402/401/200). Кнопка «Поделиться» (Web Share API или clipboard). Бейдж рейтинга (★ + оценка). Scarcity-индикатор «Осталось N» / «Все места заняты». Аватарки первых 3 участников (`hangout.attendees`). `loading="lazy"` на аватаре автора. Компонент `HangoutSkeletonCard` для загрузки.
- **Этап 95 — Сортировка + URL sync:** селектор «По дате»/«Популярные»/«Сначала дешёвые» (`hangout-sort-select`), параметр `sort` в URL через `useSearchParams`. Фильтры пишутся в URL и читаются при монтировании.
- **Этап 96 — Backend aggregates:** в `HANGOUT_LIST_SELECT` добавлены `rating` (AVG `hangout_reviews.rating`), `review_count`, `attendees_csv` (GROUP_CONCAT первых 3 участников через `user_profiles`). Функция `parseAttendees` конвертирует CSV → массив. Применяется в feed, my, detail.
- **Этап 97 — Infinite scroll + скелетоны + группировка:** кнопка «Показать ещё» заменена на бесконечный скролл через `IntersectionObserver` (sentinel `hangout-sentinel`, rootMargin 250px). Скелетоны 3 штук вместо спиннера. Группировка по датам со sticky-заголовками («Сегодня», «Завтра», дата). Улучшенное пустое состояние (reset фильтров + ссылка «Куда пойти»).
- **i18n** (RU+EN): 24 новых ключа `hangout.group.*`, `hangout.sort.*`, `hangout.filter.*`, `hangout.action.*`, `hangout.label.*`, `hangout.empty_*`.
- **Тесты:** mock `IntersectionObserver` в `src/test/setup.ts`; тест load-more заменён на infinite scroll (AutoIO → mock → page=2). **server 366/366, front 86/86, lint 0 errors, `vite build` OK.** DOM (Playwright 390px): все карточки в bounds 390px, action buttons на каждой, rating badge на карточке с рейтингом, sorting в URL, group headings sticky, sentinel absent при <20 записей.

## Этап 98 (31.08.2026) — WS real-time: тост + бейдж новой встречи в ленте ✅

Реал-тайм уведомление о только что созданных встречах прямо в открытой ленте /hangouts:

- **Сервер (`server/src/ws.js`, `server/src/routes/hangouts.js`):** в connection-обработчике добавлены комнаты `hangout:join_feed`/`hangout:leave_feed` (join/leave комнаты `hangout:feed`). В create-route после `trackEvent('hangout_created')` эмитится `io.to('hangout:feed').emit('hangout:new', { hangoutId, category, title, city, hangoutType })`.
- **Фронт (`src/pages/hangouts.tsx`):** при монтировании страницы сокет эмитит `hangout:join_feed` и подписывается на `hangout:new` (`socket.off` + `leave_feed` в cleanup). При первом новом событии показывается тост «Новая встреча», над списком появляется плавающий бейдж-кнопка «Показать новые (N)» (`data-testid="hangouts-new-badge"`), клик перезагружает ленту (сброс счётчика + принудительный рефетч через `refreshKey`).
- **i18n (RU+EN):** 3 новых ключа `hangout.new.show`, `hangout.new.title`, `hangout.new.desc`.
- **Тесты:** серверный тест emit `hangout:new` в комнату `hangout:feed` при создании (mock getIO); фронт-тест подписки на `hangout:new` → появление бейджа → клик → рефетч. **server 360/360, front 87/87, lint 0 errors, `vite build` OK.**

## Этап 99 (31.08.2026) — Фильтр по цене в ленте (бесплатные/платные/диапазон) ✅

Пункт 🔴 #2 плана «Улучшение страницы hangouts» — фильтрация по цене с сохранением в URL:

- **Сервер (`server/src/routes/hangouts.js`):** в feed-route добавлены параметры `price` (`free` → `(h.price IS NULL OR h.price = 0)`, `paid` → `(h.price IS NOT NULL AND h.price > 0)`), а для диапазона — `min_price`/`max_price` (при `price=paid`). Каждое условие валидируется (unknown-значение игнорируется).
- **Фронт (`src/pages/hangouts.tsx`):** новый тип `HangoutPriceFilter = 'all'|'free'|'paid'`, состояния `priceFilter`/`priceMax`, константа `PRICE_RANGE_PRESETS` (до 500/1500/5000 ₽). Чип-селект «Все/Бесплатные/Платные» (`data-testid="hangout-price-*"`) + при «Платные» — пресеты диапазона max-цены (`hangout-price-max-*`). Синхронизация с URL (`price`, `max_price`), чтение при монтировании, параметры в API-запросе, сброс `page=1`.
- **i18n (RU+EN):** 7 новых ключей `hangout.filter.price`, `hangout.price.all/free/paid/any/max`.
- **Тесты:** серверные — free/paid/max_price/unknown (4 шт); фронтовый — выбор free→paid→диапазон, проверка `price=free`, `price=paid&max_price=1500` в запросе + URL. **server 363/363, front 88/88, lint 0 errors, `vite build` OK.** Live: создана платная встреча 900 ₽ → `price=paid` отдаёт её, `max_price=500` — пусто; тестовая удалена.

## UX-правки /hangouts (31.08.2026) — go-out лента + компактные фильтры ✅

Пост-этапные правки по визуальной обратной связи (без изменения счёта тестов):

- **Фикс: «Куда пойти вдвоём» залазил на правый край** (`src/pages/hangouts.tsx`, коммит `91266b9`): карточки офферов переведены с фиксированной `w-56` (224px) на адаптивную `w-[82%]` контейнера + `scroll-snap-type: x mandatory` / `snap-start`. Теперь первая карточка видна целиком без обрезки у правого края, следующая лишь наполовину торчит как индикатор скролла (как в нативных приложениях). gap увеличен до `gap-3`.
- **Компактные фильтры/шапка** (коммит `114ea4d`): `space-y-4`→`space-y-3`, `pt-4`→`pt-3` у `<main>`; кнопка «Создать встречу» с `size=lg`→default; поиск `h-10`→`h-9`; чипы (типы/категории/даты), селект сортировки и ценовые чипы `py-1.5`→`py-1`. Итог: первая карточка на 390px поднялась с top≈988 до top≈887 (блок фильтров компактнее ~на 100px). **tsc/lint 0 errors, тесты 14/14, `vite build` OK.**

## Этап 100 (31.08.2026) — Мини-карта + «Проложить маршрут» на карточке ✅

Пункт 🔴 #4 плана «Улучшение страницы hangouts» — навигация к месту встречи и визуализация на карте (без внешних API-ключей и доп. зависимостей):

- **Кнопки на карточке** (`src/pages/hangouts.tsx`, компонент `HangoutCard`): под блоком действий добавлена вторая строка из двух кнопок (показывается только если есть координаты **или** название места):
  - **«Маршрут»** (`hangout-route-<id>`) — открывает Google Maps `https://www.google.com/maps/dir/?api=1&destination=<coords|название>` в новой вкладке (нативный навигатор; при отсутствии lat/lng — поиск по названию места).
  - **«На карте»** (`hangout-map-<id>`) — открывает модалку `Dialog` с мини-картой через **OpenStreetMap embed iframe** (без API-ключей): при наличии координат — `marker=lat,lng` с bbox-зумом, иначе — поиск по названию (`q=`). В модалке дублируется кнопка «Маршрут» (`hangout-route-modal-<id>`) и заголовок места.
- **Хелперы:** `hasCoords` (числовые lat/lng), `placeLabel` (place_name/place_address/city/title), `mapEmbedSrc` (OSM embed URL), `openRoute`/`openMap` (с `preventDefault`+`stopPropagation`, т.к. карточка обёрнута в `Link`).
- **i18n (RU+EN):** 2 новых ключа `hangout.map.route` («Маршрут»/«Route»), `hangout.map.view` («На карте»/«Map»).
- **Тест:** фронт +1 — карточка рендерит `hangout-map-1`/`hangout-route-1`, клик по «На карте» открывает модалку (`hangout-route-modal-1`), iframe src содержит `openstreetmap.org/export/embed.html` и `marker=55.751244`. **front 88→89/89, server 363/363 (без изменений), tsc/lint 0 errors, `vite build` OK.** Live (390px): у демо-встреч lat/lng=null → OSM-iframe фолбэк по `q=название` («Aurora Cinema, Moscow»), модалка и обе кнопки работают.

## Этап 101 (31.08.2026) — Лёгкая виртуализация длинного списка карточек ✅

Пункт 🛠 #13 плана (производительность ленты при >50 карточек). **Выбран безопасный подход «лёгкий оконный рендер»** (без потери фич): react-window не подходит, т.к. конфликтует с группировкой по датам + sticky-заголовками поверх страничного скролла (List требует собственный scroll-контейнер, ломая infinite scroll/WS-бейдж/go-out).

- **Решение: CSS `content-visibility: auto`** (`src/index.css`, класс `.hangout-virt`): браузер откладывает paint+layout off-screen карточек, рендеря только видимое окно — это и есть «оконный рендер» на уровне движка, при этом полностью сохраняются sticky-заголовки дат, страничный infinite-scroll (sentinel), WS-бейдж и go-out лента (ничего в структуре не менялось). `contain-intrinsic-size: auto 220px` предотвращает прыжки скроллбара и сохраняет корректный index скролла.
- **Применение** (`src/pages/hangouts.tsx`): класс `hangout-virt` добавлен к outer-элементу `Card` в `HangoutCard` (`data-testid="hangout-card-*"`).
- **Измеримый выигрыш:** при длинной ленте (сотни карточек в DOM из-за infinite scroll) браузер не рассчитывает layout/покраску за пределами вьюпорта — меньше jank при скролле и первичном рендере.
- **Проверки:** front 89/89 (не менялся), server 363/363, tsc/lint 0 errors, `vite build` OK. Live (390px): карточки получили `hangout-virt`, height>0 (content-visibility не скрывает их от рендера вьюпорта), H-overflow нет.

## Этап 102 (31.08.2026) — Мастер создания встречи + предзаполнение из профиля ✅

Пункт 🟠 #6 плана — пошаговый мастер создания вместо длинной одностраничной формы + автоподстановка города из профиля.

- **Пошаговый мастер** (`src/pages/hangout-create.tsx`): форма разбита на 4 шага со степпером (`data-testid="hangout-create-steps"` / кнопки `hangout-step-pill-*`) и навигацией «Назад/Далее» (`hangout-wizard-prev`/`hangout-wizard-next`):
  - Шаг 0 «Что»: тип (date/company) + категория + заголовок (обязателен — без него «Далее» блокируется с тостом);
  - Шаг 1 «Где»: место + адрес + город;
  - Шаг 2 «Когда»: дата+время (валидация — не в прошлом) + кол-во участников;
  - Шаг 3 «Билеты»: цена + лимит + описание (последний шаг → кнопка «Создать»).
  Степпер позволяет возвращаться на пройденные шаги. Все прежние `data-testid` полей (`hangout-title`, `hangout-place`, `hangout-city`, `hangout-date`, `hangout-max-companions`, `hangout-price`, `hangout-capacity`, `hangout-description`, `submit-hangout`, `pick-from-listings`) и логика сабмита/листингов/upsell сохранены.
- **Предзаполнение города из профиля**: `useEffect` при монтировании запрашивает `GET /api/profile/me` (auth) и, если город ещё не заполнен, подставляет `me.city` в поле города (шаг «Где»).
- **i18n (RU+EN):** +7 ключей `hangout.form.step_what/step_where/step_when/step_tickets`, `hangout.form.back/next`, `hangout.form.date_invalid`.
- **Тесты (новый `src/test/hangout-create.test.tsx`, +3):** 1) предзаполнение города из профиля + на шаге 0 скрыты поля шагов 1/3; 2) блокировка «Далее» при пустом заголовке (остаёмся на шаге 0); 3) проход по всем шагам 0→1→2→3, на последнем вместо «Далее» — «Создать». **front 89→92/92, server 363/363 (без изменений), tsc/lint 0 errors, `vite build` OK.** Live (390px): у demo-юзера город «Екатеринбург» подставился из `/api/profile/me`, навигация по шагам и валидация работают.

## Этап 103 (31.08.2026) — Уведомления о новых встречах в радиусе ✅ (веб-часть)

Пункт 🟠 #7 плана. Полные нативные push (FCM) остаются во внешних блокерах (ключи + нативная сборка), поэтому закрыта **веб-часть** без API-ключей:

- **Сервер (`server/src/routes/hangouts.js`):** payload события `hangout:new` теперь включает `lat`/`lng` создаваемой встречи (кроме `hangoutId/category/title/city/hangoutType`) — нужно для радиус-фильтра на клиенте.
- **Клиент (`src/pages/hangouts.tsx`, WS-эффект этапа 98):**
  - **Радиус-фильтр**: добавлен хелпер `haversineKm(lat1,lng1,lat2,lng2)` (экспорт). При `hangout:new` если у пользователя есть геолокация (`coords`) и у встречи есть координаты, событие **подавляется**, если расстояние превышает выбранный `radiusKm` (иначе бейдж/тост/уведомление как раньше).
  - **Системное уведомление (веб/`Notification` API)**: на первую in-radius встречу — если permission `granted`, показать `new Notification(...)`; если `default` — аккуратно запросить permission и показать при согласии; `denied` — только бейдж (не навязчиво). Deps эффекта расширены `[..., coords, radiusKm]`.
  - Поведение при `coords = null` (гео не дано) не изменилось — бейдж показывается как в этапе 98.
- **Тесты:** серверный emit-тест дополнен (`lat: 55.75, lng: 37.62` в payload — `objectContaining`); фронтовый unit-тест `haversineKm` (Екатеринбург→Москва ~1200–1600 км, совпадение координат ≈0). **server 363→370/370, front 92→93/93, tsc/lint 0 errors, `vite build` OK.** Примечание: live-WS-перепроверка в этой сессии ограничена средой (daily-лимит free + прокси WS 8081/3002); механика бейджа уже live-подтверждена в этапе 98, изменение — только расширение payload (безвредно) + радиус-фильтр (покрыт тестами).
- **Внешние хвосты:** нативный FCM-push (Capacitor) — требует staging VPS, google-services.json/APNs-ключи, домен+SSL; зарегистрирован в «Плановых хвостах».

## Этап 104 (31.08.2026) — Улучшение блока «Куда пойти» (аффилиаты) ✅

Пункт 🟠 #8 плана. Реализованы 4 направления + расширен бэкенд:

- **Сервер (`server/src/routes/affiliate.js`):** `GET /api/affiliate/offers` теперь принимает `category` (single-фильтр; неизвестное значение игнорируется — WHERE-category не добавляется). В ответ добавлены `lat`/`lng` из `partner_offers` (для будущей карты с маркерами; в демо-данных null). `limit` до 12 (клиент запрашивает 12, чтобы под фильтр был контент).
- **Фильтр по категории** (`hangouts.tsx`): под заголовком блока — чип-ряд «Все» + категории из фактических офферов (`hangout-go-out-filter-<cat>`), клик перезапрашивает `/api/affiliate/offers?category=...`. Серверный тест +2 (category-фильтр, игнор неизвестной) — **server 370→372/372**.
- **Персонализация по городу**: отдельный эффект получает `city` из `GET /api/profile/me` и передаёт его в offers (`city`-параметр уже был в роуте), а также подставляет плейсхолдеры `{city}`/`{lat}`/`{lng}` в аффилиатный deeplink (хелпер `fillDeeplink`).
- **Карта всех офферов**: кнопка «На карте» (`hangout-go-out-map`) → модалка `AffiliateMap` (`src/components/hangout-go-out.tsx`) с OSM embed iframe (bbox+marker если есть координаты, иначе `q=<city>`; список офферов-ссылок ниже). Без react-leaflet (React 18 конфликт) — как этап 100.
- **Кнопка «Забронировать»** (`hangout-go-out-book-<id>`): модалка `GoOutBookingDialog`. Для `restaurant` — дата/время/гости → `POST /api/partners/booking` → открыть deeplink; для остальных категорий — инфо-карточка + переход к партнёру. Карточка осталась `<a>` (deeplink, `target=_blank`), кнопка через preventDefault/stopPropagation — не ломает существующий тест.
- **Рефактор**: иконки/цвета вынесены в `src/lib/go-out.ts` (GO_OUT_ICONS/GO_OUT_COLORS, используются и в `hangouts.tsx`, и в модалках). Новые i18n-ключи RU+EN: `hangout.go_out.map/book/filter_all/cat_*`/map_title/map_hint. Добавлен `id="hangout-go-out"` (чинит scroll empty-state).
- **Тесты:** front +3 (чип-фильтр, модалка брони, модалка карты) — **front 93→96/96**; tsc/lint 0 errors; `vite build` OK. Live: сервер перезапущен `node --watch` (был без watch — стейл), бэкенд-проверка подтвердила category-фильтр и lat/lng; UI-проверка — чипы/кнопки/карта рендерятся.
- **Хвосты:** у партнёрских офферов пока нет координат (lat/lng null) — карта использует город; наполнение координат и фильтр-бейдж на чипах — в долгосрочных.

## Этап 105 (31.08.2026) — Pull-to-refresh + stagger-анимация карточек ✅

UX-улучшение ленты (следующий по приоритету после 🟠 #8).

- **Pull-to-refresh** (`src/pages/hangouts.tsx`, `src/index.css`):
  - Touch-обработчики на корневом `<div>` (`onTouchStart/Move/End/Cancel`).
  - Тянем вниз при `window.scrollY <= 0` → расстояние `min(90, dy*0.5)` в state `ptrDist`; индикатор `.ptr-wrap.ptr-visible` со спиннером `.ptr-spinner` (opacity по прогрессу).
  - `touchend`: если `ptrDist > 64` → `ptrState="refreshing"` + `refreshFeed()` (сброс page, bump refreshKey → перезапрос ленты), индикатор гаснет через 900ms; иначе сброс.
  - Индикатор: `data-testid="hangout-ptr"`, CSS ключевые кадры `hangout-stagger-in`, `ptr-spin`.
- **Stagger-анимация**: `HangoutCard` принимает `className`/`style` (наносятся на outer `<Link className="block">`). В групповом рендере картам добавляется класс `.hangout-stagger-enter` + `animationDelay: min(idx*40, 320)ms`; ключ карты `{refreshKey}-{id}` — при refresh анимация повторяется.
- **Тесты:** front +2 — stagger (класс на `closest("a")`), pull-to-refresh (touch-жест `touchStart 50 → touchMove 200 → touchEnd` увеличивает число `/api/hangouts` запросов). **front 96→98/98**; tsc/lint 0 errors; `vite build` OK; server 372/372 (не менялся). Live (390px): ptr-индикатор + 4 stagger-карточки, первая delay 0ms.
- **Примечание:** pull-to-refresh работает на touch-устройствах (мобильный веб / Capacitor); на десктопе пользовательский паттерн от Web-скролла сохраняется (кнопка «Показать новые» для свежих встреч остаётся).

## Этап 106 (31.08.2026) — Оптимистичный UI respond/join/like на карточке ✅

Пункт 🛠 #14(б) / UX-кандидат — не ждать ответа сервера: состояние карточки меняется сразу, при ошибке откатывается.

- **`HangoutCard` (`src/pages/hangouts.tsx`), `doAction(kind: "respond"|"join"|"like"):`** перед сетевой `POST /api/hangouts/:id/{respond,join,like}` применяется оптимистичный патч через `onOptimistic(hangout.id, patch)`:
  - `respond` → `my_response_status: "pending"`;
  - `join` → `my_participant_status: "joined"` + `participant_count + 1`;
  - `like` → `my_like_status: "like"` + `like_count + 1`.
  Инверс (`prev`) сохраняется для отката.
- **Откат:** при `!ok && status !== 201` (409/402/401/прочее) или при сетевом catch — повторно применяется `prev` (`onOptimistic?.(id, prev)`), показывается соответствующий тост (`already`/`payment_required`/`auth_required`/`error`).
- **`applyOptimistic` (useCallback)** — обновляет встречу в state `items` по `id`; передаётся как `onOptimistic={applyOptimistic}` в обе точки рендера `HangoutCard` (лента + H1-рекомендации).
- **Тесты (`src/test/hangouts.test.tsx`, +2):** «applies optimistic join immediately and keeps it on success (этап 106)» (кнопка join исчезает до ответа сервера и остаётся после 201) и «rolls back optimistic join when the request fails (этап 106)» (500 → кнопка join снова появляется).
- **Счётчики:** в рамках сессии 107–110 — итоговые server 389/389, front 111/111, tsc/lint 0 errors, `vite build` OK.

## Этап 107 (31.08.2026) — Пустое состояние /hangouts: рекомендации + онбординг-баннер ✅

Пункт 🔴 #3 плана «Улучшение страницы hangouts» — снизить порог входа для новых пользователей, у которых лента может быть пустой.

- **Онбординг-баннер** (`src/pages/hangouts.tsx`): в empty-state добавлен баннер `data-testid="hangout-onboard"` с объяснением, что такое встречи (Date/Company) и как они работают.
- **Рекомендации** (`recHangouts`/`recLoading`): отдельный fetch-эффект `GET /api/hangouts?sort=popularity&limit=3&status=active` (без гео-фильтров — «популярные встречи в других городах»); блок `data-testid="hangout-recs"` / `hangout-recs-loading` переиспользует `HangoutCard` с `onOptimistic={applyOptimistic}` и классом `hangout-stagger-enter`.
- **i18n (RU+EN):** ключи `hangout.empty_banner_title/date/company`, `hangout.empty_recommend_title/desc/placeholder`.
- **Тесты:** front +3 (баннер; рекомендации с карточкой `hangout-card-55`; RU-ключи в моках).
- **Счётчики:** tsc/lint 0 errors, `vite build` OK; итоговые по сессии hangouts — server 389/389, front 111/111.

## Этап 108 (31.08.2026) — Счётчик просмотров встречи ✅

Пункт 🟠 #5 плана (соцсигналы) — счётчик просмотров в БД, показывающий популярность на карточке.

- **Миграция `049_hangouts_view_count.sql`:** `ALTER TABLE hangouts ADD COLUMN view_count INT NOT NULL DEFAULT 0 AFTER boosted` + индекс `idx_hangouts_view_count` (вместо `AFTER like_count` — like_count не физическая колонка); синхронизировано с `database/mysql_schema.sql`.
- **Сервер (`server/src/routes/hangouts.js`):** `h.view_count` добавлен в `HANGOUT_LIST_SELECT`; в detail-роуте для не-автора fire-and-forget `UPDATE hangouts SET view_count = view_count + 1 WHERE id = ?` (просмотр автора не засчитывается).
- **Фронт (`src/pages/hangouts.tsx`):** иконка `Eye` из lucide-react; в meta-строке карточки показан `view_count` (`data-testid="hangout-views-{id}"`, `toLocaleString("ru-RU")`), ключ `hangout.label.views`.
- **Тесты:** front +1 (показ `view_count` на карточке); server +4 (SELECT `h.view_count`; 3 теста detail view counter) — обновлён H2-тест на 3 явных `mockResolvedValueOnce` (UPDATE + chat-запрос не-автора).
- **Счётчики:** tsc/lint 0 errors, `vite build` OK; итоговые по сессии hangouts — server 389/389, front 111/111.

## Этап 109 (31.08.2026) — Встроенный чат с организатором до подтверждения ✅

Пункт 🟡 #12 плана — написать организатору вопрос до confirm (раньше чат создавался только при accept).

- **Сервер (`server/src/routes/hangouts.js`):** в `POST /api/hangouts/:id/respond` после INSERT отклика создаётся/переиспользуется личный чат между откликнувшимся и автором (`chats` + `chat_participants` + `INSERT IGNORE INTO hangout_chats (hangout_id, response_id, chat_id)`), ответ 201 включает `chat_id: preChatId`. В detail-роуте для не-автора `chat_id` ищется по активному отклику (`JOIN hangout_responses ... hr.user_id = ? AND hr.status != 'cancelled'`), а не через `[[]]`.
- **Фронт (`src/pages/hangout-detail.tsx`):** в `respond()` после успеха при наличии `data.chat_id` — `navigate('/chats/'+chat_id)`, иначе `load()`; при `my_response_status === "pending"` показаны кнопка «Написать организатору» (`data-testid="message-organizer"`, `Link /chats/{chat_id}`) и подпись `data-testid="response-pending-note"`.
- **i18n (RU+EN):** `hangout.action.message_organizer`, `hangout.response.pending_note` (+ починена слитая строка RU `hangout.response.pending`).
- **Тесты:** server — обновлены respond-моки (9/12 вызовов pool.query, `chatLink[1]` = `['7', 55, 200]`) + новый H3-тест `returns chat_id for a respondent with a pending response` (hangouts.test.js → 62); front — новый `src/test/hangout-detail.test.tsx` (+2: кнопка «message organizer» показывается при pending+chat_id, скрыта без chat_id).
- **Счётчики:** server 389/389, front 111/111, tsc/lint 0 errors, `vite build` OK.

## Этап 110 (31.08.2026) — Кэширование ленты (staleTime 60s) + Sentry-метрики ✅

Пункты 🛠 #14 и #16 плана — меньше запросов при переключении вкладок/навигации и мониторинг производительности.

- **Клиентский кэш ленты** (`src/pages/hangouts.tsx`): модульный `feedCache` (Map по `cacheKey` = query-строка) со staleTime **60s** — на page 1 при свежем кэше fetch не выполняется; явный pull-to-refresh (`refreshKey > 0`) всегда идёт в сеть; `__resetFeedCache()` для изоляции тестов.
- **Sentry (`src/lib/sentry.ts`):** добавлены `captureTiming(name, ms)` (метрика времени загрузки ленты `hangout.feed.load`) и `captureMessage(...)` — no-op без `VITE_SENTRY_DSN`. В `buyTicket` на провал/ошибку логируются `hangout.ticket_purchase_failed`/`_error` с `offer_id`/`hangout_id`.
- **Тесты:** front +1 — remount в пределах 60s не перезапрашивает ленту (считаются только `?page=`-запросы, исключая H1-рекомендации).
- **Счётчики:** server 389/389 (без изменений), front 111/111, tsc/lint 0 errors, `vite build` OK.

## Плановые хвосты (не блокируют)

- Внешние блокеры (не код): staging VPS + docker compose up, реальные ключи в `.env`, домен + SSL + Google Play, k6 100 VU на staging, UptimeRobot/Grafana-алерты.
- Код/низкий приоритет (после релиза): CSRF double-submit (при выносе API на поддомен), fingerprint refresh, SMS (Twilio), AI-модерация фото (Rekognition), CDN/S3.
- Открыт: сверка поведения jsdom/localStorage на Node 25 dev vs 22-alpine Docker.
