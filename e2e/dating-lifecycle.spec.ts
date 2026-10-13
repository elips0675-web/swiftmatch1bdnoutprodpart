import { test, expect, APIRequestContext } from '@playwright/test'
import { io, Socket } from 'socket.io-client'
import { apiCall, API_BASE } from './helpers/api'

// P2 #23 (аудит qwen #21, дипсик #19): живая воронка знакомств одним прогоном.
// Покрывает то, чего не было: регистрация → анкета → лайк → взаимный мэтч → чат →
// сообщение → WebRTC-сигналинг звонка → премиум. Сам медиа-поток звонка (RTP) идёт
// peer-to-peer и вне сервера; контракт сервера — только сигналинг (server/src/ws.js:180).

async function registerUser(ctx: APIRequestContext, name: string) {
  const email = `e2e_lifecycle_${name}_${Date.now()}@mail.ru`
  const reg = await apiCall(ctx, 'POST', '/api/auth/register', {
    email,
    password: 'TestPass123',
    displayName: `Lifecycle ${name}`,
    consent: true,
  })
  expect(reg.ok).toBe(true)
  return { email, token: reg.body?.token as string, userId: reg.body?.userId as number }
}

function connectSocket(token: string): Socket {
  return io(API_BASE, { auth: { token }, transports: ['websocket'], reconnection: false })
}

