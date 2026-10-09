/**
 * Тесты гейта `scripts/prod-mock-audit.mjs` (N9-tail).
 *
 * Гейт ищет в `server/src/routes/*.js` платные стоки (`mock: true`, `'paid'`,
 * `INSERT INTO … subscriptions`, `commission_rate = 15`) и требует
 * `refuseMockPayment(res)` в том же хендлере. Фикстуры — temp-каталог с
 * мини-репо. Отдельно проверяется настоящий репозиторий: гейт, красный на
 * текущем коде, бесполезен, а зелёный по построению — тем более.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { audit, classifyHandler, parseHandlers, SINKS } from './prod-mock-audit.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

let dir = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-mock-gate-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  dir = null
})

function fixture(files = {}) {
  const routesDir = path.join(dir, 'server', 'src', 'routes')
  fs.mkdirSync(routesDir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    fs.writeFileSync(path.join(routesDir, name), text)
  }
  return dir
}

const GUARDED_PURCHASE = `router.post('/api/hangouts/:id/purchase', async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    if (refuseMockPayment(res)) return
    await pool.query("INSERT INTO hangout_tickets (hangout_id, amount, status) VALUES (?, ?, 'paid')", [1, 100])
    return res.status(201).json({ mock: true, paid: true })
  }
  res.json({ url: 'https://stripe' })
})
`

describe('parseHandlers', () => {
  it('режет файл на тела роутов и сохраняет метод, путь и строку', () => {
    const src = `// header
router.get('/api/a', (req, res) => { res.json({}) })

router.post('/api/b/:id', (req, res) => {
  res.json({})
})
`
    const handlers = parseHandlers(src)
    expect(handlers.map((h) => [h.method, h.routePath, h.line])).toEqual([
      ['get', '/api/a', 2],
      ['post', '/api/b/:id', 4],
    ])
    expect(handlers[0].text).toContain('res.json({})')
    expect(handlers[0].text).not.toContain('/api/b')
  })
})

describe('classifyHandler', () => {
  it('находит стоки, Stripe-досягаемость и охранника', () => {
    const [h] = parseHandlers(GUARDED_PURCHASE)
    const info = classifyHandler(h)
    expect(info.sinks).toEqual(['mock-response', 'paid-write'])
    expect(info.stripeReachable).toBe(true)
    expect(info.webhook).toBe(false)
    expect(info.guarded).toBe(true)
    expect(info.isPayment).toBe(true)
  })

  it('вебхук с received:true и подпиской распознаётся как вебхук', () => {
    const [h] = parseHandlers(`router.post('/api/premium/webhook', async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return res.status(200).json({ received: true })
  await pool.query('INSERT INTO subscriptions (user_id) VALUES (?)', [1])
  res.json({ received: true })
})
`)
    const info = classifyHandler(h)
    expect(info.webhook).toBe(true)
    expect(info.sinks).toEqual(['subscription-grant'])
  })

  it('INSERT INTO subscriptions без Stripe — не платёжный хендлер (RevenueCat)', () => {
    const [h] = parseHandlers(`router.post('/api/iap/webhook', async (req, res) => {
  await pool.query('INSERT INTO subscriptions (user_id, provider) VALUES (?, ?)', [1, 'apple'])
  res.json({ received: true })
})
`)
    const info = classifyHandler(h)
    expect(info.sinks).toEqual(['subscription-grant'])
    expect(info.stripeReachable).toBe(false)
    expect(info.isPayment).toBe(false)
  })
})

describe('audit', () => {
  it('зелёный, когда охранник на месте', () => {
    const { problems, facts } = audit(fixture({ 'hangouts.js': GUARDED_PURCHASE }))
    expect(problems).toEqual([])
    expect(facts.handlers).toBe(1)
    expect(facts.paymentHandlers).toBe(1)
    expect(facts.guardedHandlers).toBe(1)
  })

  it('красный с текстом находки, когда охранник пропал', () => {
    const broken = GUARDED_PURCHASE.replace('if (refuseMockPayment(res)) return', 'if (false) return')
    const { problems, facts } = audit(fixture({ 'hangouts.js': broken }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('hangouts.js:1')
    expect(problems[0]).toContain('[mock-response, paid-write]')
    expect(problems[0]).toContain('POST /api/hangouts/:id/purchase')
    expect(problems[0]).toContain('нет refuseMockPayment(res)')
    expect(facts.paymentHandlers).toBe(1)
    expect(facts.guardedHandlers).toBe(0)
  })

  it('вебхук не попадает в находки, даже с платным стоком и без охранника', () => {
    const { problems, facts } = audit(fixture({
      'premium.js': `router.post('/api/premium/webhook', async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return res.status(200).json({ received: true })
  await pool.query("UPDATE subscriptions SET status = 'paid' WHERE id = ?", [1])
  res.json({ received: true })
})
`,
    }))
    expect(problems).toEqual([])
    expect(facts.webhookHandlers).toBe(1)
    expect(facts.paymentHandlers).toBe(0)
  })

  it('подъём комиссии commission_rate = 15 — платный сток', () => {
    const { problems } = audit(fixture({
      'partner-dashboard.js': `router.post('/api/partner/subscribe', async (req, res) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (stripeKey) return res.json({ url: 'https://stripe' })
  await pool.query('UPDATE partners SET commission_rate = 15 WHERE id = ?', [1])
  res.json({ mock: true })
})
`,
    }))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('[mock-response, commission-bump]')
  })

  it('SINKS покрывает все четыре класса стоков из бэклога', () => {
    expect(SINKS.map((s) => s.id)).toEqual([
      'mock-response',
      'paid-write',
      'subscription-grant',
      'commission-bump',
    ])
  })
})

describe('audit на настоящем репозитории', () => {
  it('все платные хендлеры закрыты, вебхуки исключены', () => {
    const { problems, facts } = audit(REPO_ROOT)
    expect(problems).toEqual([])
    expect(facts.paymentHandlers).toBeGreaterThanOrEqual(5)
    expect(facts.guardedHandlers).toBe(facts.paymentHandlers)
    expect(facts.webhookHandlers).toBeGreaterThanOrEqual(5)
  })
})
