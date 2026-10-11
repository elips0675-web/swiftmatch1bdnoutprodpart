/**
 * «Факты этапа» — один прогон вместо десятка ручных команд (рутина, P2).
 *
 * В конце каждого этапа надо снять числа тестов и подтвердить, что гейты
 * зелёные. Руками это 10+ команд и пересказ в «Что сделано.txt»; команды
 * забываются, пересказ расходится с прогоном (питфолл «шапка 1009/1009 при
 * факте 1245»). Скрипт гоняет всё сам и печатает готовый fact-блок:
 * счётчики, tsc, lint, build, офлайн-гейты — с честным статусом каждой
 * проверки (✅/❌). Ничего не редактирует: коммит остаётся ручным (класс
 * дефекта «git checkout -- стирает незакоммиченную работу»).
 *
 * Всегда (офлайн): test-counter-audit, tsc --noEmit, lint, lint:server,
 * vite build, check:docs / enum-constraints / prod-mock / order-by / e2e /
 * n-plus-one / env / env-parity / swagger-coverage / headers / mysql-race /
 * ports, schema-drift --offline, check:mirrors.
 *
 * Флаги:
 *   --skip-e2e — передаётся в test-counter-audit (прогон быстрее, E2E не сверяется);
 *   --fix      — передаётся в test-counter-audit (перегенерирует инвентарь и числа);
 *   --bundle   — дополнительно check:bundle (нужен dist от build);
 *   --network  — дополнительно audit:prod (корень + server) и check:deps (нужен npm-реестр);
 *   --gate <имя> — только одна проверка (по имени из DEFAULT_OFFLINE или флагам).
 *
 * Не запускается никогда: check:console (нужны живые серверы 8081/3002);
 * «зеркала test/» сверяются, но не чинятся — измерение, а не правка.
 */

import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const OFFLINE_CHECKS = [
  { name: 'check:docs', cmd: 'npm run check:docs' },
  { name: 'check:enum-constraints', cmd: 'npm run check:enum-constraints' },
  { name: 'check:prod-mock', cmd: 'npm run check:prod-mock' },
  { name: 'check:order-by', cmd: 'npm run check:order-by' },
  { name: 'check:e2e', cmd: 'npm run check:e2e' },
  { name: 'check:n-plus-one', cmd: 'npm run check:n-plus-one' },
  { name: 'check:env', cmd: 'npm run check:env' },
  { name: 'check:env-parity', cmd: 'npm run check:env-parity' },
  { name: 'check:swagger-coverage', cmd: 'npm run check:swagger-coverage' },
  { name: 'check:headers', cmd: 'npm run check:headers' },
  { name: 'check:mysql-race', cmd: 'npm run check:mysql-race' },
  { name: 'check:ports', cmd: 'npm run check:ports' },
  { name: 'schema-drift --offline', cmd: 'node scripts/schema-drift-audit.mjs --offline' },
  { name: 'check:mirrors', cmd: 'npm run check:mirrors' },
]

const TIME = {
  counters: 1_200_000,
  build: 600_000,
  scripts: 300_000,
  gates: 300_000,
  schemaDrift: 120_000,
  mirrors: 60_000,
}

export function parseArgs(argv) {
  const flags = { skipE2e: false, fix: false, bundle: false, network: false, gate: null }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--skip-e2e') flags.skipE2e = true
    else if (a === '--fix') flags.fix = true
    else if (a === '--bundle') flags.bundle = true
    else if (a === '--network') flags.network = true
    else if (a === '--gate') flags.gate = argv[i + 1] || null
  }
  return flags
}

export function statusOf(exit) {
  return exit === 0 ? '✅' : '❌'
}

