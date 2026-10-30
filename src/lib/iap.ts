import { getToken } from '@/lib/token'

// RevenueCat IAP scaffold (Capacitor / Android + App Store).
// Web builds use the Stripe/mock flow via /api/premium/create-checkout.
// Requirements before APK build:
//   1. npm install @revenuecat/purchases-capacitor (installed, etap 36)
//   2. VITE_REVENUECAT_API_KEY in .env (RevenueCat dashboard → SDK Keys → Google Play / App Store)
//   3. Server: REVENUECAT_WEBHOOK_SECRET (subscriptions are created by the server webhook, iap.js)
// Without the package or the key this module is a graceful no-op (fallback = true).

type PurchasesPackage = { identifier: string }

type PurchasesModule = {
  configure: (options: { apiKey: string; appUserID: string }) => Promise<void>
  getOfferings: () => Promise<{ current?: { availablePackages?: PurchasesPackage[] } }>
  purchasePackage: (pkg: PurchasesPackage) => Promise<unknown>
}

type NativeWindow = Window & { Capacitor?: { isNativePlatform?: () => boolean } }

type PurchaseError = { userInfo?: { code?: string }; code?: string; message?: string }

let Purchases: PurchasesModule | null = null
let purchasesLoaded = false

function isNative(): boolean {
  try {
    return typeof window !== 'undefined' && (window as NativeWindow).Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}

async function loadPurchases(): Promise<boolean> {
  if (purchasesLoaded) return !!Purchases
  try {
    const mod = await import('@revenuecat/purchases-capacitor')
    Purchases = (mod?.Purchases as unknown as PurchasesModule) || null
  } catch {
    Purchases = null
  }
  purchasesLoaded = !!Purchases
  return purchasesLoaded
}

function decodeUserIdFromToken(): number | null {
  const token = getToken()
  if (!token) return null
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')))
    return typeof payload.userId === 'number' ? payload.userId : null
  } catch {
    return null
  }
}

export async function getIAPStatus(): Promise<{ available: boolean; reason?: string }> {
  if (!isNative()) return { available: false, reason: 'not-native' }
  if (!(await loadPurchases())) return { available: false, reason: 'package-not-installed' }
  if (!import.meta.env.VITE_REVENUECAT_API_KEY) return { available: false, reason: 'no-api-key' }
  return { available: true }
}

// Purchases IAP product ids must match RevenueCat products (e.g. plus_1m, plus_12m, gold_1m, ...)
export function productIdFor(tier: string, durationMonths: number): string {
  const t = tier === 'platinum' ? 'platinum' : tier === 'gold' ? 'gold' : 'plus'
  const d = durationMonths >= 12 ? '12m' : durationMonths >= 6 ? '6m' : '1m'
  return `${t}_${d}`
}

export async function purchaseWithIAP(
  tier: string,
  durationMonths: number,
): Promise<{ ok: boolean; fallback: boolean; message?: string }> {
  if (!isNative()) return { ok: false, fallback: true }
  if (!(await loadPurchases())) return { ok: false, fallback: true, message: 'RevenueCat package not installed' }

  const apiKey = import.meta.env.VITE_REVENUECAT_API_KEY
  if (!apiKey) return { ok: false, fallback: true, message: 'VITE_REVENUECAT_API_KEY not set' }

  const userId = decodeUserIdFromToken()
  if (!userId) return { ok: false, fallback: false, message: 'Not authenticated' }

  const purchases = Purchases
  if (!purchases) return { ok: false, fallback: true, message: 'RevenueCat package not installed' }

  try {
    await purchases.configure({ apiKey, appUserID: String(userId) })
    const offerings = await purchases.getOfferings()
    const offering = offerings?.current
    if (!offering?.availablePackages?.length) {
      return { ok: false, fallback: false, message: 'No offerings configured in RevenueCat' }
    }

    const pkg = offering.availablePackages.find(
      (p: PurchasesPackage) => p.identifier === productIdFor(tier, durationMonths),
    )
    if (!pkg) {
      return { ok: false, fallback: false, message: `Product ${productIdFor(tier, durationMonths)} not found` }
    }

    await purchases.purchasePackage(pkg)
    // Server receives the RevenueCat webhook (iap.js) and creates the subscription.
    // The webhook must be configured in RevenueCat dashboard → App → Webhooks.
    return { ok: true, fallback: false }
  } catch (err) {
    const info = err as PurchaseError
    const code = info?.userInfo?.code || info?.code || ''
    if (code === '1' || code === 'USER_CANCELLED') {
      return { ok: false, fallback: false, message: 'Purchase cancelled' }
    }
    return { ok: false, fallback: true, message: info?.message || 'IAP failed' }
  }
}
