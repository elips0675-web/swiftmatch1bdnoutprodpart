/**
 * Гейт бюджета бандла (`npm run check:bundle`): gzip initial JS/CSS.
 *
 * Initial определяется честно — по всем ассетам, на которые ссылается
 * `dist/index.html` (entry + modulepreload), а не по паттерну `index-*`:
 * у SwiftMatch зависимости весят в `vendor-*`, и подтяжка крупной
 * зависимости мимо паттерна — ровно тот дефект, который гейт обязан ловить.
 * Ленивые чанки маршрутов в initial не входят и не считаются.
 *
 * Перенос `scripts/check-bundle-size.js` из Service Desk (там бюджеты
 * 400/50 KB на `index-*` — их сборка и структура чанков другие),
 * адаптирован под факт SwiftMatch: базовая линия 08.10.2026 — initial JS
 * 371.7 KB gzip (index 105.1 + vendor 127.2 + ui 93.7 + animations 44.0 +
 * рантайм), initial CSS 20.3 KB. Бюджеты 500/40 KB (~35% запаса).
 * Зависимостей нет (без tinyglobby).
 *
 * Локальный инструмент, в CI не заведён: нужен собранный `dist/`
 * (`npx vite build`), гейт не запустить на чистом контуре.
 *
 * Тот же прогон держит охрану сборки (Stage 247): в `dist/` не должно быть
 * `.map` (source map отдаёт исходник один в один), а каждый initial-JS-бандл и
 * `index.html` обязаны нести уведомление об авторских правах из
 * `build.rollupOptions.output.banner` — удалить его можно только вместе со
 * сборкой заново, поэтому утёкшая копия остаётся с указанием на LICENSE.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const budgets = {
  js: { max: 500 * 1024, label: 'Initial JS' },
  css: { max: 40 * 1024, label: 'Initial CSS' },
}

let html
try {
  html = readFileSync(join(dist, 'index.html'), 'utf8')
} catch {
  console.error('✗ dist/index.html не найден — сначала `npx vite build`')
  process.exit(1)
}

const assets = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+\.(?:js|css))"/g)].map((m) => m[1])
if (assets.length === 0) {
  console.error('✗ в index.html нет ссылок на /assets/* — структура сборки сменилась, гейт устарел')
  process.exit(1)
}

const totals = { js: 0, css: 0 }
for (const file of assets) {
  const kind = file.endsWith('.css') ? 'css' : 'js'
  let gzipped
  try {
    gzipped = gzipSync(readFileSync(join(dist, 'assets', file))).length
  } catch {
    console.log(`✗ ${file}: ссылка из index.html ведёт в никуда (файл не собран)`)
    process.exit(1)
  }
  totals[kind] += gzipped
  console.log(`  ${kind.toUpperCase()} ${file}: ${(gzipped / 1024).toFixed(1)} KB`)
}

let overBudget = false
for (const [kind, { max, label }] of Object.entries(budgets)) {
  const ok = totals[kind] <= max
  if (!ok) overBudget = true
  console.log(`${ok ? '✓' : '✗'} ${label} всего: ${(totals[kind] / 1024).toFixed(1)} KB / ${(max / 1024).toFixed(0)} KB${ok ? '' : ' — OVER BUDGET'}`)
}

if (overBudget) {
  console.log('✗ Бюджет бандла превышен — см. строки выше')
  process.exit(1)
}
console.log('✓ Бюджеты бандла в норме')

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const abs = join(dir, entry.name)
    return entry.isDirectory() ? walk(abs) : [abs]
  })

const sourcemaps = walk(dist).filter(file => file.endsWith('.map'))
if (sourcemaps.length > 0) {
  console.log(`✗ В dist/ лежат source maps (${sourcemaps.length}): исходный код восстановим один в один`)
  for (const file of sourcemaps.slice(0, 5)) console.log(`  ${file.slice(dist.length + 1)}`)
  process.exit(1)
}
console.log('✓ Source maps в прод-сборке отсутствуют')

const bannerMissing = assets
  .filter(file => file.endsWith('.js'))
  .filter(file => {
    const head = readFileSync(join(dist, 'assets', file), 'utf8').slice(0, 600)
    return !(head.includes('SwiftMatch — проприетарное (платное) ПО') && head.includes('Лицензия: LICENSE'))
  })
if (bannerMissing.length > 0) {
  console.log(`✗ Уведомление об авторских правах потеряно в ${bannerMissing.length} бандл(ах): ${bannerMissing.join(', ')}`)
  console.log('  Проверь build.rollupOptions.output.banner в vite.config.ts (LICENSE, п. 11.1)')
  process.exit(1)
}

const htmlHead = readFileSync(join(dist, 'index.html'), 'utf8').slice(0, 600)
if (!htmlHead.includes('SwiftMatch — проприетарное (платное) ПО')) {
  console.log('✗ В dist/index.html нет уведомления об авторских правах (плагин copyright-notice в vite.config.ts)')
  process.exit(1)
}
console.log('✓ Уведомление об авторских правах в бандлах и index.html на месте')
