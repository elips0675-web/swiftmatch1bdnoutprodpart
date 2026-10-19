import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const weekly = vi.hoisted(() => ({
  buildWeeklySummary: vi.fn(),
  resolveRecipient: vi.fn(),
  sendWeeklyReport: vi.fn(),
}))

vi.mock('../weekly-report.js', () => ({
  buildWeeklySummary: weekly.buildWeeklySummary,
  resolveRecipient: weekly.resolveRecipient,
  sendWeeklyReport: weekly.sendWeeklyReport,
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import weeklyReportRoutes from '../routes/admin/weekly-report.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', weeklyReportRoutes)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/weekly-report', () => {
  it('отдаёт сводку вместе с получателем', async () => {
    weekly.buildWeeklySummary.mockResolvedValueOnce({
      from: '2026-01-01',
      to: '2026-01-07',
      newUsers: 5,
      matches: 2,
      revenue: 999,
      complaints: 1,
    })
    weekly.resolveRecipient.mockReturnValueOnce('admin@example.com')

    const res = await request(createApp()).get('/api/admin/weekly-report')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      newUsers: 5,
      matches: 2,
      revenue: 999,
      complaints: 1,
      recipient: 'admin@example.com',
    })
  })

  it('получателя нет — recipient null, а сводка всё равно отдаётся', async () => {
    weekly.buildWeeklySummary.mockResolvedValueOnce({ newUsers: 0 })
    weekly.resolveRecipient.mockReturnValueOnce(null)
    const res = await request(createApp()).get('/api/admin/weekly-report')
    expect(res.status).toBe(200)
    expect(res.body.recipient).toBeNull()
  })

  it('падение построения сводки даёт 500', async () => {
    weekly.buildWeeklySummary.mockRejectedValueOnce(new Error('db down'))
    const res = await request(createApp()).get('/api/admin/weekly-report')
    expect(res.status).toBe(500)
    expect(res.body.message).toBe('Failed to build weekly report')
  })
})

describe('POST /api/admin/weekly-report/send', () => {
  it('успешная отправка отдаёт сводку', async () => {
    weekly.sendWeeklyReport.mockResolvedValueOnce({
      sent: true,
      reason: 'sent',
      summary: { newUsers: 5 },
    })
    const res = await request(createApp()).post('/api/admin/weekly-report/send')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ message: 'Weekly report sent', summary: { newUsers: 5 } })
  })

  it('нет получателя — 400 с причиной no-recipient', async () => {
    weekly.sendWeeklyReport.mockResolvedValueOnce({ sent: false, reason: 'no-recipient' })
    const res = await request(createApp()).post('/api/admin/weekly-report/send')
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: 'Weekly report not sent', reason: 'no-recipient' })
  })

  it('ошибка доставки — 502 с причиной error', async () => {
    weekly.sendWeeklyReport.mockResolvedValueOnce({ sent: false, reason: 'error' })
    const res = await request(createApp()).post('/api/admin/weekly-report/send')
    expect(res.status).toBe(502)
    expect(res.body).toEqual({ message: 'Weekly report not sent', reason: 'error' })
  })
})
