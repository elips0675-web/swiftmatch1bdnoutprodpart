# Бэклог P0/P1 — детализация (перенесено из Что доделать.txt)
Актуально: 17.10.2026

> Детальные описания, обсуждения и разборы, которые были в основном файле `Что доделать.txt`.  
> Основной компактный бэклог — в `Что доделать.txt`.  
> История закрытий — `Что сделано.txt`. Архив — `docs/agenda-archive.md`.

## P0. Блокеры среды (ENV-01–ENV-04)
См. блокеры среды в `Что доделать.txt`. Детали из исходного файла:

- **ENV-01** `server/.env` — реальные ключи: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SMTP_USER/PASS`, `SENTRY_DSN`, `AWS_*`/`S3_BUCKET`, `OPENAI_API_KEY`, `FCM_SERVER_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `TWILIO_*`. Проверка: `powershell -File scripts/check-keys.ps1`.
- **ENV-02** GitHub secrets для deploy.yml: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DB_*`.
- **ENV-03** Staging-окружение + прогон E2E с реальными ключами.
- **ENV-04** Android: SDK/Android Studio → APK/AAB, App Links (assetlinks.json, SHA256), публикация в Google Play (17+), TestFlight; Privacy Policy + Terms.
- **Доп. среда:** Redis доступность (`REDIS_URL`), диск `E:` недоступен (зеркало `E:\swiftmatch-backup.git` и облачный бэкап не обновлены), Docker Desktop снят откатом Windows 13.10.2026 (`docker` нет в PATH), стенд 3002/8081 отдаёт код до `1fce1f1` (требуется перезапуск через `запуск-всего.bat`), заголовки на staging + CSP — за владельцем.
- **VAPID (L1):** приватный ключ скомпрометирован (`e8b26bf`) — только ротация на VPS, история не переписывается.

## P0. Живое состояние и CI (TEST-01, CI-01)
- **TEST-01** Полный живой E2E после этапов 45/46 не прогонялся. Статический счёт `playwright test --list` — 205 тестов; последний полный живой прогон 12.10.2026 (152 в 19 спеках). Требуется перезапуск API, `GET /health` (redis: live), полный прогон `npm run test:e2e`.
- **CI-01** Блок «CI: краснота server-test/test-counters/e2e/Trivy — исправлено, ждёт прогона» (12.10.2026). Таблица фиксов из исходного файла: `e2e` (Init DB schema), `wait-for-url.mjs` (оба формата флагов), `server-test` (корневой `npm ci`), `test-counters` (MySQL + живой API + `Stop server` с `if: always()`), Trivy (очистка `/root/.npm`, `TRIVY_TIMEOUT: 15m0s`).

## P0. Консистентность документов (DOC-01, DOC-02) — закрыто 17.10.2026
**DOC-01** (`test/Для анализа.txt` перечислял закрытые M2/Perspective и P3 #27/field-level permissions как открытые) и **DOC-02** (шапка `Что доделать.txt`: «Redis-сервер не поднят» при `redis: live` в `/health`, смешение статического счёта E2E с живым прогоном, «гейты 28/28» рядом с «ждёт прогона») устранены; разбор — `Что сделано.txt`, запись «консистентность документов».

## P1. Детали по багам «UI не врёт»
Код-часть закрыта 17.10.2026 (PART-01–PART-03, ADM-01–ADM-04, ADM-06, GRP-01, USER-01, ONB-01–ONB-02, CON-01) — см. `Что сделано.txt`; разбор — там же в записи «UI не врёт, часть 3». Оставшийся пункт `ONB-03` требует решения владельца и перенесён в раздел ниже.

## Решения владельца (decision) — подробности
- **ADM-05** `src/pages/admin-photos.tsx:108` — кнопки одобрить/отклонить только при `filter !== 'all'`. Варианты: (а) оставить — только очередь модерации; (б) разрешить модерацию в «все фото».
- **ONB-03** `src/pages/onboarding.tsx:132,367` — кнопка генерации био «AI {t('button.save')}» (должна говорить «сгенерировать»); при пустых интересах берётся `onboarding.step4.desc` вместо предупреждения. Нужны ключи/тексты.
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
- Пороги coverage заведены 17.10.2026 (COV-01 — `npm run test:coverage`, буфер −2 п.п.); покрытие ядра (COV-02) — отдельная работа.
- a11y системно не проверяется (A11Y-01) — открыто; cross-browser — принятое ограничение (XB-01, `CROSS_BROWSER=1`), закрыто 17.10.2026.
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
