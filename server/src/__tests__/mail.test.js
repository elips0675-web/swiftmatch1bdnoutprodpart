import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rootLogger } from '../logger.js'
import processEmail from '../jobs/email.job.js'

vi.mock('../logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  rootLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const sendMail = vi.fn()
const createTransport = vi.fn(() => ({ sendMail }))

vi.mock('nodemailer', () => ({
  default: { createTransport: (...args) => createTransport(...args) },
}))

vi.mock('../queue.js', () => ({ emailQueue: null }))

const QUEUED = { add: vi.fn() }
let queueModule

beforeEach(async () => {
  vi.clearAllMocks()
  delete process.env.SMTP_HOST
  delete process.env.SMTP_USER
  delete process.env.SMTP_PASS
  delete process.env.CORS_ORIGIN
  delete process.env.SMTP_SECURE
  delete process.env.SMTP_PORT
  queueModule = await import('../queue.js')
})

afterEach(() => {
  vi.resetModules()
})

function loadMail() {
  return import('../mail.js')
}

describe('mail.js: деградация без очереди (P1 #16)', () => {
  it('БЕЗ Redis письмо реально отправляется напрямую, а не только логируется', async () => {
    queueModule.emailQueue = null
    sendMail.mockResolvedValue({ messageId: 'x' })
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'

    const mail = await loadMail()
    const result = await mail.sendVerificationEmail('user@test.local', 'tok-123')

    expect(sendMail).toHaveBeenCalledTimes(1)
    expect(sendMail.mock.calls[0][0].to).toBe('user@test.local')
    expect(result).toEqual({ sent: true })
  })

  it('БЕЗ Redis сгенерированная verify-ссылка указывает на порт фронта 8081, не на мёртвый 8080', async () => {
    queueModule.emailQueue = null
    sendMail.mockResolvedValue({ messageId: 'x' })
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'

    const mail = await loadMail()
    await mail.sendVerificationEmail('user@test.local', 'tok-123')

    expect(sendMail.mock.calls[0][0].html).toContain('http://localhost:8081/verify-email?token=tok-123')
  })

  it('падение SMTP в fallback НЕ приводит к reject (вызовы в auth.js — fire-and-forget)', async () => {
    queueModule.emailQueue = null
    sendMail.mockRejectedValue(new Error('SMTP down'))
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'

    const mail = await loadMail()
    await expect(mail.sendPasswordResetEmail('user@test.local', 'tok')).resolves.toEqual({
      failed: true,
      error: 'SMTP down',
    })
    expect(sendMail).toHaveBeenCalledTimes(3)
  })

  it('падение самой отправки (исключение вне nodemailer) тоже не пробрасывается', async () => {
    queueModule.emailQueue = null
    createTransport.mockImplementationOnce(() => { throw new Error('transporter exploded') })
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'

    const mail = await loadMail()
    await expect(mail.sendCustomEmail('u@x.local', 's', '<b>h</b>')).resolves.toMatchObject({
      failed: true,
    })
  })

  it('БЕЗ SMTP fallback не шлёт, но и не падает', async () => {
    queueModule.emailQueue = null

    const mail = await loadMail()
    await expect(mail.sendCustomEmail('u@x.local', 's', '<b>h</b>')).resolves.toEqual({ skipped: true })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('предупреждение о fallback логируется один раз, а не на каждое письмо', async () => {
    queueModule.emailQueue = null

    const mail = await loadMail()
    await mail.sendCustomEmail('u@x.local', 'a', 'h')
    await mail.sendCustomEmail('u@x.local', 'b', 'h')
    await mail.sendCustomEmail('u@x.local', 'c', 'h')

    const warns = rootLogger.warn.mock.calls.filter((c) => String(c[0]).includes('sending directly via SMTP'))
    expect(warns).toHaveLength(1)
  })
})

describe('mail.js: с очередью Redis', () => {
  it('письмо уходит в очередь и НЕ отправляется напрямую', async () => {
    const { emailQueue } = await import('../queue.js')
    queueModule.emailQueue = emailQueue === null ? QUEUED : emailQueue
    QUEUED.add.mockResolvedValue({ id: 'job-1' })
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'

    const mail = await loadMail()
    const result = await mail.sendCustomEmail('u@x.local', 's', '<b>h</b>')

    expect(result).toEqual({ queued: true })
    expect(QUEUED.add).toHaveBeenCalledWith({
      to: 'u@x.local',
      subject: 's',
      html: '<b>h</b>',
      from: expect.stringContaining('@'),
    })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('падение Redis (add отклоняется) не пробрасывается наружу', async () => {
    queueModule.emailQueue = QUEUED
    QUEUED.add.mockRejectedValue(new Error('Connection is closed'))

    const mail = await loadMail()
    await expect(mail.sendCustomEmail('u@x.local', 's', 'h')).resolves.toEqual({
      failed: true,
      error: 'Connection is closed',
    })
  })
})

describe('email.job.js', () => {
  it('без SMTP_HOST возвращает skipped и не бросает', async () => {
    await expect(processEmail({ data: { to: 'u@x.local', subject: 's' } })).resolves.toEqual({ skipped: true })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('без SMTP_USER/SMTP_PASS не создаёт транспорт (частая ошибка конфига)', async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    await expect(processEmail({ data: { to: 'u@x.local', subject: 's' } })).resolves.toEqual({ skipped: true })
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('успешная отправка возвращает sent', async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'
    sendMail.mockResolvedValue({ messageId: 'm' })

    await expect(processEmail({ data: { to: 'u@x.local', subject: 's', html: '<b>h</b>' } })).resolves.toEqual({ sent: true })
  })

  it('повторяет попытку 3 раза и только потом бросает исходную ошибку', async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'
    sendMail.mockRejectedValue(new Error('SMTP down'))

    await expect(processEmail({ data: { to: 'u@x.local', subject: 's' } })).rejects.toThrow('SMTP down')
    expect(sendMail).toHaveBeenCalledTimes(3)
  })

  it('успех со 2-й попытки прекращает retry', async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'
    sendMail.mockRejectedValueOnce(new Error('temporary')).mockResolvedValueOnce({ messageId: 'm' })

    await expect(processEmail({ data: { to: 'u@x.local', subject: 's' } })).resolves.toEqual({ sent: true })
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('CORS_ORIGIN перекрывает дефолтный origin в ссылке сброса пароля', async () => {
    process.env.SMTP_HOST = 'smtp.test.local'
    process.env.SMTP_USER = 'u'
    process.env.SMTP_PASS = 'p'
    sendMail.mockResolvedValue({ messageId: 'm' })
    // WEB_ORIGIN — const на уровне модуля, поэтому env нужно выставить до его импорта
    process.env.CORS_ORIGIN = 'https://swiftmatch.app'
    vi.resetModules()
    const { default: freshJob } = await import('../jobs/email.job.js')

    await freshJob({ data: { to: 'u@x.local', subject: 's', type: 'password-reset', token: 'tk' } })
    expect(sendMail.mock.calls[0][0].html).toContain('https://swiftmatch.app/reset-password?token=tk')
  })
})
