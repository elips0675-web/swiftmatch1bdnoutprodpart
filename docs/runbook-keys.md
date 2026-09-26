# Runbook: обновление секретов и ключей (.env)

> Этап 41. Порядок ротации каждого ключа, влияние на пользователей и проверка после замены.
> Правило: ключи НИКОГДА не попадают в git (`.env` в `.gitignore`, проверять `git status --ignored`).

## Где живут ключи

| Файл | Что содержит | Кто читает |
|---|---|---|
| `server/.env` | Все серверные ключи | `node src/index.js` (dotenv) |
| `.env` (корень) | Только `VITE_*` | Vite при сборке (`npm run build`) |

**Важно:** `VITE_*` вшиваются в бандл на этапе сборки — после смены нужен `npx vite build` + деплой статики, а не только рестарт API.

## Универсальный порядок для любого ключа

1. Получить новое значение у провайдера.
2. Вписать в `server/.env` (заменой старого значения).
3. Рестарт API: `Get-Process -Id (Get-NetTCPConnection -LocalPort 3002 -State Listen).OwningProcess | Stop-Process -Force; Start-Process node -ArgumentList "src/index.js" -WorkingDirectory "<repo>\server" -WindowStyle Hidden`
4. Проверка: `Invoke-WebRequest http://localhost:3002/health` → 200, затем целевой смоук из таблицы ниже.
5. Если ключ был скомпрометирован — сначала отозвать старый у провайдера, потом шаги 1–4.

## По-ключево

### JWT_SECRET
- **Влияние при простой замене:** все access-токены становятся невалидными мгновенно — пользователи разлогинятся (refresh-flow восстановит сессию тихо, кроме web где httpOnly cookie refresh остаётся валидным).
- **Ротация:** сгенерировать `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` → вставить → рестарт.
- **Проверка:** логин через UI; `/api/profile/me` с новым токеном.
- **Graceful rotation (без разлогина всех) — рекомендуемый путь.** Access-токен живёт **24 часа** (`expiresIn: '24h'`), поэтому достаточно окна в 24ч, а не «ждать неделю». `server/src/middleware.js` → `verifyToken()` перебирает `[JWT_SECRET, ...JWT_SECRET_PREV]`; новые токены подписываются **только** текущим ключом, старые принимаются, пока старый ключ в списке.
  1. Сгенерировать новый ключ: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
  2. В `server/.env` **заменить** `JWT_SECRET=` новым и **добавить** `JWT_SECRET_PREV=<старый ключ>` (несколько ключей — через запятую).
  3. Рестарт API (шаг 3 универсального порядка).
  4. Проверить логин новым ключом: `POST /api/auth/login` → 200; старый токен из лога входа **до** рестарта должен продолжать работать (`/api/profile/me` → 200).
  5. **Через 24 часа** (TTL access-токена) удалить строку `JWT_SECRET_PREV=` и сделать ещё один рестарт — окно закрыто, старые токены снова невалидны.
  6. **При компрометации ключа** окно НЕ открывают: сначала отозвать старый ключ, иначе злоумышленник продолжит выпускать валидные токены в течение всего окна.
- Ограничение: `jsonwebtoken@9` не умеет принимать массив секретов (`verify.js:120-130` пытается `createPublicKey`/`createSecretKey` от массива и падает `secretOrPublicKey is not valid key material`), поэтому перебор ключей реализован вручную в `verifyToken()`. Покрыт `server/src/__tests__/jwt-rotation.test.js` (12 тестов).

### SMTP_USER / SMTP_PASS
- **Влияние:** письма (верификация, сброс пароля) падают до ротации.
- **Ротация:** панель провайдера (Mailtrap/Resend/SES) → новые креды → рестарт.
- **Проверка:** запрос сброса пароля на тестовый email, письмо приходит.

### Stripe: STRIPE_SECRET_KEY
- **Влияние:** чекауты; при пустом значении включается mock mode (`STRIPE_LIVE=true` запрещает fallback).
- **Ротация:** Dashboard → Developers → API keys → Create restricted key → заменить `sk_...`.
- **Проверка:** создать checkout session через UI премиума (test mode).

