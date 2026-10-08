/**
 * Гейт «покрытие Swagger-документации» (этап 45, N7).
 *
 * Класс дыр, который он закрывает, — «документация живёт своей жизнью».
 * Swagger собирается из JSDoc-аннотаций `@openapi` внутри роутов, поэтому
 * аннотация может: (а) описывать путь, которого в коде нет — Swagger UI
 * покажет эндпоинт, который на деле отдаёт 404; (б) молча исчезнуть при
 * рефакторинге — документация сожмётся, а фронт, читающий /api-docs.json,
 * потеряет контракт. Гейт ловит оба дрейфа до деплоя.
 *
 * Три проверки:
 *
 *  1. **Базовая линия по числу операций.** Операций в документации обязано
 *     быть не меньше, чем было зафиксировано на этапе 13 (47 — см.
 *     api-contract.test.js). Это «нижняя граница», которая не даёт выпилить
 *     документацию по ходу других правок: полное покрытие — отдельная задача,
 *     а вот незаметная потеря уже задокументированного — контролируемая.
 *  2. **Документированный путь существует в коде.** Каждый путь из
 *     `@openapi`-блоков обязан находиться среди реальных `router.*`/`app.*`
 *     объявлений (с учётом префиксов из `index.js` и нормализации
 *     `:id` → `{id}`). Путь, которого нет в коде, вводит в заблуждение всех,
 *     кто читает документацию.
 *  3. **Мёртвая операция.** Каждая документированная операция (путь + метод)
 *     обязана иметь реализацию. Путь может существовать в коде, а метод —
 *     нет (например, аннотирован `post`, а в коде только `get`): это мёртвая
 *     операция, отдельный подкласс дрейфа.
 *
 * Гейт читает исходники, не импортирует swagger-jsdoc — зелёный локально и в
 * CI без установки серверных зависимостей.
 */

import fs from 'node:fs'
import path from 'node:path'

const SERVER_SRC = 'server/src'
const ROUTES_DIR = 'server/src/routes'
const BASELINE_OPS = 47 // этап 13: 47 операций из 208 роутов (api-contract.test.js)
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

function readRepoFile(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function listRouteFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listRouteFiles(full, acc)
    else if (entry.name.endsWith('.js')) acc.push(full)
  }
  return acc
}

/**
 * Извлекает пары (path, method) из @openapi-блоков.
 *
 * Формат блока (как у swagger-jsdoc):
 *   * @openapi
 *   * /api/events/{id}:
 *   *   get:
 *   * /api/premium/tiers:
 *   *   get:
 *   *   post:
 *
 * Путь — строка ` * /путь:` (один пробел после звёздочки), метод — строка
 * ` *   get:` (два и более пробелов). В одном блоке может быть несколько
 * путей и несколько методов на путь, поэтому собираем потоком: встретили
 * top-level ключ (путь `* /path:` или секцию `* components:`/`* security:`) —
 * текущий путь сменился/сбросился, встретили метод — добавили операцию.
 * Обрабатываются только блоки, содержащие `@openapi`: обычные JSDoc-комментарии
 * рядом с кодом не должны подставлять фантомные операции.
 */