function waitConnected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 10_000)
    socket.once('connect', () => { clearTimeout(timer); resolve() })
    socket.once('connect_error', (err) => { clearTimeout(timer); reject(err) })
  })
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timeout`)), 10_000)
    socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload) })
  })
}

test.describe('P2 #23: жизненный цикл знакомства', () => {
  test('полная воронка: анкета → взаимный лайк → мэтч → чат → сообщение → премиум', async ({ playwright }) => {
    const ctxA = await playwright.request.newContext()
    const ctxB = await playwright.request.newContext()
    const alice = await registerUser(ctxA, 'alice')
    const bob = await registerUser(ctxB, 'bob')

    // 1. Анкета: заполняем поля, которые видит вторая сторона
    const profilePut = await apiCall(ctxA, 'PUT', `/api/profile/${alice.userId}`, {
      display_name: 'Lifecycle Alice',
      bio: 'Люблю горы и кофе',
      gender: 'female',
      looking_for: 'male',
      dating_goal: 'serious_relationship',
      city: 'Moscow',
      birth_date: '1996-04-12',
    }, alice.token)
    expect(profilePut.ok).toBe(true)

    const me = await apiCall(ctxA, 'GET', '/api/profile/me', undefined, alice.token)
    expect(me.ok).toBe(true)
    expect(me.body?.bio).toBe('Люблю горы и кофе')
    expect(me.body?.gender).toBe('female')
    expect(me.body?.looking_for).toBe('male')
    expect(me.body?.dating_goal).toBe('serious_relationship')
    expect(me.body?.city).toBe('Moscow')
    expect(me.body?.age).toBeGreaterThanOrEqual(18)

    // 2. Односторонний лайк — мэтча ещё нет
    const likeA = await apiCall(ctxA, 'POST', '/api/likes', { liked_user_id: bob.userId }, alice.token)
    expect(likeA.status).toBe(201)
    expect(likeA.body?.matched).toBe(false)

    // 3. Ответный лайк — мэтч
    const likeB = await apiCall(ctxB, 'POST', '/api/likes', { liked_user_id: alice.userId }, bob.token)
    expect(likeB.status).toBe(201)
    expect(likeB.body?.matched).toBe(true)

    // 4. Мэтч виден обоим
    const matchesA = await apiCall(ctxA, 'GET', '/api/matches', undefined, alice.token)
    expect(matchesA.ok).toBe(true)
    expect((matchesA.body as Array<{ user_id: number }>).some((m) => m.user_id === bob.userId)).toBe(true)
    const matchesB = await apiCall(ctxB, 'GET', '/api/matches', undefined, bob.token)
    expect((matchesB.body as Array<{ user_id: number }>).some((m) => m.user_id === alice.userId)).toBe(true)

    // 5. Чат по мэтчу + идемпотентность (второй вызов отдаёт тот же чат)
    const chat = await apiCall(ctxA, 'POST', '/api/chats', { participant_id: bob.userId }, alice.token)
    expect([200, 201]).toContain(chat.status)
    const chatId = chat.body?.id as number
    expect(chatId).toBeGreaterThan(0)
    const chatAgain = await apiCall(ctxB, 'POST', '/api/chats', { participant_id: alice.userId }, bob.token)
    expect(chatAgain.body?.id).toBe(chatId)

    // 6. Сообщение и чтение истории второй стороной
    const msg = await apiCall(ctxA, 'POST', `/api/chats/${chatId}/messages`, { text: 'Привет! Как прошёл день?' }, alice.token)
    expect(msg.status).toBe(201)
    expect(msg.body?.text).toBe('Привет! Как прошёл день?')

    const history = await apiCall(ctxB, 'GET', `/api/chats/${chatId}/messages`, undefined, bob.token)
    expect(history.ok).toBe(true)
    expect(history.body?.has_more).toBe(false)
    const texts = (history.body?.messages as Array<{ text: string }>).map((m) => m.text)
    expect(texts).toContain('Привет! Как прошёл день?')

    const reply = await apiCall(ctxB, 'POST', `/api/chats/${chatId}/messages`, { text: 'Отлично, а у тебя?' }, bob.token)
    expect(reply.status).toBe(201)
    const read = await apiCall(ctxA, 'PUT', `/api/chats/${chatId}/read`, {}, alice.token)
    expect(read.ok).toBe(true)

    // 7. Премиум: вне прод-контура STRIPE_SECRET_KEY нет → mock-подписка (201)
    const checkout = await apiCall(ctxA, 'POST', '/api/premium/create-checkout', { tier: 'gold', duration_months: 1 }, alice.token)
    expect(checkout.status).toBe(201)
    const sub = await apiCall(ctxA, 'GET', '/api/premium/my', undefined, alice.token)
    expect(sub.body?.tier).toBe('gold')
    expect(sub.body?.is_active).toBe(1)

    await ctxA.dispose()
    await ctxB.dispose()
  })

  test('WebRTC-сигналинг: входящий → принятие → завершение; офлайн-абонент недоступен', async ({ playwright }) => {
    const ctx = await playwright.request.newContext()
    const alice = await registerUser(ctx, 'call_a')
    const bob = await registerUser(ctx, 'call_b')

    const sockA = connectSocket(alice.token)
    const sockB = connectSocket(bob.token)
    await waitConnected(sockA)
    await waitConnected(sockB)

    const incoming = once<{ from: number; sdp: string; type: string }>(sockB, 'webrtc:incoming-call')
    sockA.emit('webrtc:call-user', { targetUserId: bob.userId, sdp: 'offer-sdp', type: 'offer' })
    const call = await incoming
    expect(call.from).toBe(alice.userId)
    expect(call.sdp).toBe('offer-sdp')
    expect(call.type).toBe('offer')

    const accepted = once<{ from: number; sdp: string; type: string }>(sockA, 'webrtc:call-accepted')
    sockB.emit('webrtc:call-accepted', { targetUserId: alice.userId, sdp: 'answer-sdp', type: 'answer' })
    const answer = await accepted
    expect(answer.from).toBe(bob.userId)
    expect(answer.sdp).toBe('answer-sdp')

    const ended = once<{ from: number; reason: string }>(sockA, 'webrtc:call-ended')
    sockB.emit('webrtc:end-call', { targetUserId: alice.userId })
    const close = await ended
    expect(close.from).toBe(bob.userId)
    expect(close.reason).toBe('user-ended')

    const unavailable = once<{ targetUserId: number }>(sockA, 'webrtc:user-unavailable')
    sockA.emit('webrtc:call-user', { targetUserId: 999999999, sdp: 'x', type: 'offer' })
    const offline = await unavailable
    expect(offline.targetUserId).toBe(999999999)

    sockA.close()
    sockB.close()
    await ctx.dispose()
  })
})