### Stripe: STRIPE_WEBHOOK_SECRET
- **Влияние:** вебхуки начнут отклоняться с 400 (подпись) — подписки не будут активироваться.
- **Порядок критичен:** 1) новый webhook endpoint в Stripe c тем же URL → получить новый `whsec_`; 2) вписать в `.env` + рестарт; 3) только потом удалить старый endpoint в Stripe. Оба endpoint'а шлют события параллельно — наш дедуп по event_id (таблица `webhook_events`, этап 39) защищает от двойной обработки.
- **Проверка:** Send test webhook в Stripe CLI → лог сервера без `invalid signature`.

### Twilio: TWILIO_AUTH_TOKEN
- **Влияние:** SMS-верификация.
- **Ротация:** Console → Account → rotate auth token (старый живёт 24ч — бесшовно).
- **Проверка:** запрос кода на свой номер.

### OpenAI: OPENAI_API_KEY
- **Влияние:** AI-модерация текста и icebreakers; фолбэк — пропуск модерации (fail-open), следить в логах.
- **Ротация:** platform.openai.com → API keys → create + revoke.
- **Проверка:** отправить сообщение с триггер-словом → баннер модерации в логах.

### FCM_SERVER_KEY / FCM_SERVICE_ACCOUNT
- **Влияние:** пуш-уведомления Android/iOS (серверная отправка через firebase-admin).
- **Ротация:** Firebase Console → Project settings → Cloud Messaging (Server key); Service accounts → Generate new private key (service account JSON).
- **Формат `FCM_SERVICE_ACCOUNT`:** код принимает три варианта — base64 от JSON (легаси), сырой JSON (`{...}`) или путь к файлу `firebase-adminsdk.json`. В `.env` удобнее всего base64: `[Convert]::ToBase64String([IO.File]::ReadAllBytes('firebase-adminsdk.json'))` (PowerShell) или `base64 -w0 firebase-adminsdk.json` (Linux).
- **Проверка:** пуш через админку/тестовую подписку.

### RevenueCat: REVENUECAT_WEBHOOK_SECRET
- **Влияние:** IAP-события (покупки/возвраты) отклоняются 401.
- **Ротация:** RevenueCat → Integrations → Webhooks → новый auth header → `.env` → рестарт (окно простоя секундное, приемлемо).
- **Проверка:** sandbox-покупка в TestFlight/внутреннем треке.

### S3: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
- **Влияние:** загрузка фото падает; существующие файлы доступны (они публичны в CDN/bucket policy).
- **Ротация:** IAM → create new key → `.env` → рестарт → revoke старой. Двухшагово, без даунтайма.
- **Проверка:** загрузить фото в профиле.

### Sentry SENTRY_DSN
- **Влияние:** только телеметрия ошибок.
- **Ротация:** Settings → Client Keys → rotate. Frontend DSN тоже вшит — пересборка фронта.

### REDIS_URL
- **Влияние:** распределённый rate-limit и кэш; без Redis приложение живёт (in-memory fallback).
- **Проверка:** лог `Redis connected`, затем два подряд запроса лимитера.

### VAPID_* (push)
- **Влияние:** при смене приватного ключа все существующие push-подписки инвалидируются — браузеры перезапишут подписку при следующем визите. Не менять без необходимости.

## Чеклист после полной ротации (например, утечка .env)

1. Сменить ВСЕ внешние ключи (Stripe/Twilio/OpenAI/S3/SMTP/FCM/RevenueCat/Sentry).
2. Новый JWT_SECRET + рестарт.
3. Сменить пароль БД MySQL: `ALTER USER 'swiftmatch'@'%' IDENTIFIED BY '<new>';` + DB_PASSWORD.
4. `npm test` (server 307) + front 81 + ручной смоук логина/чата/загрузки/чекаута.
5. Проверить `git log -p --all -- server/.env` — убедиться, что .env никогда не коммитился.
6. Инцидент-лог: что утекло, когда отозвано, кто уведомлён.
