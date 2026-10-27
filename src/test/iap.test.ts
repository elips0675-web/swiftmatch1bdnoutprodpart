import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rc = vi.hoisted(() => ({
  failLoad: false,
  purchases: null as Record<string, unknown> | null,
}))

vi.mock('@revenuecat/purchases-capacitor', () => ({
  get Purchases() {
    if (rc.failLoad) throw new Error('module not installed')
    return rc.purchases
  },
}))

const tokenState = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/lib/token', () => ({ getToken: () => tokenState.value }))

const nativeState = vi.hoisted(() => ({ value: false }))

const configureMock = vi.fn()
const offeringsMock = vi.fn()
const purchasePackageMock = vi.fn()

const JWT_PAYLOAD_URL = 'eyJ1c2VySWQiOjQyLCJwYWQiOiI_Pz8ifQ'
const validToken = `eyJhbGciOiJIUzI1NiJ9.${JWT_PAYLOAD_URL}.signature`

const native = (value: boolean) => {
  nativeState.value = value
  Object.defineProperty(window, 'Capacitor', {
    configurable: true,
    value: { isNativePlatform: () => value },
  })
}

const load = async () => {
  vi.resetModules()
  return import('@/lib/iap')
}

describe('productIdFor', () => {
  it('складывает тариф и длительность в идентификатор продукта', async () => {
    const { productIdFor } = await load()
    expect(productIdFor('plus', 1)).toBe('plus_1m')
    expect(productIdFor('gold', 6)).toBe('gold_6m')
    expect(productIdFor('platinum', 12)).toBe('platinum_12m')
  })

  it('неизвестный тариф считается plus, границы 6 и 12 месяцев включительные', async () => {
    const { productIdFor } = await load()
    expect(productIdFor('silver', 5)).toBe('plus_1m')
    expect(productIdFor('silver', 6)).toBe('plus_6m')
    expect(productIdFor('gold', 11)).toBe('gold_6m')
    expect(productIdFor('gold', 24)).toBe('gold_12m')
  })
})

describe('getIAPStatus', () => {
  beforeEach(() => {
    rc.failLoad = false
    rc.purchases = null
    tokenState.value = null
    configureMock.mockReset()
    offeringsMock.mockReset()
    purchasePackageMock.mockReset()
    native(false)
    vi.stubEnv('VITE_REVENUECAT_API_KEY', 'rc_pub')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete (window as unknown as Record<string, unknown>).Capacitor
  })

  it('в вебе IAP выключен с причиной not-native', async () => {
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: false, reason: 'not-native' })
  })

  it('на нативе без пакета RevenueCat — package-not-installed', async () => {
    native(true)
    rc.failLoad = true
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: false, reason: 'package-not-installed' })
  })

  it('на нативе с пакетом, но без ключа — no-api-key', async () => {
    native(true)
    vi.stubEnv('VITE_REVENUECAT_API_KEY', '')
    rc.purchases = { configure: configureMock }
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: false, reason: 'no-api-key' })
  })

  it('на нативе с пакетом и ключом — available', async () => {
    native(true)
    rc.purchases = { configure: configureMock }
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: true })
  })

  it('повторный статус берёт уже загруженный пакет из кеша', async () => {
    native(true)
    rc.purchases = { configure: configureMock }
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: true })
    rc.failLoad = true
    await expect(getIAPStatus()).resolves.toEqual({ available: true })
  })

  it('модуль загрузился без Purchases — package-not-installed', async () => {
    native(true)
    rc.purchases = null
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: false, reason: 'package-not-installed' })
  })

  it('нативный мост, падающий при опросе платформы, считается вебом', async () => {
    native(true)
    Object.defineProperty(window, 'Capacitor', {
      configurable: true,
      value: { isNativePlatform: () => { throw new Error('bridge broken') } },
    })
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: false, reason: 'not-native' })
  })

  it('упавшая загрузка пакета не кешируется навсегда: следующая попытка грузит заново', async () => {
    native(true)
    rc.purchases = { configure: configureMock }
    rc.failLoad = true
    const { getIAPStatus } = await load()
    await expect(getIAPStatus()).resolves.toEqual({ available: false, reason: 'package-not-installed' })

    rc.failLoad = false
    await expect(getIAPStatus()).resolves.toEqual({ available: true })
  })
})

