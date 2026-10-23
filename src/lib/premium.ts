export interface PremiumTier {
  id: string
  name: string
  price: number
  duration_months: number
  features: string[]
}

export interface PremiumDuration {
  months: number
  discount: number
}

export const PREMIUM_DURATIONS: PremiumDuration[] = [
  { months: 1, discount: 0 },
  { months: 6, discount: 20 },
  { months: 12, discount: 40 },
]

export const FALLBACK_PREMIUM_TIERS: PremiumTier[] = [
  { id: 'plus', name: 'Plus', price: 299, duration_months: 1, features: ['5 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня'] },
  { id: 'gold', name: 'Gold', price: 699, duration_months: 1, features: ['10 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки'] },
  { id: 'platinum', name: 'Platinum', price: 1499, duration_months: 1, features: ['∞ суперлайков', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки', 'Персональный консьерж'] },
]

export function formatPrice(price: number, language: string = 'ru-RU'): string {
  return price.toLocaleString(language === 'EN' ? 'en-US' : 'ru-RU') + ' ₽'
}

export function durationDiscount(months: number): number {
  return PREMIUM_DURATIONS.find((duration) => duration.months === months)?.discount ?? 0
}

export function totalPriceFor(tier: PremiumTier, months: number): number {
  return Math.round(tier.price * months * (1 - durationDiscount(months) / 100))
}

export function monthlyPriceFor(tier: PremiumTier, months: number): number {
  if (months <= 0) return 0
  return Math.round((tier.price * months * (1 - durationDiscount(months) / 100)) / months)
}

export function isPremiumTierList(value: unknown): value is PremiumTier[] {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((item) => {
    if (typeof item !== 'object' || item === null) return false
    const tier = item as Record<string, unknown>
    return typeof tier.id === 'string' && tier.id.length > 0
      && typeof tier.name === 'string'
      && typeof tier.price === 'number'
  })
}

export async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

export function checkoutRedirectUrl(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const url = (body as { url?: unknown }).url
  return typeof url === 'string' && url.length > 0 ? url : null
}

export function checkoutErrorMessage(body: unknown, t: (key: string) => string): string {
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined
  return code === 'STRIPE_NOT_CONFIGURED' ? t('premium.stripe_unavailable') : t('premium.error')
}
