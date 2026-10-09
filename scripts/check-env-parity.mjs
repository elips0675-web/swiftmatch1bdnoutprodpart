/**
 * Гейт «корневой .env.example документирует все ключи бэкенда» (P2 #34).
 *
 * `docker-compose.yml` (сервис `app`) читает `env_file: .env` — то есть
 * КОРНЕВОЙ файл. Отдельный `server/.env.example` исторически полнее: там есть
 * ключи, которых в корневом шаблоне нет. Оператор, идущий по документации,
 * выставит такой ключ в `server/.env`, а контейнер его не увидит — и прод
 * молча уйдёт на значение по умолчанию (чаще всего пустое/выключенное).
 *
 * Гейт сверяет один факт: множество ключей `server/.env.example` обязано быть
 * подмножеством ключей корневого `.env.example`. Учитываются и
 * закомментированные строки (`# KEY=`), потому что это тоже документация.
 * Обратное включение не требуется: корневой шаблон содержит ещё `VITE_*` и
 * `DEPLOY_*`, которых в серверном нет.
 *
 * Запуск: node scripts/check-env-parity.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = process.cwd()

export function parseEnvKeys(text) {
  const keys = new Set()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/)
    if (m) keys.add(m[1])
  }
  return keys
}

export function findMissingKeys(serverKeys, rootKeys) {
  return [...serverKeys].filter((k) => !rootKeys.has(k)).sort()
}

function read(rel) {
  const p = path.join(root, rel)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
}

function main() {
  const problems = []
  const serverText = read('server/.env.example')
  const rootText = read('.env.example')
  if (serverText === null) problems.push('server/.env.example не найден')
  if (rootText === null) problems.push('.env.example не найден')

  if (problems.length) {
    console.error('=== check:env-parity ===')
    problems.forEach((p) => console.error(`  - ${p}`))
    process.exit(1)
  }

  const serverKeys = parseEnvKeys(serverText)
  const rootKeys = parseEnvKeys(rootText)
  const missing = findMissingKeys(serverKeys, rootKeys)

  console.log('=== check:env-parity ===')
  console.log(`  server/.env.example ключей = ${serverKeys.size}`)
  console.log(`  .env.example        ключей = ${rootKeys.size}`)

  if (missing.length) {
    console.error('\n[FAIL] ключи есть в server/.env.example, но отсутствуют в корневом .env.example:')
    for (const k of missing) console.error(`  - ${k}`)
    console.error('\ndocker-compose (сервис app) читает КОРНЕВОЙ .env, поэтому ключ,')
    console.error('задокументированный только в server/.env.example, в контейнер не попадёт.')
    process.exit(1)
  }

  console.log('\n[OK] корневой .env.example покрывает все ключи server/.env.example')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
