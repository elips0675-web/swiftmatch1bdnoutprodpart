/**
 * Контрактный смоук INT-01 (половина FCM/Twilio): форма запроса, которую код
 * отправит провайдеру, проверяется против локальной HTTP-ловушки — тот же приём,
 * что maildev для SMTP (Stage 65-66) и zenko/cloudserver для S3 (Stage 67).
 *
 * Что он доказывает и чего не может юнит-тест: `sendFcmToUser` и `sendSMS` —
 * сетевой контракт (наш код ↔ HTTP API провайдера). Юнит-мок принимает любое
 * тело и любой заголовок, поэтому опечатка в имени поля (`to` вместо `token`,
 * `body` вместо `Body`), потеря `Authorization` или неверный путь эндпоинта
 * остаются невидимыми до живого ключа. Смоук ловит запрос и сверяет форму:
 *  1. FCM: URL `/fcm/send`, `Content-Type: application/json`,
 *     `Authorization: key=<FCM_SERVER_KEY>`, тело `{ to, notification: { title,
 *     body, sound }, data }` — ровно то, что читает legacy FCM API;
 *  2. FCM: ответ `{ failure: 1, results: [{ error }] }` превращается в
 *     `{ success: false, error }`, а `{ success: 1 }` — в `{ success: true }`;
 *  3. Twilio: путь `/2010-04-01/Accounts/<SID>/Messages.json`, Basic-auth из
 *     `SID:token`, тело `{ To, From, Body }` (заглавные имена — формат Twilio
 *     REST, `From` = `TWILIO_PHONE_NUMBER`); ошибка 400 отдаётся как
 *     `{ success: false, error }`, успех с `sid` — как `{ success: true, sid }`;
 *  4. без ключей обе функции честно уходят в mock (`{ success: true, mock: true }`)
 *     и в сеть не ходят.
 *
 * Ловушка поднимается прямо в процессе (`node:http`), а код вызывается тем же
 * `import()`: в контейнере это не нужно, потому что адреса FCM/Twilio заданы
 * константой (fcm.js: FCM_ENDPOINT, sms.js: TWILIO_API_BASE_URL) — смоук
 * переопределяет их и указывает на 127.0.0.1.
 *
 * Режимы (канон queue-smoke.mjs:9-10):
 *  - без флага — честный SKIP, exit 0 (живых ключей нет, ловушка своя);
 *  - REQUIRE_INTEGRATION=1 (CI, scripts/integration-smoke-run.mjs) или
 *    --require — любая упавшая проверка есть exit 1, а не пропуск.
 */
import { createServer } from 'node:http'

const requireIntegration =
  process.env.REQUIRE_INTEGRATION === '1' || process.argv.includes('--require')

const failures = []
function check(label, ok, extra = '') {
  console.log(`${ok ? 'ok' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`)
  if (!ok) failures.push(label)
}

// Ключи-заглушки: смоук проверяет форму запроса, а не подлинность креда.
const FCM_KEY = 'smoke-fcm-server-key'
const TWILIO_SID = 'ACsmoke00000000000000000000000000'
const TWILIO_TOKEN = 'smoke-twilio-auth-token'
const TWILIO_FROM = '+15550001111'
const TO_PHONE = '+79990001122'

/** Ловушка: пишет полученные запросы и отвечает сценарием по пути. */
function startStub(routes) {
  const seen = []
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      let body = null
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          // Twilio REST шлёт application/x-www-form-urlencoded, не JSON
          // (form-encoded — часть контракта, смоук её и проверяет).
          body = Object.fromEntries(new URLSearchParams(raw))
        }
      }
      const call = { method: req.method, url: req.url, headers: req.headers, body }
      seen.push(call)
      const route = routes.find((r) => r.match(req))
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ message: 'no stub route' }))
        return
      }
      const { status, payload } = route.reply(call)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        seen,
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

