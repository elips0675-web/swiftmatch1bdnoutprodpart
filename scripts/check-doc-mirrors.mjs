/**
 * Гейт «зеркала `test/` совпадают с корнем побайтово» (`npm run check:mirrors`).
 *
 * Каталог `test/` — компактный набор для внешнего AI-анализа (10 документов,
 * плюс подпапка `machine/` с выгрузками гейта счётчиков). Все 8 пар трекаются
 * в git (добавляются `git add -f`, т.к. каталог в `.gitignore`), поэтому гейт
 * вызывается и из CI, и отсутствие зеркала или расхождение — это падение
 * (exit 1), а не пропуск: скип-на-отсутствии давал зелёный гейт без единой
 * сверки (свежий клон получал часть пар, остальные молча пропускались).
 * Забытый синк уже случался: зеркало `Что сделано.txt` отставало и несло
 * утёкший VAPID-ключ (журнал, 217-219).
 *
 * Сверка — sha256 по явным парам (не обход каталога): только эти файлы обязаны
 * совпадать. В пары входит набор «правила + состояние»: `AGENTS.md` и четыре
 * модуля правил (`pitfalls`, `workflow`, `production`, `security`), `README.md`,
 * `project-context.md` и `Что доделать.txt`. Остальные доки (`docs/AGENTS-i18n.md`
 * и др., `docs/architecture.md`, `docs/past-mistakes.md`, `docs/product-roadmap.md`)
 * остаются каноном в `docs/` и в `test/` не дублируются — суть их непререкаемых
 * правил уже в «Гипер-кратком резюме» `AGENTS.md`. Файлы `test/ИНВЕНТАРЬ-ТЕСТОВ.md`
 * и `test/Для анализа.txt` живут только в `test/` и пары не имеют.
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
  ['Что доделать.txt', 'test/Что доделать.txt'],
  ['README.md', 'test/README.md'],
  ['project-context.md', 'test/project-context.md'],
  ['AGENTS.md', 'test/AGENTS.md'],
  ['docs/AGENTS-pitfalls.md', 'test/AGENTS-pitfalls.md'],
  ['docs/AGENTS-workflow.md', 'test/AGENTS-workflow.md'],
  ['docs/AGENTS-production.md', 'test/AGENTS-production.md'],
  ['docs/AGENTS-security.md', 'test/AGENTS-security.md'],
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

/**
 * Итог сверки: зелёный гейт только когда каждая пара `ok` (при `--fix` — ещё и
 * `created`/`synced`). `missing` без `--fix` — падение, а не пропуск (скип
 * давал зелёный гейт без единой сверки на свежем клоне). `source-missing` —
 * отсутствует исходник в корне (конфигурация пары), не блокирует.
 * @param {Array<{src: string, status: string}>} results
 * @param {{fix?: boolean}} options
 */
export function evaluate(results, options = {}) {
  const fix = Boolean(options.fix)
  const missing = results.filter((r) => r.status === 'missing')
  if (!fix && missing.length) {
    return { ok: false, missing: missing.length, total: results.length }
  }
  return { ok: true, missing: 0, total: results.length }
}

function main() {
  const fix = process.argv.slice(2).includes('--fix')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const testDir = path.join(root, 'test')
  if (!fs.existsSync(testDir)) {
    if (!fix) {
      console.error('test/ не существует — зеркала отсутствуют (FAIL). Собрать: node scripts/check-doc-mirrors.mjs --fix')
      process.exit(1)
    }
    fs.mkdirSync(testDir, { recursive: true })
  }
  const results = syncMirrors(root, { fix })
  const verdict = evaluate(results, { fix })
  if (!fix && verdict.missing) {
    console.log(`зеркало test/ не собрано (${verdict.missing} из ${verdict.total} пар отсутствуют) — FAIL; собрать: node scripts/check-doc-mirrors.mjs --fix`)
    process.exit(1)
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
