vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-metrics-mode-secret-0123456789abcdef'
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import register, { integrationModeGauge } from '../metrics.js'
import { integrationModes, nonLiveIntegrations } from '../runtime.js'

const KEYS = [
  'STRIPE_SECRET_KEY', 'SMTP_HOST', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'FCM_SERVER_KEY', 'FCM_SERVICE_ACCOUNT', 'REDIS_URL', 'OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID', 'ALLOW_UNMODERATED_PHOTOS',
]
const saved = {}
let originalNodeEnv

beforeEach(() => {
  originalNodeEnv = process.env.NODE_ENV
  for (const key of KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function labelsOf(values, service) {
  return values.find((entry) => entry.labels.service === service)?.labels
}

describe('метрика integration_mode', () => {
  it('в проде без ключей каждый сервис помечен не-live, а env-метка = production', async () => {
    process.env.NODE_ENV = 'production'
    const metric = await integrationModeGauge.get()

    expect(labelsOf(metric.values, 'stripe')).toEqual({ service: 'stripe', mode: 'mock', env: 'production' })
    expect(labelsOf(metric.values, 'smtp')).toEqual({ service: 'smtp', mode: 'mock', env: 'production' })
    expect(labelsOf(metric.values, 'moderation')).toEqual({ service: 'moderation', mode: 'unavailable', env: 'production' })
    expect(metric.values).toHaveLength(6)
  })

  it('с ключами сервисы становятся live', async () => {
    process.env.NODE_ENV = 'production'
    process.env.STRIPE_SECRET_KEY = 'sk_live_x'
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.TWILIO_ACCOUNT_SID = 'AC1'
    process.env.TWILIO_AUTH_TOKEN = 'token'
    process.env.FCM_SERVER_KEY = 'key'
    process.env.REDIS_URL = 'redis://localhost:6379'
    process.env.OPENAI_API_KEY = 'sk-x'
    const metric = await integrationModeGauge.get()

    for (const entry of metric.values) expect(entry.labels.mode).toBe('live')
    expect(metric.values).toHaveLength(6)
  })

  it('смена env между скрейпами не оставляет устаревших серий', async () => {
    process.env.NODE_ENV = 'production'
    await integrationModeGauge.get()
    process.env.NODE_ENV = 'development'
    const metric = await integrationModeGauge.get()

    expect(metric.values).toHaveLength(6)
    for (const entry of metric.values) expect(entry.labels.env).toBe('development')
  })

  it('метрика зарегистрирована под именем integration_mode', () => {
    expect(register.getSingleMetric('integration_mode')).toBe(integrationModeGauge)
  })

  it('текст скрейпа содержит строки алерта', async () => {
    process.env.NODE_ENV = 'production'
    const text = await register.metrics()

    expect(text).toContain('integration_mode{service="stripe",mode="mock",env="production"} 1')
    expect(text).toContain('integration_mode{service="moderation",mode="unavailable",env="production"} 1')
  })
})

describe('nonLiveIntegrations', () => {
  it('возвращает только не-live сервисы в формате service=mode', () => {
    expect(nonLiveIntegrations({ stripe: 'live', smtp: 'mock', moderation: 'unavailable' }))
      .toEqual(['smtp=mock', 'moderation=unavailable'])
  })

  it('все live — пусто', () => {
    expect(nonLiveIntegrations({ stripe: 'live', smtp: 'live' })).toEqual([])
  })

  it('по умолчанию читает текущее окружение', () => {
    process.env.NODE_ENV = 'production'
    const modes = integrationModes()
    expect(nonLiveIntegrations()).toEqual(nonLiveIntegrations(modes))
  })
})
