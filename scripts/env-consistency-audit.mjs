/**
 * Гейт «консистентность переменных окружения» (этап 45, N7).
 *
 * Класс дыр, который он закрывает, — «работает у меня». Переменная, которую
 * код читает (`process.env.X` на сервере, `import.meta.env.X` на фронте),
 * обязана быть объявлена хотя бы в одном эталоне окружения: `server/.env.example`,
 * корневой `.env.example` (в docker-compose `env_file: .env`), секция
 * `environment` сервиса `app` в `docker-compose.yml`. Если объявления нет —
 * на VPS/в CI переменная undefined, и код молча уходит в fallback либо падает
 * с невнятной ошибкой, а коллега, читающий пример, даже не узнает, что такая
 * настройка существует. Гейт ловит это до деплоя.
 *
 * Три направления проверок:
 *
 *  1. **Код сервера ⊆ эталоны.** Каждая `process.env.X` в `server/src` вне
 *     системных переменных ОС/npm обязана присутствовать хотя бы в одном из:
 *     `server/.env.example`, корневой `.env.example`, `docker-compose.yml`
 *     (environment сервиса `app`). Обратное направление (ключ объявлен, но код
 *     не читает) — не находка: это задел, а не дыра.
 *  2. **Код фронта ⊆ корневой `.env.example`.** Каждая `import.meta.env.X`
 *     в `src/` вне встроенных Vite-переменных (`DEV/PROD/MODE/BASE_URL/SSR`)
 *     обязана быть в корневом `.env.example`. Встроенные Vite-переменные в
 *     примере не объявляются — они от Vite, а не от окружения.
 *  3. **docker-compose не тащит мёртвых настроек.** Каждая переменная из
 *     `environment` сервиса `app` обязана читаться кодом. Переменная, которую
 *     контейнер получает, а код игнорирует, создаёт иллюзию настройки: её
 *     меняют в compose, а ничего не происходит.
 *
 * Серверные тесты (`__tests__`) из сканирования исключены: они сами задают
 * `process.env` в рантайме, и объявлять их переменные в примерах бессмысленно.
 * Гейт читает файлы, зависимостей не требует — зелёный в CI и локально.
 */

import fs from 'node:fs'
import path from 'node:path'

const SERVER_ROOT = 'server/src'
const FRONT_ROOT = 'src'
const SERVER_EXAMPLE = 'server/.env.example'
const ROOT_EXAMPLE = '.env.example'
const COMPOSE = 'docker-compose.yml'
const SKIP_DIRS = new Set(['__tests__', 'node_modules', 'test', '.git'])

/** Встроенные переменные Vite: их в .env.example нет и не должно быть. */
const VITE_BUILTINS = new Set(['DEV', 'PROD', 'MODE', 'BASE_URL', 'SSR'])

/** Системные переменные Node/ОС/npm — объявлять их в примере бессмысленно. */
const SYSTEM_VARS = new Set([
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'CommonProgramW6432',
  'ProgramData',
  'ALLUSERSPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'OS',
  'PATH',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'SESSIONNAME',
  'SystemRoot',
  'WINDIR',
  'SystemDrive',
  'HOMEDRIVE',
  'HOMEPATH',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  'PROCESSOR_LEVEL',
  'PROCESSOR_REVISION',
  'COMSPEC',
  'PUBLIC',
  'PWD',
  'npm_package_version',
  'npm_package_name',
  'npm_config_registry',
])

function readRepoFile(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function listFiles(dir, relRoot, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) listFiles(full, relRoot, acc)
    else if (/\.(js|ts|tsx)$/.test(name)) acc.push(path.relative(relRoot, full).replace(/\\/g, '/'))
  }
  return acc
}

/**
 * Ключи из `.env.example`: `KEY=...` и закомментированные `# KEY=...`.
 * Закомментированный ключ — тоже объявление (документация опциональной
 * настройки), поэтому он попадает в эталон.
 */
export function parseEnvExample(text) {
  const keys = new Set()
  for (const raw of text.split('\n')) {
    const m = /^#?\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(raw)
    if (m) keys.add(m[1])
  }
  return keys
}

/**
 * Переменные из `environment` сервиса `app` и его `env_file`.
 * Парсинг построчный: внутри блока `services:` → `app:` → `environment:`
 * собираем ключи с отступом 6 пробелов (`      KEY: value`).
 */
export function parseComposeEnv(text) {
  const envKeys = new Set()
  const lines = text.split('\n')
  let inApp = false
  let inEnvironment = false
  for (const line of lines) {
    if (/^  app:/.test(line)) {
      inApp = true
      inEnvironment = false
      continue
    }
    if (!inApp) continue
    if (/^  \w/.test(line) && !/^  app:/.test(line)) {
      // вышли из сервиса app (следующий сервис на отступе 2)
      inApp = false
      inEnvironment = false
      continue
    }
    if (/^    environment:/.test(line)) {
      inEnvironment = true
      continue
    }
    if (/^    [a-z_]+:/.test(line) && !/^    environment:/.test(line)) {
      inEnvironment = false
      continue
    }
    if (inEnvironment) {
      const m = /^      ([A-Za-z_][A-Za-z0-9_]*):/.exec(line)
      if (m) envKeys.add(m[1])
    }
  }
  return envKeys
}

