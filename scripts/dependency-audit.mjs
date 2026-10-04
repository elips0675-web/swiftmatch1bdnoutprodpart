/**
 * Гейт «целостность зависимостей» (этап 31, P1-B5).
 *
 * Проверяет package.json в обе стороны, потому что обе дыры молчат:
 *
 *  1. Импортируется, но не объявлено. `npm ci` ставит только объявленное, поэтому
 *     такой импорт работает у разработчика (пакет случайно есть в node_modules
 *     транзитивно) и падает на чистой машине и в CI. Найдено на этапе 31:
 *     `src/hooks/use-deep-links.ts:28` делает `require('@capacitor/app')` — пакета
 *     нет ни в package.json, ни в node_modules, а ветка обёрнута в try/catch, то
 *     есть App Links включались «на всякий случай» и никогда не включались.
 *
 *  2. Объявлено в `dependencies`, но не импортируется нигде. В образ едет
 *     `npm ci --omit=dev` (Dockerfile), поэтому мёртвая runtime-зависимость — это
 *     и вес образа, и поверхность атаки, и время установки. Найдено на этапе 31:
 *     `zod` (это и есть B5 из бэклога), `next-themes` (остаток от Next.js при
 *     Vite-сборке), `@hookform/resolvers`, `react-is` (нужен только recharts, и
 *     как транзитивный).
 *
 * `devDependencies` направление 2 не проверяет: половина из них (eslint, prettier,
 * typescript, husky, playwright, jsdom, @types/*) вызывается как CLI, а не
 * импортируется, и гейт превратился бы в список из 25 строк.
 *
 * Спецификаторы берутся из AST (typescript, уже объявлен в devDependencies), а не
 * регуляркой по тексту. На тексте гейт цеплял сам себя: упоминание пакета в
 * JSDoc-шапке и в строковых фикстурах тестов выглядит как импорт. Ровно та же
 * ловушка, что описана в docs/AGENTS-pitfalls.md для конфигурационных гейтов:
 * проверка по сырому тексту довольна упоминанием, а не фактом.
 *
 * allowlist (`scripts/dependency-audit.allow.json`) закрывает только то, что
 * действительно нужно без импорта: нативные плагины Capacitor (JS-обвязки у них
 * нет, их подключает Gradle), скрипты нагрузки k6 (их исполняет бинарь k6, не
 * node) и неподключённый плагин Sentry. Каждая запись обязана нести причину
 * (пустая причина — замечание гейта), а протухшая запись (пакет уже импортируется
 * или вычеркнут из манифеста) — тоже замечание: иначе allowlist становится свалкой,
 * где любое имя глушит любое будущее замечание.
 *
 * Область импорта определяется расположением файла: под `server/` — сверка с
 * server/package.json, остальное — с корневым. Ошибка «взял зависимость соседней
 * половины» на чистой машине означает ENOENT.
 */
import fs from 'node:fs'
import path from 'node:path'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWLIST_REL = 'scripts/dependency-audit.allow.json'

const BUILTIN = new Set(
  builtinModules.flatMap((m) => [m, `node:${m}`, m.replace(/^node:/, '')]),
)
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  'playwright-report',
  'test-results',
  'android',
  'ios',
])

const ROOT_DIRS = ['src', 'e2e', 'scripts', 'database']
const SERVER_DIRS = ['server/src', 'server/scripts']

const CALLEE_NAMES = new Set([
  'require',
  'import',
  'mock',
  'unmock',
  'doMock',
  'importActual',
  'importMock',
])

const LOCAL_PREFIX = /^[./]|^@\/|^~\//

/**
 * Спецификатор → имя пакета: `mysql2/promise` → `mysql2`, `@scope/pkg/sub` →
 * `@scope/pkg`.
 */
export function packageNameOf(specifier) {
  const parts = specifier.split('/')
  if (specifier.startsWith('@')) return parts.slice(0, 2).join('/')
  return parts[0]
}

function isBareSpecifier(specifier) {
  if (!specifier) return false
  if (LOCAL_PREFIX.test(specifier)) return false
  if (specifier.startsWith('node:')) return false
  if (BUILTIN.has(specifier)) return false
  return true
}

