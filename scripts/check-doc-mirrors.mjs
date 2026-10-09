/**
 * Гейт «зеркала `test/` совпадают с корнем побайтово» (`npm run check:mirrors`).
 *
 * Каталог `test/` — ручная копия ключевых доков для внешнего анализа; он живёт
 * под `.gitignore`, поэтому сверка локальная. Если зеркало не собрано (свежий
 * клон или CI: части файлов нет) — гейт пропускает проверку (exit 0); собрать
 * зеркало: `--fix`. Забытый синк уже случался: зеркало
 * `Что сделано.txt` отставало и несло утёкший VAPID-ключ (журнал, 217-219).
 *
 * Сверка — sha256 по явным парам (не обход каталога): только эти файлы обязаны
 * совпадать, `test/СВОДКА.md`, `test/ИНВЕНТАРЬ-ТЕСТОВ.md` и `test/Для анализа.txt`
 * живут только в `test/` и пары не имеют.
 *
 * Флаги: `--fix` — приводит зеркало к корню (создать/перезаписать).
 * Счётчики тестов внутри зеркал сверяет `node scripts/test-counter-audit.mjs`,
 * этот гейт отвечает только за побайтовое совпадение.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const PAIRS = [
  ['Что сделано.txt', 'test/Что сделано.txt'],
  ['Что доделать.txt', 'test/Что доделать.txt'],
  ['README.md', 'test/README.md'],
  ['project-context.md', 'test/project-context.md'],
  ['AGENTS.md', 'test/AGENTS.md'],
  ['CONTRIBUTING.md', 'test/CONTRIBUTING.md'],
  ['Промты.txt', 'test/Промты.txt'],
  ['docs/AGENTS-pitfalls.md', 'test/AGENTS-pitfalls.md'],
  ['docs/product-roadmap.md', 'test/product-roadmap.md'],
]

export function sha256Of(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/**
 * Сверяет пары корень ↔ `test/`. Возвращает статус по каждой паре:
 * `ok`, `created`, `synced`, `missing`, `diverged`, `source-missing`.
 * @param {string} root корень репозитория
 * @param {{fix?: boolean, pairs?: string[][]}} options
 */
export function syncMirrors(root, options = {}) {
  const fix = Boolean(options.fix)
  const pairs = options.pairs || PAIRS
  const results = []
  for (const [src, dst] of pairs) {
    const sp = path.join(root, src)
    const dp = path.join(root, dst)
    if (!fs.existsSync(sp)) {
      results.push({ src, dst, status: 'source-missing' })
      continue
    }
    if (!fs.existsSync(dp)) {
      if (fix) {
        fs.mkdirSync(path.dirname(dp), { recursive: true })
        fs.copyFileSync(sp, dp)
        results.push({ src, dst, status: 'created' })
      } else {
        results.push({ src, dst, status: 'missing' })
      }
      continue
    }
    if (sha256Of(sp) !== sha256Of(dp)) {
      if (fix) {
        fs.copyFileSync(sp, dp)
        results.push({ src, dst, status: 'synced' })
      } else {
        results.push({ src, dst, status: 'diverged' })
      }
      continue
    }
    results.push({ src, dst, status: 'ok' })
  }
  return results
}

function main() {
  const fix = process.argv.slice(2).includes('--fix')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  if (!fs.existsSync(path.join(root, 'test'))) {
    console.log('test/ не существует — пропуск (skip): зеркала под .gitignore, в CI их нет')
    process.exit(0)
  }
  const results = syncMirrors(root, { fix })
  const missing = results.filter((r) => r.status === 'missing')
  if (!fix && missing.length) {
    console.log(`зеркало test/ не собрано (${missing.length} из ${results.length} пар отсутствуют) — пропуск (skip); собрать: node scripts/check-doc-mirrors.mjs --fix`)
    process.exit(0)
  }
  let ok = true
  for (const { src, dst, status } of results) {
    if (status === 'ok') console.log(`[ok] ${dst}`)
    else if (status === 'created') console.log(`[fix] создан: ${dst}`)
    else if (status === 'synced') console.log(`[fix] синхронизирован: ${dst}`)
    else if (status === 'source-missing') console.warn(`[skip] исходник не найден: ${src}`)
    else if (status === 'missing') {
      console.error(`[ERR] зеркало отсутствует: ${dst}`)
      ok = false
    } else {
      console.error(`[ERR] расхождение SHA256: ${src} ↔ ${dst}`)
      ok = false
    }
  }
  if (ok) {
    console.log('\nЗеркала test/ совпадают с корнем побайтово.')
    process.exit(0)
  }
  console.error('\nЗеркала разошлись с корнем. Починить: node scripts/check-doc-mirrors.mjs --fix')
  process.exit(1)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
