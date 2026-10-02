// Этап 12 (P0 #2, аудиты qwen #2 / дипсик #1): гонки в ядре — лайки/мэтчи,
// ротация refresh-токена и повторная доставка Stripe-вебхука.
//
// Фейк БД ниже не «просто мок»: он моделирует то, что реально делает InnoDB,
// — UNIQUE-индексы (uk_likes_pair, uk_matches_pair, webhook_events) и
// affectedRows атомарного UPDATE. Именно на этом стоят решения о гонках в роутах,
// поэтому обычный mockResolvedValue здесь был бы бесполезен: он не может показать,
// что произойдёт при двух одновременных INSERT.

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
})

const { stripeWebhooks } = vi.hoisted(() => ({ stripeWebhooks: { constructEvent: vi.fn() } }))

import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import jwt from 'jsonwebtoken'

vi.mock('../db.js', () => ({
  default: { query: vi.fn(), getConnection: vi.fn() },
}))

vi.mock('../ws.js', () => ({
  getIO: vi.fn(() => null),
}))

vi.mock('../banned-words.js', () => ({
  getBannedWords: vi.fn(() => []),
  containsBannedWord: vi.fn(() => false),
}))

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('../mail.js', () => ({
  sendVerificationEmail: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
  sendMatchEmail: vi.fn(async () => {}),
}))

vi.mock('stripe', () => ({
  default: function StripeMock() {
    return { webhooks: stripeWebhooks }
  },
}))

import pool from '../db.js'
import socialRoutes from '../routes/social.js'
import authRoutes from '../routes/auth.js'
import premiumRoutes from '../routes/premium.js'

const JWT_SECRET = process.env.JWT_SECRET

const A = 1
const B = 2

function dupEntry(table, keys) {
  const err = new Error(`Duplicate entry '${keys.join('-')}' for key '${table}'`)
  err.code = 'ER_DUP_ENTRY'
  err.errno = 1062
  return err
}