function literalOf(node) {
  if (!node) return null
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}

function calleeName(node) {
  if (ts.isIdentifier(node)) return node.text
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    return node.name.text
  }
  return null
}

/**
 * Все базовые спецификаторы файла — из AST, с номерами строк.
 * @param {string} file путь для отчёта
 * @param {string} text исходник
 * @returns {{name: string, file: string, line: number, specifier: string}[]}
 */
export function findSpecifiers(file, text) {
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const out = []
  const lineOf = (node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

  const record = (node) => {
    const specifier = literalOf(node)
    if (!specifier || !isBareSpecifier(specifier)) return
    const name = packageNameOf(specifier)
    if (!name || BUILTIN.has(name)) return
    out.push({ name, file, line: lineOf(node), specifier })
  }

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      record(node.moduleSpecifier)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node.moduleReference.expression)
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword
      if (dynamic || CALLEE_NAMES.has(calleeName(node.expression))) {
        record(node.arguments[0])
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function isDeclared(manifest, name) {
  return Boolean(
    manifest?.dependencies?.[name] ||
      manifest?.devDependencies?.[name] ||
      manifest?.peerDependencies?.[name] ||
      manifest?.optionalDependencies?.[name],
  )
}

function runtimeDeps(manifest) {
  return Object.keys(manifest?.dependencies || {})
}

/** Файлы области: каталоги + корневые файлы, без node_modules/dist/мусора. */
export function listScopeFiles(root, dirs, rootFiles) {
  const out = []
  const walk = (rel) => {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) return
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        walk(`${rel}/${entry.name}`)
      } else if (CODE_EXT.test(entry.name)) {
        out.push(`${rel}/${entry.name}`)
      }
    }
  }
  for (const dir of dirs) walk(dir)
  for (const file of rootFiles) {
    if (fs.existsSync(path.join(root, file))) out.push(file)
  }
  return [...new Set(out)].sort()
}

export function rootLevelCodeFiles(root) {
  return fs.readdirSync(root).filter((f) => CODE_EXT.test(f)).sort()
}

export function serverLevelCodeFiles(root) {
  const dir = path.join(root, 'server')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => CODE_EXT.test(f)).sort()
}

/**
 * Разбор allowlist. Пустая причина, дубль и неизвестная структура — не тихий
 * проход гейта, а замечание.
 */
export function parseAllowlist(raw) {
  const entries = new Map()
  const problems = []
  if (raw === undefined || raw === null || raw.entries === undefined) {
    return { entries, problems }
  }
  const list = Array.isArray(raw) ? raw : raw.entries
  if (!Array.isArray(list)) {
    problems.push({
      type: 'allowlist-malformed',
      detail: `${ALLOWLIST_REL}: ожидается { "entries": [{ "package": "...", "reason": "..." }] }`,
    })
    return { entries, problems }
  }
  for (const item of list) {
    const pkg = item && typeof item.package === 'string' ? item.package.trim() : ''
    const reason = item && typeof item.reason === 'string' ? item.reason.trim() : ''
    if (!pkg) {
      problems.push({ type: 'allowlist-malformed', detail: 'запись без поля "package"' })
      continue
    }
    if (entries.has(pkg)) {
      problems.push({
        type: 'allowlist-duplicate',
        detail: `${pkg}: продублирована в allowlist`,
      })
      continue
    }
    entries.set(pkg, {
      reason,
      externalRuntime: item.externalRuntime === true,
    })
    if (!reason) {
      problems.push({
        type: 'allowlist-missing-reason',
        detail: `${pkg}: пустая причина — allowlist без причины это заглушка гейта`,
      })
    }
  }
  return { entries, problems }
}

/**
 * Основная проверка на абстрактных входных данных: юнит-тесты гоняют её на
 * фикстурах, `auditRepository` — на живом репозитории.
 *
 * @param {{scopes: {manifestPath: string, manifest: object, files: {file: string, text: string}[]}[], allowlistRaw?: unknown}} input
 */
