import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import path from 'node:path'

/**
 * Осознанное исключение: `server/src/seed.js` — CLI-скрипт сида демо-данных
 * (`node server/src/seed.js`, CI global-setup), его `console.log` — progress-вывод
 * операции, а не отладочный мусор в рантайм-хендлере, ради которого гейт ищет
 * `console.log` в `server/src`. Решение зафиксировано (L7): логи оставляем,
 * из отчёта они исключены, количество пропущенных строк печатается отдельно,
 * чтобы гейт не был молчаливым про это решение.
 */
export const CONSOLE_LOG_EXEMPT_FILES = new Set(['server/src/seed.js'])

export function extractPort(text, pattern, label, optional = false, problems) {
  const m = text.match(pattern)
  if (!m) {
    if (!optional) problems.push(`Не найден порт для "${label}"`)
    return null
  }
  return Number(m[1])
}

/**
 * Подставляет значение за константой, чтобы гейт видел порт, а не имя.
 *
 * После появления `VITE_PROXY_TARGET` в vite.config.ts появилась строка
 * `const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:3002'`,
 * а `target: API_TARGET` перестал содержать литерал. Гейт на этом молча краснел
 * («Не найден порт для vite.config.ts proxy target») — то есть блокирующий шаг
 * деплоя был мёртвым и проверял уже не то. Раскрывается ровно один ход: если
 * константа определена в этом же файле через `||`/`??` с URL-литералом,
 * `target: ИМЯ` считается равным этому литералу. Неизвестная константа по-прежнему
 * даёт «порт не найден», то есть гейт не подменяет проверку догадкой.
 */
export function resolveTargetAliases(cfg) {
  const aliases = new Map()
  for (const m of cfg.matchAll(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*[^;'"]*?(?:\|\||\?\?)\s*['"](https?:\/\/[^'"]+)['"]/g,
  )) {
    aliases.set(m[1], m[2])
  }
  let out = cfg
  for (const [name, url] of aliases) {
    out = out.replace(new RegExp(`target:\\s*${name}\\b`, 'g'), `target: '${url}'`)
  }
  return out
}

function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      out.push(...walk(p))
    } else if (p.endsWith('.js') && !name.endsWith('.test.js')) {
      out.push(p)
    }
  }
  return out
}

/**
 * console.log/debug в `server/src` (вне __tests__), кроме осознанных логов
 * seed.js. Возвращает список заметок и число пропущенных строк — гейт печатает
 * оба числа, чтобы исключение не превращалось в тишину.
 */
export function collectConsoleNotes(rootDir) {
  const notes = []
  let skipped = 0
  for (const file of walk(join(rootDir, 'server', 'src'))) {
    const rel = file.replace(rootDir + '\\', '').replace(rootDir + '/', '').split('\\').join('/')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m = line.match(/console\.(log|debug)\s*\(/)
      if (!m) return
      if (CONSOLE_LOG_EXEMPT_FILES.has(rel)) {
        skipped += 1
        return
      }
      notes.push(`console.${m[1]} в ${rel}:${i + 1}`)
    })
  }
  return { notes, skipped }
}

function main() {
  const root = process.cwd()
  const problems = []
  const notes = []

  function read(rel, optional = false) {
    const p = join(root, rel)
    if (!existsSync(p)) {
      if (!optional) problems.push(`Файл не найден: ${rel}`)
      return ''
    }
    return readFileSync(p, 'utf8')
  }

  const viteCfg = read('vite.config.ts')
  const serverEnv = read('server/.env', true)
  const envExample = read('server/.env.example')

  const vitePort = extractPort(viteCfg, /server:\s*\{[\s\S]*?port:\s*(\d+)/, 'vite.config.ts server.port', false, problems)
  const proxyPort = extractPort(resolveTargetAliases(viteCfg), /proxy:\s*\{[\s\S]*?target:\s*['"]http:\/\/[^'"]*:(\d+)/, 'vite.config.ts proxy target', false, problems)
  const envPort = extractPort(serverEnv, /^PORT=(\d+)/m, 'server/.env PORT', true, problems)
  const examplePort = extractPort(envExample, /^PORT=(\d+)/m, 'server/.env.example PORT', false, problems)
  const corsOrigin = serverEnv.match(/^CORS_ORIGIN=(.+)$/m)?.[1] ?? null
  const corsPort = corsOrigin ? Number(corsOrigin.match(/:(\d+)$/)?.[1] ?? 0) : null

  const apiPorts = [proxyPort, envPort, examplePort].filter((p) => p != null)
  const uiPorts = [vitePort, corsPort].filter((p) => p != null)

  if (apiPorts.length && !apiPorts.every((p) => p === apiPorts[0])) {
    problems.push(`API-порт рассинхронизирован: vite proxy=${proxyPort ?? '-'}, server/.env=${envPort ?? 'отсутствует'}, .env.example=${examplePort ?? '-'} (эталон — ${examplePort ?? proxyPort})`)
  }
  if (uiPorts.length && !uiPorts.every((p) => p === uiPorts[0])) {
    problems.push(`UI-порт рассинхронизирован: vite server=${vitePort ?? '-'}, CORS_ORIGIN=${corsOrigin ?? 'отсутствует'} (эталон — ${vitePort ?? '-'})`)
  }

  if (apiPorts.length && uiPorts.length && apiPorts[0] === uiPorts[0]) {
    problems.push(`API-порт (${apiPorts[0]}) совпадает с UI-портом (${uiPorts[0]})`)
  }

  if (serverEnv) {
    if (!/^JWT_SECRET=.+/m.test(serverEnv)) {
      problems.push('server/.env: JWT_SECRET не задан — при старте будет сгенерирован случайный секрет и все существующие токены станут невалидными')
    }
  } else {
    console.log('  server/.env       = отсутствует (CI: JWT_SECRET/DB_* передаются env-переменными — ок)')
  }

  const { notes: consoleNotes, skipped } = collectConsoleNotes(root)
  notes.push(...consoleNotes)

  console.log('=== check:ports ===')
  console.log(`  vite server.port   = ${vitePort ?? '-'}`)
  console.log(`  vite proxy target  = ${proxyPort ?? '-'}`)
  console.log(`  server/.env PORT   = ${envPort ?? '-'}`)
  console.log(`  .env.example PORT  = ${examplePort ?? '-'}`)
  console.log(`  CORS_ORIGIN        = ${corsOrigin ?? '-'}`)

  if (skipped > 0) {
    console.log(`  [note] server/src/seed.js: ${skipped} console.log — осознанные progress-логи сида, пропущены (L7)`)
  }
  if (notes.length) {
    console.log('\n[WARN] console.log/debug в server/src (вне __tests__):')
    notes.slice(0, 10).forEach((n) => console.log(`  - ${n}`))
    if (notes.length > 10) console.log(`  ... ещё ${notes.length - 10}`)
  }

  if (problems.length) {
    console.error('\n[FAIL]')
    problems.forEach((p) => console.error(`  - ${p}`))
    process.exit(1)
  }

  console.log('\n[OK] Порты согласованы')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()