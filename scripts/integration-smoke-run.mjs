/**
 * Оркестратор интеграционного прогона TEST-03 (+ INT-01): поднимает контейнеры
 * из docker-compose.integration.yml (override поверх docker-compose.yml —
 * db/redis те же, что поедут на VPS, порты мимо Laragon), гоняет смоуки против
 * живого server/src/index.js и убирает за собой.
 *
 * Три смоука: init-data-smoke.mjs (полнота данных свежего init — до смоуков с API,
 * те добавляют строки), integration-smoke.mjs (цепочка почты HTTP → MySQL → Bull/Redis →
 * nodemailer → maildev) и s3-contract-smoke.mjs (контракт S3: upload → объекты
 * в бакете → удаление оригинала и вариантов). Все три бегут при поднятом контуре;
 * упавший первый не отменяет остальные.
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
    console.log(`[run] docker compose up (db, redis, maildev, s3) — файл ${COMPOSE_FILE}`)
    code = await run(docker, [...composeArgs, 'up', '-d', '--wait', 'db', 'redis', 'maildev', 's3'], {
      timeoutMs: 420_000,
    })
    if (code !== 0) {
      console.log(`FAIL  контейнеры не поднялись (exit ${code})`)
    } else {
      // Общий env обоих смоуков: контур тот же, различаются только сервисные
      // порты и API-порт (3102 занят первым смоуком, второй берёт 3103).
      const smokeEnv = {
        REQUIRE_INTEGRATION: '1',
        DB_HOST: '127.0.0.1',
        DB_PORT: '3308',
        DB_USER: 'root',
        DB_PASSWORD: 'root',
        DB_NAME: 'swiftmatch1bd',
        REDIS_URL: 'redis://127.0.0.1:6380',
      }

      console.log('[run] контейнеры healthy — проверка полноты init-данных (до смоуков с API: те добавляют строки)')
      const initDataCode = await run(process.execPath, ['server/scripts/init-data-smoke.mjs'], {
        env: smokeEnv,
        timeoutMs: 120_000,
      })

      console.log('[run] контейнеры healthy — запуск integration-smoke (почта)')
      const mailCode = await run(process.execPath, ['server/scripts/integration-smoke.mjs'], {
        env: {
          ...smokeEnv,
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1125',
          MAILDEV_URL: 'http://127.0.0.1:1180',
          SMOKE_API_PORT: '3102',
        },
        timeoutMs: 240_000,
      })

      // Второй смоук бежит даже при падении первого: контракт S3 не зависит от
      // почтовой цепочки, а диагностика полнее, когда оба результата на руках.
      console.log('[run] контрактный прогон INT-01 (S3)')
      const s3Code = await run(process.execPath, ['server/scripts/s3-contract-smoke.mjs'], {
        env: {
          ...smokeEnv,
          SMOKE_S3_API_PORT: '3103',
          S3_ENDPOINT: 'http://127.0.0.1:19001',
          S3_BUCKET: 'swiftmatch-itest',
        },
        timeoutMs: 240_000,
      })

      code = [initDataCode, mailCode, s3Code].find((result) => result !== 0) ?? 0
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