function createFakeDb() {
  const state = {
    seq: 0,
    likes: [],
    matches: [],
    notifications: [],
    refresh_tokens: [],
    subscriptions: [],
    webhook_events: [],
    profiles: new Map([
      [A, { id: A, display_name: 'Anna' }],
      [B, { id: B, display_name: 'Boris' }],
    ]),
  }

  async function query(sql, params = []) {
    // Настоящий round-trip к БД — не мгновенный: без уступки event loop два
    // параллельных HTTP-запроса выполнялись бы строго по очереди и «гонки»
    // в тестах просто не возникало бы.
    await new Promise((resolve) => setImmediate(resolve))
    const s = String(sql).replace(/\s+/g, ' ').trim()

    if (s.startsWith('INSERT IGNORE INTO likes')) {
      const [from, to, type] = params
      if (state.likes.some((r) => r.from_user_id === from && r.to_user_id === to)) {
        return [{ affectedRows: 0, insertId: 0 }, []]
      }
      state.likes.push({ id: ++state.seq, from_user_id: from, to_user_id: to, type })
      return [{ affectedRows: 1, insertId: state.seq }, []]
    }

    if (s.startsWith('INSERT INTO likes')) {
      const [from, to, type] = params
      if (state.likes.some((r) => r.from_user_id === from && r.to_user_id === to)) {
        throw dupEntry('likes', [from, to])
      }
      state.likes.push({ id: ++state.seq, from_user_id: from, to_user_id: to, type })
      return [{ affectedRows: 1, insertId: state.seq }, []]
    }

    if (s.includes('COUNT(*) AS cnt FROM likes')) {
      const [from] = params
      return [[{ cnt: state.likes.filter((r) => r.from_user_id === from).length }], []]
    }

    if (s.includes('FROM likes WHERE from_user_id')) {
      const [from, to] = params
      return [state.likes.filter((r) => r.from_user_id === from && r.to_user_id === to), []]
    }

    if (s.startsWith('INSERT IGNORE INTO matches')) {
      const [u1, u2] = params
      if (state.matches.some((r) => r.user1_id === u1 && r.user2_id === u2)) {
        return [{ affectedRows: 0, insertId: 0 }, []]
      }
      state.matches.push({ id: ++state.seq, user1_id: u1, user2_id: u2, matched: 1 })
      return [{ affectedRows: 1, insertId: state.seq }, []]
    }

    if (s.startsWith('INSERT INTO matches')) {
      const [u1, u2] = params
      if (state.matches.some((r) => r.user1_id === u1 && r.user2_id === u2)) {
        throw dupEntry('matches', [u1, u2])
      }
      state.matches.push({ id: ++state.seq, user1_id: u1, user2_id: u2, matched: 1 })
      return [{ affectedRows: 1, insertId: state.seq }, []]
    }

    if (s.includes('FROM matches WHERE')) {
      const [a, b, c, d] = params
      return [
        state.matches.filter(
          (r) => (r.user1_id === a && r.user2_id === b) || (r.user1_id === c && r.user2_id === d),
        ),
        [],
      ]
    }

    if (s.startsWith('INSERT INTO notifications')) {
      const [userId, type, payload] = params
      const id = ++state.seq
      state.notifications.push({ id, user_id: userId, type, payload, created_at: new Date() })
      return [{ affectedRows: 1, insertId: id }, []]
    }

    if (s.includes('FROM notifications WHERE id')) {
      const [id] = params
      return [state.notifications.filter((n) => n.id === id), []]
    }

    if (s.includes('FROM user_profiles WHERE id')) {
      const [id] = params
      const profile = state.profiles.get(Number(id))
      return [profile ? [profile] : [], []]
    }

    if (s.startsWith('SELECT id FROM subscriptions')) {
      const [userId] = params
      return [state.subscriptions.filter((r) => r.user_id === userId && r.is_active === 1), []]
    }

    if (s.startsWith('INSERT IGNORE INTO webhook_events')) {
      const [provider, eventId] = params
      if (state.webhook_events.some((r) => r.provider === provider && r.event_id === eventId)) {
        return [{ affectedRows: 0, insertId: 0 }, []]
      }
      state.webhook_events.push({ provider, event_id: eventId })
      return [{ affectedRows: 1, insertId: 0 }, []]
    }

    if (s.startsWith('INSERT INTO subscriptions')) {
      const [userId, tier] = params
      state.subscriptions.push({ id: ++state.seq, user_id: userId, tier, is_active: 1 })
      return [{ affectedRows: 1, insertId: state.seq }, []]
    }

    if (s.startsWith('UPDATE subscriptions SET is_active = 0')) {
      const [userId] = params
      let affected = 0
      for (const sub of state.subscriptions) {
        if (sub.user_id === userId && sub.is_active === 1) {
          sub.is_active = 0
          affected++
        }
      }
      return [{ affectedRows: affected }, []]
    }

    if (s.includes('FROM refresh_tokens WHERE token')) {
      // Ровно как в проде: отбор по token и сроку, БЕЗ revoked — иначе повторное
      // использование ротированного токена не попало бы в ветку reuse-detection
      const [token] = params
      return [state.refresh_tokens.filter((r) => r.token === token), []]
    }

    if (s.includes('UPDATE refresh_tokens SET revoked = 1 WHERE id = ? AND revoked = 0')) {
      const [id] = params
      const row = state.refresh_tokens.find((r) => r.id === id && r.revoked === 0)
      if (!row) return [{ affectedRows: 0 }, []]
      row.revoked = 1
      return [{ affectedRows: 1 }, []]
    }

    if (s.includes('UPDATE refresh_tokens SET revoked = 1 WHERE family_id')) {
      const [family] = params
      let affected = 0
      for (const row of state.refresh_tokens) {
        if (row.family_id === family && row.revoked === 0) {
          row.revoked = 1
          affected++
        }
      }
      return [{ affectedRows: affected }, []]
    }

    if (s.startsWith('INSERT INTO refresh_tokens')) {
      const [userId, token, family, fingerprint] = params
      state.refresh_tokens.push({
        id: ++state.seq,
        user_id: userId,
        token,
        family_id: family,
        fingerprint,
        revoked: 0,
      })
      return [{ affectedRows: 1, insertId: state.seq }, []]
    }

    return [[], []]
  }

  return { query, state }
}

function createApp(_db) {
  const app = express()
  app.use(express.json())
  app.use(authRoutes)
  app.use(socialRoutes)
  app.use(premiumRoutes)
  return app
}

function authHeader(userId) {
  return `Bearer ${jwt.sign({ userId, role: 'user' }, JWT_SECRET, { expiresIn: '1h' })}`
}

let db

beforeEach(() => {
  vi.clearAllMocks()
  db = createFakeDb()
  pool.query.mockImplementation((sql, params) => db.query(sql, params))
  pool.getConnection.mockImplementation(async () => ({
    query: (sql, params) => db.query(sql, params),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  }))
})

describe('гонка лайков в одну сторону (двойной тап / ретрай)', () => {
  it('два параллельных лайка A→B дают одну запись и одно уведомление, оба 201', async () => {
    const app = createApp(db)
    const like = () => request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(A))
      .send({ liked_user_id: B })

    const [first, second] = await Promise.all([like(), like()])

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(db.state.likes).toHaveLength(1)
    expect(db.state.notifications).toHaveLength(1)
  })

  it('односторонний лайк без взаимности не создаёт мэтч', async () => {
    const app = createApp(db)
    const res = await request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(A))
      .send({ liked_user_id: B })

    expect(res.status).toBe(201)
    expect(res.body.matched).toBe(false)
    expect(db.state.matches).toHaveLength(0)
  })
})