/**
 * Вычищает комментарии (блочные и однострочные), сохраняя длины строк —
 * номера строк в отчёте остаются настоящими. Подход тот же, что и в
 * api-contract.test.js: без этого упоминание `process.env.X` в JSDoc-примере
 * давало бы ложную находку «код читает переменную».
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, keep) => keep + ' '.repeat(m.length - keep.length))
}

/** `process.env.X` / `process.env['X']` в исходнике: имя + номер первой строки. */
export function extractProcessEnv(source) {
  const code = stripComments(source)
  const vars = new Map()
  // (?<!['"`]) — не считать вхождения внутри строкового литерала: строка
  // `'process.env.NODE_ENV'` — текст, а не чтение переменной.
  for (const m of code.matchAll(/(?<!['"`])process\.env\.([A-Za-z_][A-Za-z0-9_]*)|(?<!['"`])process\.env\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\]/g)) {
    const name = m[1] || m[2]
    if (!vars.has(name)) vars.set(name, code.slice(0, m.index).split('\n').length)
  }
  return vars
}

/** `import.meta.env.X` / `import.meta.env['X']` в исходнике: имя + номер первой строки. */
export function extractImportMetaEnv(source) {
  const code = stripComments(source)
  const vars = new Map()
  for (const m of code.matchAll(/(?<!['"`])import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)|(?<!['"`])import\.meta\.env\[\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\]/g)) {
    const name = m[1] || m[2]
    if (VITE_BUILTINS.has(name)) continue
    if (!vars.has(name)) vars.set(name, code.slice(0, m.index).split('\n').length)
  }
  return vars
}

export function audit(root) {
  const serverFiles = listFiles(path.join(root, SERVER_ROOT), root)
  const frontFiles = listFiles(path.join(root, FRONT_ROOT), root)

  const serverEnv = new Map() // var -> [{ file, line }]
  const frontEnv = new Map()

  for (const rel of serverFiles) {
    const text = readRepoFile(root, rel)
    for (const [name, line] of extractProcessEnv(text)) {
      if (!serverEnv.has(name)) serverEnv.set(name, [])
      serverEnv.get(name).push({ file: rel, line })
    }
  }
  for (const rel of frontFiles) {
    const text = readRepoFile(root, rel)
    for (const [name, line] of extractImportMetaEnv(text)) {
      if (VITE_BUILTINS.has(name)) continue
      if (!frontEnv.has(name)) frontEnv.set(name, [])
      frontEnv.get(name).push({ file: rel, line })
    }
  }

  const serverExample = parseEnvExample(readRepoFile(root, SERVER_EXAMPLE))
  const rootExample = parseEnvExample(readRepoFile(root, ROOT_EXAMPLE))
  const composeEnv = parseComposeEnv(readRepoFile(root, COMPOSE))

  const serverDeclared = new Set([...serverExample, ...rootExample, ...composeEnv, ...SYSTEM_VARS])

  const problems = []

  // 1. Серверный код: каждая process.env.* обязана быть где-то объявлена.
  for (const [name, uses] of serverEnv) {
    if (serverDeclared.has(name)) continue
    const u = uses[0]
    problems.push(
      `${u.file}:${u.line}: код читает process.env.${name}, но его нет ни в server/.env.example, ` +
        `ни в корневом .env.example, ни в docker-compose (environment сервиса app) — ` +
        `«работает у меня»: на VPS переменная undefined`,
    )
  }

  // 2. Фронтовый код: каждая import.meta.env.VITE_* обязана быть в корневом .env.example.
  for (const [name, uses] of frontEnv) {
    if (rootExample.has(name)) continue
    const u = uses[0]
    problems.push(
      `${u.file}:${u.line}: код читает import.meta.env.${name}, но его нет в корневом .env.example — ` +
        `на другом окружении Vite соберёт бандл с undefined`,
    )
  }

  // 3. docker-compose: каждая переменная environment сервиса app обязана читаться кодом.
  for (const name of composeEnv) {
    if (serverEnv.has(name) || serverExample.has(name) || SYSTEM_VARS.has(name)) continue
    problems.push(
      `docker-compose.yml: сервис app передаёт ${name} в environment, но код его не читает — ` +
        `мёртвая настройка: её меняют в compose, а ничего не меняется`,
    )
  }

  return {
    facts: {
      serverFiles: serverFiles.length,
      frontFiles: frontFiles.length,
      serverEnv: serverEnv.size,
      frontEnv: frontEnv.size,
      serverExampleKeys: serverExample.size,
      rootExampleKeys: rootExample.size,
      composeKeys: composeEnv.size,
    },
    problems,
  }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`файлов сервера без тестов: ${facts.serverFiles}, файлов фронта: ${facts.frontFiles}`)
  console.log(`process.env.* в коде: ${facts.serverEnv}, import.meta.env.* в коде: ${facts.frontEnv}`)
  console.log(`ключей в server/.env.example: ${facts.serverExampleKeys}, в корневом .env.example: ${facts.rootExampleKeys}`)
  console.log(`переменных в environment сервиса app (docker-compose): ${facts.composeKeys}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: переменные окружения, которые код читает, не везде объявлены в эталонах — на VPS/CI они будут undefined.')
    process.exit(1)
  }
  console.log('\nИтог: каждый process.env.* сервера и каждый import.meta.env.* фронта объявлен в эталоне окружения; docker-compose мёртвых настроек не тащит.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()