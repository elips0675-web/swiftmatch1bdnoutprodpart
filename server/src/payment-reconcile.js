import pool from './db.js'
import { createLogger } from './logger.js'
import { applyPremiumCheckout } from './routes/premium.js'

const log = createLogger('payment-reconcile')

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_INTERVAL_MS = HOUR_MS
const DEFAULT_LOOKBACK_HOURS = 72
const MAX_PAGES = 10
const PAGE_SIZE = 100

function lookbackHours() {
  const raw = Number(process.env.STRIPE_RECONCILE_LOOKBACK_HOURS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOOKBACK_HOURS
}

export function stripeReconcileEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export async function fetchRecentPaidSessions({ stripe, sinceSeconds, pageSize = PAGE_SIZE, maxPages = MAX_PAGES }) {
  const sessions = []
  let startingAfter = null
  for (let page = 0; page < maxPages; page += 1) {
    const params = { limit: pageSize, created: { gte: sinceSeconds } }
    if (startingAfter) params.starting_after = startingAfter
    const batch = await stripe.checkout.sessions.list(params)
    const data = batch?.data ?? []
    sessions.push(...data)
    if (!batch?.has_more || data.length === 0) break
    startingAfter = data[data.length - 1].id
  }
  return sessions
}

function isPaidSession(session) {
  const metadata = session?.metadata || {}
  return (
    session?.status === 'complete' &&
    session?.payment_status === 'paid' &&
    Boolean(metadata.userId) &&
    Boolean(metadata.tier)
  )
}

async function applySession(db, session) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const inserted = await applyPremiumCheckout({ data: { object: session } }, conn)
    await conn.commit()
    return inserted
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

export async function reconcilePremiumSubscriptions(options = {}) {
  const { db = pool, now = Date.now() } = options
  let stripe = options.stripe
  if (!stripe) {
    if (!stripeReconcileEnabled()) return { skipped: true, checked: 0, applied: 0 }
    const { default: Stripe } = await import('stripe')
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  }
  const hours = options.lookbackHours ?? lookbackHours()
  const sinceSeconds = Math.floor((now - hours * HOUR_MS) / 1000)
  let sessions
  try {
    sessions = await fetchRecentPaidSessions({ stripe, sinceSeconds })
  } catch (err) {
    log.error(`Reconcile list failed: ${err?.message ?? err}`)
    return { skipped: false, checked: 0, applied: 0, error: err?.message ?? String(err) }
  }
  let applied = 0
  for (const session of sessions) {
    if (!isPaidSession(session)) continue
    try {
      if (await applySession(db, session)) applied += 1
    } catch (err) {
      log.error(`Reconcile failed for session ${session.id}: ${err?.message ?? err}`)
    }
  }
  if (applied > 0) log.info(`Reconciled ${applied} missed payment(s) for the last ${hours}h`)
  return { skipped: false, checked: sessions.length, applied }
}

let reconcileTimer = null

function runReconcile(options) {
  reconcilePremiumSubscriptions(options).catch((err) =>
    log.error(`Reconcile run failed: ${err?.message ?? err}`),
  )
}

export function startPaymentReconcile({ intervalMs = DEFAULT_INTERVAL_MS, ...options } = {}) {
  if (reconcileTimer) return reconcileTimer
  runReconcile(options)
  reconcileTimer = setInterval(() => runReconcile(options), intervalMs)
  reconcileTimer.unref?.()
  return reconcileTimer
}

export function stopPaymentReconcile() {
  if (!reconcileTimer) return
  clearInterval(reconcileTimer)
  reconcileTimer = null
}
