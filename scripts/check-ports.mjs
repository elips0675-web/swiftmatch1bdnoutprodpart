import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

function extractPort(text, pattern, label, optional = false) {
  const m = text.match(pattern)
  if (!m) {
    if (!optional) problems.push(`Не найден порт для "${label}"`)
    return null
  }
  return Number(m[1])
}

const vitePort = extractPort(viteCfg, /server:\s*\{[\s\S]*?port:\s*(\d+)/, 'vite.config.ts server.port')
const proxyPort = extractPort(viteCfg, /proxy:\s*\{[\s\S]*?target:\s*['"]http:\/\/[^'"]*:(\d+)/, 'vite.config.ts proxy target')
const envPort = extractPort(serverEnv, /^PORT=(\d+)/m, 'server/.env PORT', true)
const examplePort = extractPort(envExample, /^PORT=(\d+)/m, 'server/.env.example PORT')
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

for (const file of walk(join(root, 'server', 'src'))) {
  const rel = file.replace(root + '\\', '').replace(root + '/', '')
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = line.match(/console\.(log|debug)\s*\(/)
    if (m) notes.push(`console.${m[1]} в ${rel}:${i + 1}`)
  })
}

console.log('=== check:ports ===')
console.log(`  vite server.port   = ${vitePort ?? '-'}`)
console.log(`  vite proxy target  = ${proxyPort ?? '-'}`)
console.log(`  server/.env PORT   = ${envPort ?? '-'}`)
console.log(`  .env.example PORT  = ${examplePort ?? '-'}`)
console.log(`  CORS_ORIGIN        = ${corsOrigin ?? '-'}`)

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