/**
 * Оркестратор интеграционного прогона TEST-03: поднимает контейнеры из
 * docker-compose.integration.yml (override поверх docker-compose.yml — db/redis
 * те же, что поедут на VPS, порты мимо Laragon), гоняет смоук против живого
 * server/src/index.js и убирает за собой.
 *
 * Ключевая обязанность — уборка в finally: `down -v` сносит и контейнеры, и
 * volume с тестовыми данными, даже когда смоук упал (требование проекта «после
 * тестов ничего не остаётся»). Поэтому чистка — не побочный эффект, а отдельный
 * шаг в finally, как у E2E-teardown с `if: always()`.
 *
 * Запуск: npm run test:integration   (REQUIRE_INTEGRATION=1 задаётся здесь же —
 * runner всегда хочет падение на недоступной инфраструктуре, не пропуск).
 */
import { spawn } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSE_FILE = 'docker-compose.integration.yml'
const PROJECT = 'swiftmatch-itest'

function resolveDocker() {
  // PATH сессии после установки Docker Desktop обновляется только перезапуском
  // терминала — без этого фоллбека на новой машине docker «не найден».
  const win = 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe'
  if (process.platform === 'win32' && existsSync(win)) return win
  return 'docker'
}

function run(cmd, args, { env, timeoutMs = 300_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: false,
    })
    const timer = setTimeout(() => {
      console.error(`FAIL  таймаут ${Math.round(timeoutMs / 1000)}с: ${cmd} ${args.join(' ')}`)
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (err) => {
      clearTimeout(timer)
      console.error(`FAIL  не удалось запустить ${cmd}: ${err.message}`)
      resolve(127)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code ?? 1)
    })
  })
}

async function main() {
  const docker = resolveDocker()
  const composeArgs = ['compose', '-p', PROJECT, '-f', 'docker-compose.yml', '-f', COMPOSE_FILE]

  // compose валидирует все сервисы файла, а у app env_file: .env обязателен —
  // без .env (его нет ни локально, ни в CI) up падает раньше, чем поднимется db.
  const envPath = path.join(root, '.env')
  const createdEnv = !existsSync(envPath)
  if (createdEnv) writeFileSync(envPath, '')

  let code = 1
  try {
    console.log(`[run] docker compose up (db, redis, maildev) — файл ${COMPOSE_FILE}`)
    code = await run(docker, [...composeArgs, 'up', '-d', '--wait', 'db', 'redis', 'maildev'], {
      timeoutMs: 300_000,
    })
    if (code !== 0) {
      console.log(`FAIL  контейнеры не поднялись (exit ${code})`)
    } else {
      console.log('[run] контейнеры healthy — запуск integration-smoke')
      code = await run(process.execPath, ['server/scripts/integration-smoke.mjs'], {
        env: {
          REQUIRE_INTEGRATION: '1',
          DB_HOST: '127.0.0.1',
          DB_PORT: '3308',
          DB_USER: 'root',
          DB_PASSWORD: 'root',
          DB_NAME: 'swiftmatch1bd',
          REDIS_URL: 'redis://127.0.0.1:6380',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1125',
          MAILDEV_URL: 'http://127.0.0.1:1180',
          SMOKE_API_PORT: '3102',
        },
        timeoutMs: 240_000,
      })
    }
  } finally {
    console.log('[run] cleanup: docker compose down -v (контейнеры + volume)')
    await run(docker, [...composeArgs, 'down', '-v', '--remove-orphans'], { timeoutMs: 120_000 })
    if (createdEnv) rmSync(envPath, { force: true })
  }

  if (code !== 0) {
    console.log(`\nFAIL  интеграционный прогон незелёный (exit ${code})`)
    process.exit(code)
  }
  console.log('\nИтог: интеграционный прогон зелёный, контейнеры и volume убраны.')
  process.exit(0)
}

main().catch((err) => {
  console.error(`FAIL  runner упал: ${err.stack || err.message}`)
  process.exit(1)
})