describe('гонка взаимных лайков (A→B и B→A одновременно)', () => {
  it('ровно один мэтч, ни один запрос не падает в 500', async () => {
    const app = createApp(db)
    const likeAB = () => request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(A))
      .send({ liked_user_id: B })
    const likeBA = () => request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(B))
      .send({ liked_user_id: A })

    const [first, second] = await Promise.all([likeAB(), likeBA()])

    expect([first.status, second.status]).toEqual([201, 201])
    expect(db.state.matches).toHaveLength(1)
    expect(db.state.likes).toHaveLength(2)
    expect(db.state.notifications).toHaveLength(2)
  })

  it('три параллельных запроса (A→B, B→A, A→B) — тот же инвариант', async () => {
    const app = createApp(db)
    const likeAB = () => request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(A))
      .send({ liked_user_id: B })
    const likeBA = () => request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(B))
      .send({ liked_user_id: A })

    const responses = await Promise.all([likeAB(), likeBA(), likeAB()])

    // Проверяем только то, что не зависит от порядка переплетения: коды ответов
    // и итоговое состояние. Флаг matched у конкретного запроса зависит от того,
    // успел ли противоположный лайк появиться к моменту его проверки, — это отдельно
    // проверяется детерминированным последовательным тестом ниже.
    expect(responses.every((r) => r.status === 201)).toBe(true)
    expect(db.state.matches).toHaveLength(1)
    expect(db.state.likes).toHaveLength(2)
    expect(db.state.notifications).toHaveLength(2)
  })

  it('взаимные лайки последовательно: оба ответа matched=true, мэтч один', async () => {
    const app = createApp(db)
    const likeAB = () => request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(A))
      .send({ liked_user_id: B })
    const likeBA = () => request(app)
      .post('/api/likes')
      .set('Authorization', authHeader(B))
      .send({ liked_user_id: A })

    const first = await likeAB()
    expect(first.body.matched).toBe(false)
    const second = await likeBA()

    expect(second.status).toBe(201)
    expect(second.body.matched).toBe(true)
    expect(db.state.matches).toHaveLength(1)
  })
})

describe('гонка ротации refresh-токена', () => {
  function seedRefreshToken() {
    db.state.refresh_tokens.push({
      id: ++db.state.seq,
      user_id: 7,
      token: 'seeded-refresh',
      family_id: 'family-1',
      fingerprint: null,
      revoked: 0,
    })
  }

  it('два параллельных refresh с одним токеном: один 200 с новым токеном, второй 401 + отзыв семьи', async () => {
    seedRefreshToken()
    const app = createApp(db)
    const refresh = () => request(app).post('/api/auth/refresh').send({ refresh_token: 'seeded-refresh' })

    const responses = await Promise.all([refresh(), refresh()])
    const codes = responses.map((r) => r.status).sort()

    expect(codes).toEqual([200, 401])
    const winner = responses.find((r) => r.status === 200)
    const loser = responses.find((r) => r.status === 401)
    expect(winner.body.refresh_token).toBeTruthy()
    expect(winner.body.refresh_token).not.toBe('seeded-refresh')
    expect(loser.body.message).toMatch(/reuse/i)
    expect(db.state.refresh_tokens.filter((r) => r.revoked === 0)).toHaveLength(0)
  })

  it('три параллельных refresh: ровно один 200', async () => {
    seedRefreshToken()
    const app = createApp(db)
    const refresh = () => request(app).post('/api/auth/refresh').send({ refresh_token: 'seeded-refresh' })

    const responses = await Promise.all([refresh(), refresh(), refresh()])

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1)
    expect(responses.filter((r) => r.status === 401)).toHaveLength(2)
  })
})

describe('гонка повторной доставки Stripe-вебхука', () => {
  it('два параллельных запроса с одним event.id создают одну подписку', async () => {
    stripeWebhooks.constructEvent.mockReturnValue({
      id: 'evt_race_1',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: '5', tier: 'plus', duration_months: '1' } } },
    })
    const app = createApp(db)
    const deliver = () => request(app)
      .post('/api/premium/webhook')
      .set('stripe-signature', 't=1,v1=ok')
      .send({ fake: true })

    const [first, second] = await Promise.all([deliver(), deliver()])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(db.state.subscriptions).toHaveLength(1)
    expect(db.state.subscriptions[0].is_active).toBe(1)
  })
})
