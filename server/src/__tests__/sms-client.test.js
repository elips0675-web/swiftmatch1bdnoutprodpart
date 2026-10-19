import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

function setTwilioEnv({ sid, token, phone } = {}) {
  delete process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_AUTH_TOKEN
  delete process.env.TWILIO_PHONE_NUMBER
  if (sid !== undefined) process.env.TWILIO_ACCOUNT_SID = sid
  if (token !== undefined) process.env.TWILIO_AUTH_TOKEN = token
  if (phone !== undefined) process.env.TWILIO_PHONE_NUMBER = phone
}

async function freshSms(env) {
  setTwilioEnv(env)
  vi.resetModules()
  return import('../sms.js')
}

afterEach(() => {
  setTwilioEnv()
})

describe('sendSMS без ключей: mock-режим', () => {
  it('нет SID/токена — возвращает mock без обращения к Twilio', async () => {
    const sms = await freshSms()
    await expect(sms.sendSMS('+79990000000', 'код 1234')).resolves.toEqual({
      success: true,
      mock: true,
    })
  })

  it('isSMSConfigured в mock-режиме false', async () => {
    const sms = await freshSms()
    await expect(sms.isSMSConfigured()).resolves.toBe(false)
  })

  it('только SID без токена — всё ещё mock', async () => {
    const sms = await freshSms({ sid: 'ACxxx' })
    await expect(sms.isSMSConfigured()).resolves.toBe(false)
  })
})

describe('sendSMS с ключами: клиент Twilio', () => {
  it('успешная отправка отдаёт sid', async () => {
    const create = vi.fn(async () => ({ sid: 'SM123' }))
    const factory = vi.fn(() => ({ messages: { create } }))
    vi.doMock('twilio', () => ({ default: factory }))
    const sms = await freshSms({ sid: 'AC1', token: 'tok', phone: '+15550001111' })

    await expect(sms.sendSMS('+79990000000', 'привет')).resolves.toEqual({
      success: true,
      sid: 'SM123',
    })
    expect(factory).toHaveBeenCalledWith('AC1', 'tok')
    expect(create).toHaveBeenCalledWith({
      body: 'привет',
      from: '+15550001111',
      to: '+79990000000',
    })
  })

  it('isSMSConfigured с рабочим клиентом true', async () => {
    vi.doMock('twilio', () => ({ default: vi.fn(() => ({ messages: { create: vi.fn() } })) }))
    const sms = await freshSms({ sid: 'AC1', token: 'tok' })
    await expect(sms.isSMSConfigured()).resolves.toBe(true)
  })

  it('ошибка send отдаётся как success:false с текстом', async () => {
    vi.doMock('twilio', () => ({
      default: vi.fn(() => ({ messages: { create: vi.fn(async () => { throw new Error('bad number') }) } })),
    }))
    const sms = await freshSms({ sid: 'AC1', token: 'tok' })
    await expect(sms.sendSMS('+70000000000', 'x')).resolves.toEqual({
      success: false,
      error: 'bad number',
    })
  })

  it('падение инициализации клиента логируется и уводит в mock', async () => {
    vi.doMock('twilio', () => ({
      default: vi.fn(() => { throw new Error('init boom') }),
    }))
    const sms = await freshSms({ sid: 'AC1', token: 'tok' })
    const { rootLogger } = await import('../logger.js')

    await expect(sms.sendSMS('+79990000000', 'код')).resolves.toEqual({ success: true, mock: true })
    expect(rootLogger.warn).toHaveBeenCalledWith('SMS: Twilio client init failed:', 'init boom')
  })

  it('клиент создаётся один раз на несколько вызовов', async () => {
    const factory = vi.fn(() => ({ messages: { create: vi.fn(async () => ({ sid: 'S' })) } }))
    vi.doMock('twilio', () => ({ default: factory }))
    const sms = await freshSms({ sid: 'AC1', token: 'tok' })

    await sms.sendSMS('+1', 'a')
    await sms.sendSMS('+2', 'b')

    expect(factory).toHaveBeenCalledTimes(1)
  })
})