export function parseOpenApiOperations(source) {
  const ops = []
  const blocks = source.match(/\/\*\*[\s\S]*?\*\//g) ?? []
  for (const block of blocks) {
    if (!/\* @openapi/.test(block)) continue
    let currentPath = null
    for (const raw of block.split('\n')) {
      const path = /^\s*\*\s(\/[^:]*):\s*$/.exec(raw)
      if (path) {
        currentPath = path[1]
        continue
      }
      const topKey = /^\s*\*\s[A-Za-z][^:]*:\s*$/.exec(raw)
      if (topKey) {
        currentPath = null
        continue
      }
      const method = /^\s*\*\s{2,}(get|post|put|patch|delete):\s*$/.exec(raw)
      if (method && currentPath) {
        ops.push({ path: currentPath, method: method[1] })
      }
    }
  }
  return ops
}

/**
 * Реальные роуты: router.* в файлах routes/ + app.* прямо в index.js,
 * с префиксами app.use из index.js и нормализацией `:id` → `{id}`.
 * Логика та же, что в api-contract.test.js (readRealRoutes).
 */
export function readRealRoutes(root) {
  const SRC = path.join(root, SERVER_SRC)
  const indexSrc = readRepoFile(root, path.join(SERVER_SRC, 'index.js'))
  const imports = new Map()
  for (const m of indexSrc.matchAll(/import\s+(\w+)\s+from\s+'\.\/routes\/([^']+)'/g)) {
    imports.set(m[1], path.normalize(path.join('routes', m[2])).replace(/\\/g, '/'))
  }
  const prefixes = new Map()
  for (const m of indexSrc.matchAll(/app\.use\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/g)) {
    prefixes.set(m[2], m[1])
  }

  const routes = []
  const add = (method, rawPath, file, line) => {
    routes.push({ method, path: rawPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}'), file, line })
  }

  for (const file of listRouteFiles(path.join(SRC, 'routes'))) {
    const code = fs.readFileSync(file, 'utf8')
    const rel = path.relative(SRC, file).replace(/\\/g, '/')
    let prefix = ''
    for (const [name, imported] of imports) {
      if (imported === rel) prefix = prefixes.get(name) ?? ''
    }
    for (const m of code.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
      add(m[1], prefix + m[2], rel, code.slice(0, m.index).split('\n').length)
    }
  }

  for (const m of indexSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) {
    add(m[1], m[2], 'index.js', indexSrc.slice(0, m.index).split('\n').length)
  }

  return routes
}

export function audit(root, { baselineOps = BASELINE_OPS } = {}) {
  const routeFiles = listRouteFiles(path.join(root, ROUTES_DIR)).map((f) => f.replace(/\\/g, '/'))
  const documented = []
  for (const file of routeFiles) {
    documented.push(...parseOpenApiOperations(readRepoFile(root, path.relative(root, file).replace(/\\/g, '/'))).map((op) => ({ ...op, file: path.relative(root, file).replace(/\\/g, '/') })))
  }

  const realRoutes = readRealRoutes(root)
  const realByPath = new Map()
  for (const r of realRoutes) {
    if (!realByPath.has(r.path)) realByPath.set(r.path, new Set())
    realByPath.get(r.path).add(r.method)
  }

  const problems = []

  // 1. Базовая линия: документация не сжимается молча.
  if (documented.length < baselineOps) {
    problems.push(
      `операций в Swagger-документации стало ${documented.length}, а этап 13 фиксировал минимум ${baselineOps} — документацию выпилили или потеряли при рефакторинге`,
    )
  }

  // 2. Документированный путь существует в коде.
  const documentedPaths = [...new Set(documented.map((d) => d.path))]
  for (const p of documentedPaths) {
    if (!realByPath.has(p)) {
      problems.push(`документированный путь ${p} не существует в коде — Swagger UI показывает эндпоинт, который отдаёт 404`)
    }
  }

  // 3. Мёртвая операция: путь есть в коде, но метода нет (или пути нет вовсе).
  for (const d of documented) {
    if (!realByPath.has(d.path)) continue // уже пойман проверкой 2
    if (!realByPath.get(d.path).has(d.method)) {
      problems.push(
        `мёртвая операция: ${d.method.toUpperCase()} ${d.path} задокументирован, но в коде для этого пути метода нет (есть: ${[...realByPath.get(d.path)].map((m) => m.toUpperCase()).join(', ')})`,
      )
    }
  }

  return {
    facts: {
      routeFiles: routeFiles.length,
      documentedOps: documented.length,
      documentedPaths: documentedPaths.length,
      realRoutes: realRoutes.length,
    },
    problems,
  }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`файлов роутов: ${facts.routeFiles}`)
  console.log(`операций в документации: ${facts.documentedOps}, документированных путей: ${facts.documentedPaths}`)
  console.log(`реальных роутов (router.* + app.*): ${facts.realRoutes}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: документация разошлась с кодом — Swagger UI показывает то, чего нет в реализации.')
    process.exit(1)
  }
  console.log('\nИтог: каждый документированный путь и метод существует в коде; базовая линия документации не сжалась.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()