function basicAuth(header, sid, token) {
  if (!header || !header.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  return decoded === `${sid}:${token}`
}

async function main() {
  if (!requireIntegration) {
    console.log('SKIP  контрактный смоук FCM/Twilio пропущен (нет REQUIRE_INTEGRATION=1) — ловушка локальная, ключи не нужны')
    process.exit(0)
  }

  // FCM-ответ управляется очередью сценариев, чтобы проверить и успех, и failure.
  const fcmReplies = [
    { status: 200, payload: { success: 1, results: [{ message_id: 'smoke-fcm-id' }] } },
    { status: 200, payload: { failure: 1, results: [{ error: 'InvalidRegistration' }] } },
  ]
  let fcmCall = 0

  const stub = await startStub([
    {
      match: (req) => req.method === 'POST' && req.url === '/fcm/send',
      reply: () => fcmReplies[Math.min(fcmCall++, fcmReplies.length - 1)],
    },
    {
      match: (req) => req.method === 'POST' && /\/2010-04-01\/Accounts\/[^/]+\/Messages\.json$/.test(req.url),
      reply: (call) =>
        call.body?.To === '+79990009999'
          ? { status: 400, payload: { code: 21211, message: 'The number is not a valid phone number' } }
          : { status: 201, payload: { sid: 'SMsmoke00000000000000000000000000', status: 'queued' } },
    },
  ])

  try {
    process.env.FCM_SERVER_KEY = FCM_KEY
    process.env.FCM_ENDPOINT = `${stub.baseUrl}/fcm/send`
    process.env.TWILIO_ACCOUNT_SID = TWILIO_SID
    process.env.TWILIO_AUTH_TOKEN = TWILIO_TOKEN
    process.env.TWILIO_PHONE_NUMBER = TWILIO_FROM
    process.env.TWILIO_API_BASE_URL = stub.baseUrl

    // import() после установки env: модуль читает process.env на загрузке.
    const { sendFcmToUser } = await import('../src/fcm.js')
    const { sendSMS } = await import('../src/sms.js')

    console.log(`[push-sms-contract-smoke] stub=${stub.baseUrl}`)

    // --- FCM: успех ---
    const fcmOk = await sendFcmToUser('device-token-abc', 'Заголовок', 'Тело', { matchId: 42, kind: 'match' })
    const fcmCallLog = stub.seen.find((c) => c.url === '/fcm/send')
    check('FCM: эндпоинт /fcm/send по POST', Boolean(fcmCallLog))
    check(
      'FCM: Authorization = key=<FCM_SERVER_KEY>',
      fcmCallLog?.headers?.authorization === `key=${FCM_KEY}`,
      `получено: ${fcmCallLog?.headers?.authorization}`,
    )
    check(
      'FCM: Content-Type application/json',
      String(fcmCallLog?.headers?.['content-type'] || '').includes('application/json'),
      `получено: ${fcmCallLog?.headers?.['content-type']}`,
    )
    check('FCM: тело несёт to = токен устройства', fcmCallLog?.body?.to === 'device-token-abc')
    check(
      'FCM: notification { title, body, sound } заполнена',
      fcmCallLog?.body?.notification?.title === 'Заголовок' &&
        fcmCallLog?.body?.notification?.body === 'Тело' &&
        fcmCallLog?.body?.notification?.sound === 'default',
      JSON.stringify(fcmCallLog?.body?.notification),
    )
    check(
      'FCM: data прокинута в тело',
      fcmCallLog?.body?.data?.matchId === 42 && fcmCallLog?.body?.data?.kind === 'match',
      JSON.stringify(fcmCallLog?.body?.data),
    )
    check('FCM: успех → { success: true }', fcmOk?.success === true, JSON.stringify(fcmOk))

    // --- FCM: failure в ответе ---
    const fcmFail = await sendFcmToUser('device-token-abc', 'T', 'B')
    check(
      'FCM: failure → { success: false, error }',
      fcmFail?.success === false && fcmFail?.error === 'InvalidRegistration',
      JSON.stringify(fcmFail),
    )

    // --- Twilio: успех ---
    const smsOk = await sendSMS(TO_PHONE, 'Ваш код: 1234')
    const smsCallLog = stub.seen.find((c) => c.url.includes('/Messages.json'))
    check('Twilio: путь /2010-04-01/Accounts/<SID>/Messages.json', Boolean(smsCallLog), `получено: ${smsCallLog?.url}`)
    check(
      'Twilio: путь содержит наш Account SID',
      String(smsCallLog?.url || '').includes(TWILIO_SID),
      `получено: ${smsCallLog?.url}`,
    )
    check(
      'Twilio: Basic-auth из SID:token',
      basicAuth(smsCallLog?.headers?.authorization, TWILIO_SID, TWILIO_TOKEN),
      `получено: ${smsCallLog?.headers?.authorization}`,
    )
    check(
      'Twilio: тело form-encoded { To, From, Body } заглавными',
      smsCallLog?.body?.To === TO_PHONE &&
        smsCallLog?.body?.From === TWILIO_FROM &&
        smsCallLog?.body?.Body === 'Ваш код: 1234',
      JSON.stringify(smsCallLog?.body),
    )
    check(
      'Twilio: Content-Type form-urlencoded (не JSON)',
      String(smsCallLog?.headers?.['content-type'] || '').includes('application/x-www-form-urlencoded'),
      `получено: ${smsCallLog?.headers?.['content-type']}`,
    )
    check(
      'Twilio: успех → { success: true, sid }',
      smsOk?.success === true && smsOk?.sid === 'SMsmoke00000000000000000000000000',
      JSON.stringify(smsOk),
    )

    // --- Twilio: ошибка 400 ---
    const smsFail = await sendSMS('+79990009999', 'Ваш код: 5678')
    check(
      'Twilio: 400 → { success: false, error }',
      smsFail?.success === false && typeof smsFail?.error === 'string' && smsFail.error.length > 0,
      JSON.stringify(smsFail),
    )
  } finally {
    await stub.close()
  }

  if (failures.length) {
    console.log(`\nFAIL  push-sms-contract-smoke: ${failures.length} проверок упало`)
    process.exit(1)
  }
  console.log('\nOK  push-sms-contract-smoke: форма запросов FCM и Twilio подтверждена')
}

main().catch((err) => {
  console.error('push-sms-contract-smoke упал:', err)
  process.exit(1)
})