export function auditDependencies({ scopes, allowlistRaw }) {
  const { entries: allow, problems: allowProblems } = parseAllowlist(allowlistRaw)
  const findings = [...allowProblems]
  const declaredSomewhere = new Set()
  const usedSomewhere = new Set()
  const suppressedBy = new Set()

  for (const scope of scopes) {
    const { manifestPath, manifest, files } = scope
    const declaredHere = new Set([
      ...Object.keys(manifest.dependencies || {}),
      ...Object.keys(manifest.devDependencies || {}),
      ...Object.keys(manifest.peerDependencies || {}),
      ...Object.keys(manifest.optionalDependencies || {}),
    ])
    for (const name of declaredHere) declaredSomewhere.add(name)

    const used = new Map()
    for (const { file, text } of files) {
      for (const hit of findSpecifiers(file, text)) {
        usedSomewhere.add(hit.name)
        if (!used.has(hit.name)) used.set(hit.name, [])
        used.get(hit.name).push(hit)
      }
    }

    for (const [name, hits] of [...used].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (declaredHere.has(name)) continue
      if (allow.has(name)) {
        suppressedBy.add(name)
        continue
      }
      const first = hits[0]
      const extra = hits.length > 1 ? ` (+${hits.length - 1} мест)` : ''
      findings.push({
        type: 'undeclared-import',
        detail: `${manifestPath}: "${name}" импортируется в ${first.file}:${first.line}${extra}, но не объявлен ни в dependencies, ни в devDependencies — на чистой машине это ENOENT.`,
      })
    }

    for (const name of runtimeDeps(manifest).sort()) {
      if (used.has(name)) continue
      if (allow.has(name)) {
        suppressedBy.add(name)
        continue
      }
      findings.push({
        type: 'unused-runtime-dependency',
        detail: `${manifestPath}: "${name}" объявлена в dependencies, но не импортируется ни одним файлом области — в образ едет через npm ci --omit=dev.`,
      })
    }
  }

  for (const [name, meta] of [...allow].sort((a, b) => a[0].localeCompare(b[0]))) {
    const reason = meta.reason
    if (!meta.externalRuntime && !declaredSomewhere.has(name)) {
      findings.push({
        type: 'allowlist-unknown-package',
        detail: `${ALLOWLIST_REL}: "${name}" не объявлена ни в одном package.json — запись протухла или это опечатка. Если это внешний рантайм, а не npm-пакет, поставь "externalRuntime": true.`,
      })
      continue
    }
    if (!suppressedBy.has(name)) {
      findings.push({
        type: 'allowlist-unused',
        detail: usedSomewhere.has(name)
          ? `${ALLOWLIST_REL}: "${name}" уже импортируется кодом — протухшая запись больше ничего не глушит и закроет будущую реальную находку.`
          : `${ALLOWLIST_REL}: "${name}" не требуется (${reason || 'без причины'}) — запись протухла.`,
      })
    }
  }

  return findings
}

export function readAllowlistFile(root) {
  const file = path.join(root, ALLOWLIST_REL)
  if (!fs.existsSync(file)) return {}
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function auditRepository(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
  const toFiles = (rels) => rels.map((file) => ({ file, text: read(file) }))

  return auditDependencies({
    allowlistRaw: readAllowlistFile(root),
    scopes: [
      {
        manifestPath: 'package.json',
        manifest: JSON.parse(read('package.json')),
        files: toFiles(listScopeFiles(root, ROOT_DIRS, rootLevelCodeFiles(root))),
      },
      {
        manifestPath: 'server/package.json',
        manifest: JSON.parse(read('server/package.json')),
        files: toFiles(
          listScopeFiles(root, SERVER_DIRS, serverLevelCodeFiles(root)),
        ),
      },
    ],
  })
}

function main() {
  const findings = auditRepository(ROOT)
  if (findings.length === 0) {
    console.log('Зависимости целы: импортируемое объявлено, объявленное используется.')
    return 0
  }
  console.error(`Замечаний: ${findings.length}`)
  for (const f of findings) console.error(`  [${f.type}] ${f.detail}`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}