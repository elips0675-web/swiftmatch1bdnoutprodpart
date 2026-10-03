/**
 * Ожидание готовности HTTP-сервиса перед запуском E2E (этап 30, B2).
 *
 * Зачем отдельный скрипт, если есть `sleep 5`: `sleep` — это надежда, что
 * процесс успел, а не проверка. На холодном runner'е Node стартует дольше, чем
 * пять секунд, и E2E падал не на своём баге, а на «сервис ещё не поднялся».
 * Такой падёж выглядит как флак, его начинают ретраить и в итоге отключают —
 * то есть гейт, который отключают, хуже отсутствующего (питфолл 49).
 *
 * Скрипт опрашивает URL, пока не придёт ответ:
 *   - без `--status` считается готовым любой ответ с кодом меньше 500
 *     (для статики фронта важен сам факт, что порт слушает: корень может
 *     отдавать 404, и это не помеха);
 *   - с `--status 200` требуется ровно этот код — так проверяется API, где
 *     500 означает «БД недоступна», а не «сервис готов».
 *
 * Примеры:
 *   node scripts/wait-for-url.mjs http://127.0.0.1:3002/health --status 200
 *   node scripts/wait-for-url.mjs http://127.0.0.1:8081 --timeout 120000
 */

const DEFAULT_TIMEOUT_MS = 60000
const DEFAULT_INTERVAL_MS = 250

export function parseArgs(argv) {
  const args = { url: '', timeoutMs: DEFAULT_TIMEOUT_MS, intervalMs: DEFAULT_INTERVAL_MS, status: null }
  for (const arg of argv) {
    if (arg.startsWith('--timeout=')) args.timeoutMs = Number(arg.slice('--timeout='.length))
    else if (arg.startsWith('--interval=')) args.intervalMs = Number(arg.slice('--interval='.length))
    else if (arg.startsWith('--status=')) args.status = Number(arg.slice('--status='.length))
    else if (!arg.startsWith('--')) args.url = arg
  }
  return args
}

export function isReady(status, wantStatus) {
  if (!Number.isFinite(status) || status <= 0) return false
  if (wantStatus !== null) return status === wantStatus
  return status < 500
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export async function waitForUrl(options, fetchImpl = fetch) {
  const deadline = Date.now() + options.timeoutMs
  let attempts = 0
  let lastError = 'нет ответа'
  let lastStatus = 0

  for (;;) {
    attempts += 1
    try {
      const res = await fetchImpl(options.url, { redirect: 'manual' })
      lastStatus = res.status
      lastError = `код ${res.status}`
      if (isReady(res.status, options.status)) {
        return { ok: true, attempts, status: res.status, error: null }
      }
    } catch (err) {
      lastError = err && err.message ? err.message : String(err)
    }
    if (Date.now() >= deadline) {
      return { ok: false, attempts, status: lastStatus, error: lastError }
    }
    await sleep(options.intervalMs)
  }
}

function parseArgsSafe(argv) {
  const args = parseArgs(argv)
  if (!args.url) {
    console.error('Использование: node scripts/wait-for-url.mjs <url> [--status=N] [--timeout=ms] [--interval=ms]')
    process.exit(2)
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    console.error(`--timeout должен быть положительным числом, получено: ${args.timeoutMs}`)
    process.exit(2)
  }
  if (!Number.isFinite(args.intervalMs) || args.intervalMs <= 0) {
    console.error(`--interval должен быть положительным числом, получено: ${args.intervalMs}`)
    process.exit(2)
  }
  if (args.status !== null && !Number.isFinite(args.status)) {
    console.error(`--status должен быть числом, получено: ${args.status}`)
    process.exit(2)
  }
  return args
}

async function main() {
  const args = parseArgsSafe(process.argv.slice(2))
  const started = Date.now()
  const result = await waitForUrl(args)
  const elapsed = Date.now() - started
  const want = args.status === null ? 'код < 500' : `код ${args.status}`

  if (!result.ok) {
    console.error(`FAIL: ${args.url} не ответил за ${args.timeoutMs} мс (${result.attempts} попыток, последнее: ${result.error}, ждали: ${want})`)
    process.exit(1)
  }
  console.log(`OK: ${args.url} ответил ${result.status} за ${elapsed} мс (${result.attempts} попыток, ждали: ${want})`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  main()
}
