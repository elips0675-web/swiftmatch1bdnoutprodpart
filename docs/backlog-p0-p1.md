# Бэклог P0/P1 — детализация (перенесено из Что доделать.txt)
Актуально: 17.10.2026

> Детальные описания, обсуждения и разборы, которые были в основном файле `Что доделать.txt`.  
> Основной компактный бэклог — в `Что доделать.txt` (после рефакторинга) или `Новый Что доделать.md`.  
> История закрытий — `Что сделано.txt`. Архив — `docs/agenda-archive.md`.

## P0. Блокеры среды (ENV-01–ENV-04)
См. раздел 1 в `Новый Что доделать.md`. Детали из исходного файла:

- **ENV-01** `server/.env` — реальные ключи: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_USER/PASS`, `SENTRY_DSN`, `AWS_*`/`S3_BUCKET`, `OPENAI_API_KEY`, `FCM_SERVER_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `TWILIO_*`. Проверка: `powershell -File scripts/check-keys.ps1`.
- **ENV-02** GitHub secrets для deploy.yml: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DB_*`.
- **ENV-03** Staging-окружение + прогон E2E с реальными ключами.
- **ENV-04** Android: SDK/Android Studio → APK/AAB, App Links (assetlinks.json, SHA256), публикация в Google Play (17+), TestFlight; Privacy Policy + Terms.
- **Доп. среда:** Redis доступность (`REDIS_URL`), диск `E:` недоступен (зеркало `E:\swiftmatch-backup.git` и облачный бэкап не обновлены), Docker Desktop снят откатом Windows 13.10.2026 (`docker` нет в PATH), стенд 3002/8081 отдаёт код до `1fce1f1` (требуется перезапуск через `запуск-всего.bat`), заголовки на staging + CSP — за владельцем.
- **VAPID (L1):** приватный ключ скомпрометирован (`e8b26bf`) — только ротация на VPS, история не переписывается.

## P0. Живое состояние и CI (TEST-01, CI-01)
- **TEST-01** Полный живой E2E после этапов 45/46 не прогонялся. Статический счёт `playwright test --list` — 205 тестов; последний полный живой прогон 12.10.2026 (152 в 19 спеках). Требуется перезапуск API, `GET /health` (redis: live), полный прогон `npm run test:e2e`.
- **CI-01** Блок «CI: краснота server-test/test-counters/e2e/Trivy — исправлено, ждёт прогона» (12.10.2026). Таблица фиксов из исходного файла: `e2e` (Init DB schema), `wait-for-url.mjs` (оба формата флагов), `server-test` (корневой `npm ci`), `test-counters` (MySQL + живой API + `Stop server` с `if: always()`), Trivy (очистка `/root/.npm`, `TRIVY_TIMEOUT: 15m0s`).

## P0. Консистентность документов (DOC-01, DOC-02)
- **DOC-01** `test/Для анализа.txt` — исторический срез 12.10.2026, содержит закрытые пункты как открытые (питфолл 101).
- **DOC-02** Шапка `Что доделать.txt` — перегружена хроникой закрытых этапов 45/46 (лимитеры чата/AI, алерты, пагинация, аудит фото, RevenueCat E2E, trust proxy, GDPR-ZIP, weekly report, P3 #26/#27/#28/#29, M5/M6, L2 и др.). Протухшие утверждения: «Redis-сервер не поднят» vs `redis: live` в `/health`; «E2E 205/205» — статический счёт смешан с живым; блок CI «ждёт прогона» рядом с «гейты 28/28».

## P1. Детали по багам «UI не врёт»
- **PART-01** `src/pages/partner-dashboard.tsx:106-115` (`toggleOfferStatus`) — не проверяет `res.ok`, статус переключается до ответа; на 500/403 UI показывает `partner.status_paused`, сервер остаётся активным. Требуется ключ ошибки (ближайшие `partner.offer_delete_error`, `partner.subscribe_error`) — выбор владельца.
- **PART-02** `src/pages/partner-dashboard.tsx:157` — выводит `data.partner.type` сырым кодом; переводы есть (`partner.type_deeplink`, `partner.type_api`, `partner.type_saas`).
- **PART-03** `src/pages/partner-dashboard.tsx:51-56,68` — на не-2xx `api()` возвращает `null`, вызывающий код не обновляет список → 500 маскируется под «офферов нет».
- **ADM-01** `src/pages/admin-photos.tsx:53-56` — тост только в `if (res.ok)`, при 403/500/сети админ не видит ошибку.
- **ADM-02** `src/pages/admin-photos.tsx:51` — причина отклонения `"Inappropriate content"` жёстко в коде, не локализуема, не выбирается модератором.
- **ADM-03** `src/pages/admin-analytics.tsx:70-72,80-83,103,130` — ~10 сырых литералов без `t()` (MAU, Conversion, ARPU, Live, Real data from database, Аналитика и Метрики, Retention Rate, `% вернувшихся`, Новые пользователи).
- **ADM-04** `src/pages/admin-backup.tsx:59-63,80-84` — серверный `body?.message` бросается, но `catch` показывает общий `admin.backup.error_create`.
- **ADM-06** `src/pages/admin-backup.tsx:16-18,155` — размер всегда в «MB», без переключения KB/MB/GB, округление грубое (0.00 MB при 900 байт).
- **GRP-01** `src/pages/groups.tsx:180` — локальный `["spam","нецензурно"]` вместо канонических `containsForbiddenWords` (`src/lib/word-filter.ts`) и серверного списка (`server/src/banned-words.js`).
- **USER-01** `src/pages/user.tsx:108,145` — мёртвые ветки `isSystem` (данные из `ALL_DEMO_USERS`, флаг не выставлен; также проверки в `src/pages/search.tsx:91,201`, `src/pages/Home.tsx:60`).
- **ONB-01** `src/pages/onboarding.tsx:77,185` — отправляет `zodiac: formData.zodiac` (`""`) и затирает ранее заполненный знак зодиака.
- **ONB-02** `src/pages/onboarding.tsx:264` — сравнение `formData.circadian === 'lark'`, при этом кнопки пишут `early-bird/night-owl/flexible` (расхождение с `src/types/index.ts:20`, `src/lib/constants.ts:150-152`, `src/lib/demo-data.ts:25`).
- **ONB-03** `src/pages/onboarding.tsx:132,367` — кнопка генерации био «AI {t('button.save')}»; при пустых интересах берётся `onboarding.step4.desc` вместо предупреждения.
- **CON-01** `scripts/check-console.mjs:25-33` — не сканирует `/premium/success`, `/premium/cancel`, `/partner/register`, `/partner/dashboard`, `/partner/order/*`.

## Решения владельца (decision) — подробности
- **ADM-05** `src/pages/admin-photos.tsx:108` — кнопки одобрить/отклонить только при `filter !== 'all'`. Варианты: (а) оставить — только очередь модерации; (б) разрешить модерацию в «все фото».
- **SRCH-01** `src/pages/search.tsx:100` принимает `"all"` и `"Все"`, `src/components/dialogs/filters-dialog.tsx:49,176` держит `"Все"`. Свести к одному каноническому значению.
- **SRCH-02** `src/pages/search.tsx:470` управляется `isReportDialogOpen`, но `setIsReportDialogOpen(true)` в файле не вызывается (`:289,493`). Нужна кнопка жалобы на карточке (как в `chats.tsx:674`, `user.tsx:166`) или зафиксировать отсутствие.
- **SRCH-03** `src/pages/search.tsx:341,499` — `FiltersDialog` рендерится только при `searchFilters` (заполняется в `mode=autosearch`), в обычном режиме кнопка «сменить фильтры» нажимается в пустоту. Вариант: вести на `/search-filters` в обычном режиме.
- **USER-02** `src/pages/user.tsx:494` — при открытии своего приглашения не закрывается `setShowInviteDialog(false)`. Возможно задумано; решение владельца.
- **SUCC-01** `src/pages/premium-success.tsx:10`, `src/pages/partner-order-success.tsx:10` — `session_id` читается, но не используется. Либо добавить серверную проверку сессии, либо убрать неиспользуемое чтение.
- **PROD-01 (M1)** `server/src/routes/hangouts.js:1290,1595,1612` — `CHECKIN_WINDOW_HOURS` удалена, чек-ин не проверяет окно времени (только радиус 500м). Варианты: (а) ввести ±2ч (риск опоздавших); (б) оставить без окна.
- **SEC-01** `server/src/index.js:104-107` — `csrfGuard` закомментирован с комментарием «после выноса API на поддомен». Триггер: включить до первого реального платежа ИЛИ при выносе API на поддомен — что наступит раньше.

## Слепые зоны тестов (для контекста)
- Backup/restore smoke в CI (TEST-02) — `scripts/verify-backup.mjs` подключён шагом, прогона «restore → smoke» нет.
- Интеграционный прогон против docker-compose (TEST-03) — MySQL+Redis+maildev (SMTP-флоу в моках).
- Порогов coverage нет (COV-01); покрытие ядра (COV-02).
- a11y системно не проверяется (A11Y-01), cross-browser по флагу (XB-01).
- Native/WebView E2E (Capacitor) — заблокирован устройством/Android Studio.

## Инфра/зависимости (детали)
- **DEPS-01** `server/`: 28 moderate (`@sentry/node` 9→11, `firebase-admin`→14.5.0, `bull`→advisory в `uuid`); `npm audit fix --force` понижает `bull` до 1.1.3 — нельзя. 0 high/critical.
- **INT-01** Внешние сервисы (S3/CDN, SMS/Twilio, AI-модерация/Rekognition, FCM, OpenAI) — только mock/fallback. Рекомендуется контрактные тесты с MinIO/maildev + алерты при работе в `mock` в `NODE_ENV=production`.

## Watch (детали)
- **W-01** CI зелёный после правок 12.10.2026 (server-test/test-counters/e2e/Trivy) — проверить последний run на `main`.
- **W-02** Trivy не падает на `root/.npm` (очистка в Dockerfile, `TRIVY_TIMEOUT: 15m0s`).
- **W-03** ✅ Заглушек в инвентаре 0 (`PLACEHOLDER_HINT` отсутствует) — подтверждено 17.10.2026.
- **W-04** Redis live на стенде + очереди работают (`GET /health` → `redis: "live"`).
- **W-05** Полный живой E2E после этапов 45/46 подтверждён.