export function run(command, { cwd = ROOT, timeout = TIME.scripts } = {}) {
  try {
    const out = execFileSync('cmd', ['/c', command], {
      cwd,
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { exit: 0, output: String(out || '').trim() }
  } catch (err) {
    const buf = (err.stdout || err.stderr || '').toString()
    return { exit: typeof err.status === 'number' ? err.status : 1, output: buf.trim() }
  }
}

export function countersCommand(flags) {
  const args = ['node scripts/test-counter-audit.mjs']
  if (flags.skipE2e) args.push('--skip-e2e')
  if (flags.fix) args.push('--fix')
  return args.join(' ')
}

export function collectChecks(flags) {
  const checks = []
  const counters = run(countersCommand(flags), { timeout: TIME.counters })
  checks.push({ name: 'счётчики тестов', cmd: countersCommand(flags), exit: counters.exit, note: lastLine(counters.output) })
  const tsc = run('npx tsc --noEmit', { timeout: TIME.scripts })
  checks.push({ name: 'tsc --noEmit', cmd: 'npx tsc --noEmit', exit: tsc.exit })
  const lint = run('npm run lint', { timeout: TIME.scripts })
  checks.push({ name: 'eslint (root)', cmd: 'npm run lint', exit: lint.exit, note: lintSummary(lint.output) })
  const lintServer = run('npm run lint:server', { timeout: TIME.scripts })
  checks.push({ name: 'eslint (server)', cmd: 'npm run lint:server', exit: lintServer.exit, note: lintSummary(lintServer.output) })
  const build = run('npm run build', { timeout: TIME.build })
  checks.push({ name: 'vite build', cmd: 'npm run build', exit: build.exit })
  for (const gate of OFFLINE_CHECKS) {
    const res = run(gate.cmd, { timeout: gate.name === 'schema-drift --offline' ? TIME.schemaDrift : gate.name === 'check:mirrors' ? TIME.mirrors : TIME.gates })
    checks.push({ name: gate.name, cmd: gate.cmd, exit: res.exit })
  }
  if (flags.bundle) {
    const bundle = run('npm run check:bundle', { timeout: TIME.gates })
    checks.push({ name: 'check:bundle', cmd: 'npm run check:bundle', exit: bundle.exit, note: lastLine(bundle.output) })
  }
  if (flags.network) {
    const auditRoot = run('npm run audit:prod', { timeout: TIME.scripts })
    checks.push({ name: 'audit:prod (root)', cmd: 'npm run audit:prod', exit: auditRoot.exit, note: lastLine(auditRoot.output) })
    const auditServer = run('npm run audit:prod', { cwd: path.join(ROOT, 'server'), timeout: TIME.scripts })
    checks.push({ name: 'audit:prod (server)', cmd: 'npm run audit:prod (server/)', exit: auditServer.exit, note: lastLine(auditServer.output) })
    const deps = run('npm run check:deps', { timeout: TIME.gates })
    checks.push({ name: 'check:deps', cmd: 'npm run check:deps', exit: deps.exit })
  }
  return checks
}

export function lastLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

export function lintSummary(output) {
  const match = String(output || '').match(/(\d+) error/)
  return match ? `${match[1]} errors` : ''
}

export function flagList(flags) {
  const out = []
  if (flags.skipE2e) out.push('--skip-e2e')
  if (flags.fix) out.push('--fix')
  if (flags.bundle) out.push('--bundle')
  if (flags.network) out.push('--network')
  return out.join(' ')
}

export function renderTable(checks) {
  const rows = checks.map((c) => `| ${c.name} | \`${c.cmd}\` | ${c.exit} | ${statusOf(c.exit)} |`)
  return ['| проверка | команда | exit | статус |', '|---|---|---|---|', ...rows].join('\n')
}

export function renderFactBlock({ date, flags, checks, skipped }) {
  const exitOf = (name) => {
    const c = checks.find((x) => x.name === name)
    return c ? c.exit : null
  }
  const red = checks.filter((c) => c.exit !== 0)
  const counters = checks.find((c) => c.name === 'счётчики тестов')
  const countersNote = counters && counters.note ? counters.note : counters ? `exit ${counters.exit}` : '—'
  const tscNote = exitOf('tsc --noEmit') === 0 ? '0 ошибок' : exitOf('tsc --noEmit') === null ? '—' : `exit ${exitOf('tsc --noEmit')}`
  const lintRoot = checks.find((c) => c.name === 'eslint (root)')
  const lintServer = checks.find((c) => c.name === 'eslint (server)')
  const lintTotal = [lintRoot, lintServer].filter((c) => c && c.note).map((c) => c.note).join(' + ')
  const buildNote = exitOf('vite build') === 0 ? statusOf(0) : exitOf('vite build') === null ? '—' : statusOf(exitOf('vite build'))
  const gateChecks = checks.filter((c) => c.name.startsWith('check:') || c.name.startsWith('schema-drift'))
  const gateGreen = gateChecks.filter((c) => c.exit === 0).length
  const lines = []
  lines.push(`=== ФАКТЫ ЭТАПА ${date} ===`)
  lines.push(`Команда: node scripts/stage-facts.mjs${flagList(flags) ? ' ' + flagList(flags) : ''}`)
  lines.push('')
  lines.push('**Проверки.**')
  lines.push(`- **Тесты:** ${countersNote}`)
  lines.push(`- **tsc --noEmit:** ${tscNote}`)
  lines.push(`- **eslint:** ${lintTotal || (lintRoot ? `root exit ${lintRoot.exit}` : '—')}${lintServer ? `, ${lintServer.name}: exit ${lintServer.exit}` : ''}`)
  lines.push(`- **vite build:** ${buildNote}`)
  lines.push(`- **Гейты:** ${gateGreen}/${gateChecks.length} ✅ — ${gateChecks.filter((c) => c.exit === 0).map((c) => c.name).join(', ')}`)
  lines.push('')
  lines.push('Таблица прогона:')
  lines.push(renderTable(checks))
  lines.push('')
  if (skipped && skipped.length) {
    lines.push(`Не запущено (окружение/флаги): ${skipped.join('; ')}.`)
  }
  if (red.length) {
    lines.push('')
    lines.push(`❌ Красные (${red.length}): ${red.map((c) => c.name).join(', ')} — чинить до записи в журнал.`)
  }
  lines.push('')
  lines.push('Измерено прогоном, не перепечаткой; числа в шапки журналов — `node scripts/test-counter-audit.mjs --fix`.')
  return lines.join('\n')
}

export function skippedFor(flags) {
  const out = ['check:console (живые серверы 8081/3002)']
  if (!flags.bundle) out.push('check:bundle (--bundle)')
  if (!flags.network) out.push('audit:prod root+server, check:deps (--network, нужен npm-реестр)')
  return out
}

export function todayRu(now = new Date()) {
  const p = (v) => String(v).padStart(2, '0')
  return `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`
}

function main() {
  const flags = parseArgs(process.argv.slice(2))
  const last = process.argv[process.argv.length - 1] || ''
  const date = /^\d{2}\.\d{2}\.\d{4}$/.test(last) ? last : todayRu()
  let checks
  if (flags.gate) {
    const hit = OFFLINE_CHECKS.find((c) => c.name === flags.gate)
    if (!hit) {
      console.error(`Нет проверки с именем «${flags.gate}». Офлайн: ${OFFLINE_CHECKS.map((c) => c.name).join(', ')}`)
      process.exit(2)
    }
    const res = run(hit.cmd, { timeout: TIME.gates })
    checks = [{ name: hit.name, cmd: hit.cmd, exit: res.exit }]
  } else {
    checks = collectChecks(flags)
  }
  console.log(renderFactBlock({ date, flags, checks, skipped: skippedFor(flags) }))
  process.exit(checks.some((c) => c.exit !== 0) ? 1 : 0)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()