describe('purchaseWithIAP', () => {
  beforeEach(() => {
    rc.failLoad = false
    rc.purchases = { configure: configureMock, getOfferings: offeringsMock, purchasePackage: purchasePackageMock }
    tokenState.value = validToken
    configureMock.mockReset()
    configureMock.mockResolvedValue(undefined)
    offeringsMock.mockReset()
    purchasePackageMock.mockReset()
    purchasePackageMock.mockResolvedValue({})
    native(true)
    vi.stubEnv('VITE_REVENUECAT_API_KEY', 'rc_pub')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete (window as unknown as Record<string, unknown>).Capacitor
  })

  it('в вебе покупка уходит в fallback без обращения к RevenueCat', async () => {
    native(false)
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({ ok: false, fallback: true })
    expect(configureMock).not.toHaveBeenCalled()
  })

  it('без пакета RevenueCat — fallback и понятная причина', async () => {
    rc.failLoad = true
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: true,
      message: 'RevenueCat package not installed',
    })
  })

  it('без ключа RevenueCat — fallback, а не «не авторизован»', async () => {
    vi.stubEnv('VITE_REVENUECAT_API_KEY', '')
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: true,
      message: 'VITE_REVENUECAT_API_KEY not set',
    })
    expect(configureMock).not.toHaveBeenCalled()
  })

  it('без токена — Not authenticated и без fallback (в веб-оплату не уходим)', async () => {
    tokenState.value = null
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Not authenticated',
    })
  })

  it('битый токен — Not authenticated, а не падение', async () => {
    tokenState.value = 'not-a-jwt'
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Not authenticated',
    })
  })

  it('нечитаемый payload (не base64) — Not authenticated', async () => {
    tokenState.value = 'header.@@@.signature'
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Not authenticated',
    })
  })

  it('токен без payload — Not authenticated', async () => {
    tokenState.value = 'header..signature'
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Not authenticated',
    })
  })

  it('payload без числового userId — Not authenticated', async () => {
    tokenState.value = `h.${btoa(JSON.stringify({ userId: '42' }))}.s`
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Not authenticated',
    })
  })

  it('base64url в токене декодируется: userId уходит в appUserID', async () => {
    const { purchaseWithIAP } = await load()
    offeringsMock.mockResolvedValue({ current: { availablePackages: [{ identifier: 'gold_1m' }] } })
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({ ok: true, fallback: false })

    expect(configureMock).toHaveBeenCalledWith({ apiKey: 'rc_pub', appUserID: '42' })
    expect(purchasePackageMock).toHaveBeenCalledWith({ identifier: 'gold_1m' })
  })

  it('без текущего офферинга — No offerings configured', async () => {
    offeringsMock.mockResolvedValue({ current: null })
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('plus', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'No offerings configured in RevenueCat',
    })
    expect(purchasePackageMock).not.toHaveBeenCalled()
  })

  it('офферинг без пакетов — No offerings configured', async () => {
    offeringsMock.mockResolvedValue({ current: { availablePackages: [] } })
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('plus', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'No offerings configured in RevenueCat',
    })
  })

  it('нужного продукта нет в офферинге — имя продукта в сообщении', async () => {
    offeringsMock.mockResolvedValue({ current: { availablePackages: [{ identifier: 'gold_12m' }] } })
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('plus', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Product plus_1m not found',
    })
    expect(purchasePackageMock).not.toHaveBeenCalled()
  })

  it('отмена покупки по коду 1 — не fallback и не «IAP failed»', async () => {
    offeringsMock.mockResolvedValue({ current: { availablePackages: [{ identifier: 'gold_1m' }] } })
    purchasePackageMock.mockRejectedValue({ userInfo: { code: '1' } })
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Purchase cancelled',
    })
  })

  it('отмена покупки по коду USER_CANCELLED', async () => {
    offeringsMock.mockResolvedValue({ current: { availablePackages: [{ identifier: 'gold_1m' }] } })
    purchasePackageMock.mockRejectedValue({ code: 'USER_CANCELLED' })
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: false,
      message: 'Purchase cancelled',
    })
  })

  it('прочий сбой с сообщением — fallback в веб-оплату', async () => {
    offeringsMock.mockResolvedValue({ current: { availablePackages: [{ identifier: 'gold_1m' }] } })
    purchasePackageMock.mockRejectedValue({ message: 'store offline' })
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: true,
      message: 'store offline',
    })
  })

  it('сбой без сообщения — «IAP failed»', async () => {
    offeringsMock.mockResolvedValue({ current: { availablePackages: [{ identifier: 'gold_1m' }] } })
    purchasePackageMock.mockRejectedValue({})
    const { purchaseWithIAP } = await load()
    await expect(purchaseWithIAP('gold', 1)).resolves.toEqual({
      ok: false,
      fallback: true,
      message: 'IAP failed',
    })
  })
})
