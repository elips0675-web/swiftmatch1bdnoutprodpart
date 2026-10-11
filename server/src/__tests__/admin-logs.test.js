import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

const mocks = vi.hoisted(() => ({
  getRecentLogs: vi.fn(() => []),
}))

vi.mock('../log-buffer.js', () => mocks)

import adminLogs from '../routes/admin/logs.js'

function createApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/admin', adminLogs)
  return app
}

describe('G3 #36: GET /api/admin/logs/recent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('отдаёт последние записи лога', async () => {
    mocks.getRecentLogs.mockReturnValue([{ level: 'error', message: 'boom', rid: 'r1' }])
    const res = await request(createApp()).get('/api/admin/logs/recent')
    expect(res.status).toBe(200)
    expect(res.body.logs).toHaveLength(1)
    expect(res.body.logs[0]).toMatchObject({ level: 'error', message: 'boom' })
  })

  it('применяет ?limit, но не больше буфера', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ level: 'warn', message: `w${i}` }))
    mocks.getRecentLogs.mockReturnValue(many)
    const res = await request(createApp()).get('/api/admin/logs/recent?limit=10')
    expect(res.status).toBe(200)
    expect(res.body.logs).toHaveLength(10)
    expect(res.body.logs[0].message).toBe('w90')
  })

  it('негативный/нулевой limit не ломается (клэмп в 1..200)', async () => {
    mocks.getRecentLogs.mockReturnValue([{ level: 'error', message: 'x' }])
    const res = await request(createApp()).get('/api/admin/logs/recent?limit=-5')
    expect(res.status).toBe(200)
    expect(res.body.logs).toHaveLength(1)
  })

  it('пустой буфер — 200 с пустым массивом', async () => {
    mocks.getRecentLogs.mockReturnValue([])
    const res = await request(createApp()).get('/api/admin/logs/recent')
    expect(res.status).toBe(200)
    expect(res.body.logs).toEqual([])
  })
})