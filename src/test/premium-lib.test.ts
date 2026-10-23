import { describe, it, expect, vi } from 'vitest'

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ t: (key: string) => key, language: 'RU' }),
}))

import {
  FALLBACK_PREMIUM_TIERS,
  PREMIUM_DURATIONS,
  checkoutErrorMessage,
  checkoutRedirectUrl,
  durationDiscount,
  formatPrice,
  isPremiumTierList,
  monthlyPriceFor,
  readJsonBody,
  totalPriceFor,
} from '@/lib/premium'

describe('src/lib/premium', () => {
  it('formatPrice разделяет разряды и добавляет рубль', () => {
    expect(formatPrice(1499, 'RU')).toContain('₽')
    expect(formatPrice(1499, 'EN')).toBe('1,499 ₽')
    expect(formatPrice(1499)).toBe(formatPrice(1499, 'RU'))
  })

  it('durationDiscount знает скидки 1/6/12 месяцев и прочие сроки', () => {
    expect(durationDiscount(1)).toBe(0)
    expect(durationDiscount(6)).toBe(20)
    expect(durationDiscount(12)).toBe(40)
    expect(durationDiscount(3)).toBe(0)
  })

  it('totalPriceFor и monthlyPriceFor считают со скидкой и округлением', () => {
    const gold = { id: 'gold', name: 'Gold', price: 699, duration_months: 1, features: [] }
    expect(totalPriceFor(gold, 1)).toBe(699)
    expect(totalPriceFor(gold, 6)).toBe(Math.round(699 * 6 * 0.8))
    expect(totalPriceFor(gold, 12)).toBe(Math.round(699 * 12 * 0.6))
    expect(monthlyPriceFor(gold, 6)).toBe(Math.round(totalPriceFor(gold, 6) / 6))
    expect(monthlyPriceFor(gold, 1)).toBe(699)
    expect(monthlyPriceFor(gold, 0)).toBe(0)
  })

  it('isPremiumTierList отбраковывает всё, кроме непустого массива тарифов', () => {
    expect(isPremiumTierList([])).toBe(false)
    expect(isPremiumTierList({})).toBe(false)
    expect(isPremiumTierList(null)).toBe(false)
    expect(isPremiumTierList([{ id: 'x', name: 'X', price: 1 }])).toBe(true)
    expect(isPremiumTierList([{ id: 1, name: 'X', price: 1 }])).toBe(false)
    expect(isPremiumTierList([{ id: '', name: 'X', price: 1 }])).toBe(false)
    expect(isPremiumTierList([null])).toBe(false)
    expect(isPremiumTierList(['plus'])).toBe(false)
    expect(isPremiumTierList([{ id: 'x', name: 'X', price: '1' }])).toBe(false)
  })

  it('readJsonBody гасит ошибку разбора и возвращает null', async () => {
    const res = { json: async () => { throw new Error('bad') } } as unknown as Response
    await expect(readJsonBody(res)).resolves.toBe(null)
  })

  it('readJsonBody возвращает разобранное тело', async () => {
    const body = { url: 'http://x' }
    const res = { json: async () => body } as unknown as Response
    await expect(readJsonBody(res)).resolves.toEqual(body)
  })

  it('checkoutRedirectUrl отдаёт только непустой строковый url', () => {
    expect(checkoutRedirectUrl({ url: 'https://checkout' })).toBe('https://checkout')
    expect(checkoutRedirectUrl({})).toBe(null)
    expect(checkoutRedirectUrl(null)).toBe(null)
    expect(checkoutRedirectUrl({ url: 123 })).toBe(null)
    expect(checkoutRedirectUrl({ url: '' })).toBe(null)
  })

  it('checkoutErrorMessage переводит код отказа, иначе даёт общий ключ', () => {
    const t = (k: string) => k
    expect(checkoutErrorMessage({ code: 'STRIPE_NOT_CONFIGURED' }, t)).toBe('premium.stripe_unavailable')
    expect(checkoutErrorMessage({}, t)).toBe('premium.error')
    expect(checkoutErrorMessage({ code: 'OTHER' }, t)).toBe('premium.error')
    expect(checkoutErrorMessage(null, t)).toBe('premium.error')
  })

  it('встроенные тарифы и сроки совпадают с серверными по числу', () => {
    expect(FALLBACK_PREMIUM_TIERS).toHaveLength(3)
    expect(FALLBACK_PREMIUM_TIERS.map((tier) => tier.id)).toEqual(['plus', 'gold', 'platinum'])
    expect(PREMIUM_DURATIONS.map((duration) => duration.months)).toEqual([1, 6, 12])
  })
})
