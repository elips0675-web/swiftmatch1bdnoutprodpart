/**
 * Гейт «mock-платежи не утекают в прод» (N9-tail, после этапа 39).
 *
 * Класс дыр, который он закрывает, — «пять сегодняшних точек закрыты, шестая
 * появится завтра». `refuseMockPayment(res)` уже стоит в пяти местах монетизации
 * (events, hangouts, partner-dashboard, partners, premium), но это свойство
 * кода, а не гейта: новая mock-ветка, добавленная в следующем PR, останется
 * незамеченной и в проде отдаст бесплатный премиум. Этап 39 локал это
 * тестами, но тесты не мешают написать новую ветку.
 *
 * Гейт читает `server/src/routes/*.js` и в каждом хендлере ищет «платный
 * сток» — место, которое при отсутствии `STRIPE_SECRET_KEY` выдаёт товар
 * бесплатно:
 *
 *   * mock-ответ: `mock: true` (и соседние `paid: true`);
 *   * платная запись: литерал `'paid'` в INSERT/UPDATE;
 *   * выдача подписки: `INSERT INTO … subscriptions` (в т.ч. partner_);
 *   * подъём комиссии: `commission_rate = 15`.
 *
 * Такой хендлер обязан вызывать `refuseMockPayment(res)` — fail-closed:
 * в проде и в live-режиме ответ 503 `STRIPE_NOT_CONFIGURED` вместо mock.
 *
 * Три осознанных ограничения (иначе гейт красный по построению):
 *
 *  1. **Вебхуки не считаются.** `POST …/webhook` при `!stripeKey` отвечает
 *     `200 {received: true}` — это контракт Stripe (доставка не должна
 *     ретраиться), а не выдача товара; платит уже оплаченный `checkout`-флоу.
 *  2. **Не-Stripe выдача подписки не считается.** `iap.js` пишет в
 *     `subscriptions` из вебхука RevenueCat — Stripe там нет вовсе, требовать
 *     `refuseMockPayment` бессмысленно. Хендлер попадает под гейт, только если
 *     он вообще смотрит на `STRIPE_SECRET_KEY` (или его локальный `stripeKey`).
 *  3. **`runtime.js` не сканируется.** Сток-паттерны ищутся только в
 *     `server/src/routes/`, а сам `refuseMockPayment` определён в
 *     `runtime.js` — ложной находки на «строке отказа» быть не может.
 *
 * Гейт зелёный локально и в CI без MySQL и без серверных зависимостей: он
 * только читает исходники.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROUTES_DIR = 'server/src/routes'

const HANDLER_RE = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g

const STRIPE_REACHABLE_RE = /STRIPE_SECRET_KEY|stripeKey/
const WEBHOOK_MARKER_RE = /received:\s*true/
const GUARD_RE = /refuseMockPayment\s*\(/

/** Платные стоки: что именно выдаёт товар/подписку в обход оплаты. */
export const SINKS = [
  { id: 'mock-response', re: /mock:\s*true/ },
  { id: 'paid-write', re: /'paid'/ },
  { id: 'subscription-grant', re: /INSERT\s+INTO\s+(?:partner_)?subscriptions\b/i },
  { id: 'commission-bump', re: /commission_rate\s*=\s*15\b/ },
]

function listRouteFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listRouteFiles(full, acc)
    else if (entry.name.endsWith('.js')) acc.push(full)
  }
  return acc
}

/**
 * Режет файл на тела хендлеров: от `router.<method>('/путь',` до следующего
 * такого объявления (или конца файла). Роуты объявлены последовательно, а
 * сток и охранник живут в одном и том же колбэке, поэтому «до следующего
 * роута» и есть граница хендлера.
 */
export function parseHandlers(source) {
  const matches = [...source.matchAll(HANDLER_RE)]
  return matches.map((m, i) => {
    const start = m.index
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length
    return {
      method: m[1],
      routePath: m[2],
      line: source.slice(0, start).split('\n').length,
      text: source.slice(start, end),
    }
  })
}

/** Разбор одного тела хендлера: стоки, Stripe-досягаемость, вебхук, охранник. */
export function classifyHandler(handler) {
  const sinks = SINKS.filter((s) => s.re.test(handler.text)).map((s) => s.id)
  return {
    sinks,
    stripeReachable: STRIPE_REACHABLE_RE.test(handler.text),
    webhook: WEBHOOK_MARKER_RE.test(handler.text),
    guarded: GUARD_RE.test(handler.text),
    isPayment: sinks.length > 0 && (STRIPE_REACHABLE_RE.test(handler.text) || sinks.includes('mock-response')),
  }
}

export function audit(root) {
  const routeFiles = listRouteFiles(path.join(root, ROUTES_DIR)).map((f) => f.replace(/\\/g, '/'))
  const problems = []
  const facts = {
    routeFiles: routeFiles.length,
    handlers: 0,
    paymentHandlers: 0,
    guardedHandlers: 0,
    webhookHandlers: 0,
  }

  for (const file of routeFiles) {
    const rel = path.relative(root, file).replace(/\\/g, '/')
    const source = fs.readFileSync(file, 'utf8')
    for (const handler of parseHandlers(source)) {
      facts.handlers++
      const info = classifyHandler(handler)
      if (!info.isPayment) continue
      if (info.webhook) {
        facts.webhookHandlers++
        continue
      }
      facts.paymentHandlers++
      if (info.guarded) {
        facts.guardedHandlers++
        continue
      }
      problems.push(
        `${rel}:${handler.line} [${info.sinks.join(', ')}] ${handler.method.toUpperCase()} ${handler.routePath} — mock/платная запись достижимы без STRIPE_SECRET_KEY, но в хендлере нет refuseMockPayment(res)`,
      )
    }
  }

  return { facts, problems }
}

function main() {
  const root = process.argv[2] || process.cwd()
  const { facts, problems } = audit(root)

  console.log(`файлов роутов: ${facts.routeFiles}, хендлеров: ${facts.handlers}`)
  console.log(`платных хендлеров (сток + Stripe): ${facts.paymentHandlers}, из них с refuseMockPayment: ${facts.guardedHandlers}`)
  console.log(`вебхуков с платным стоком (осознанный контракт, вне проверки): ${facts.webhookHandlers}`)

  if (problems.length) {
    console.log('')
    for (const p of problems) console.log(`FAIL: ${p}`)
    console.log('\nИтог: mock-платёж достижим без Stripe-ключа и без fail-closed отказа.')
    process.exit(1)
  }
  console.log('\nИтог: каждый mock/платный хендлер закрыт refuseMockPayment(res); вебхуки — контракт, вне проверки.')
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main()
