import { test, expect, type APIRequestContext } from '@playwright/test'
import { apiCall } from './helpers/api'

// Этап 74 (аудит qwen, пробел #2): Hangouts 2.0 — Date flow (like/skip/mutual),
// Company flow (join/leave), check-in и review. Спека.
// Данные flows реализованы в server/src/routes/hangouts.js (ХАНГОУТС 2.0).

// Москва (Красная площадь), используется для гео-чек-ина
const RED_SQUARE = { lat: 55.7539, lng: 37.6208 }

function tomorrowISO(days = 7): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()
}

async function registerUser(ctx: APIRequestContext, name: string) {
  const email = `e2e_h2_${name}_${Date.now()}@mail.ru`
  const reg = await apiCall(ctx, 'POST', '/api/auth/register', {
    email,
    password: 'TestPass123',
    displayName: `H2 ${name}`,
    consent: true,
  })
  expect(reg.ok).toBe(true)
  return { token: reg.body?.token as string, userId: reg.body?.userId as number }
}

async function createHangout(ctx: APIRequestContext, token: string, type: string, overrides: Record<string, unknown> = {}) {
  // createLimiter в hangouts.js: 10 созданий/мин с одного IP (pitfall #24).
  // На повторных E2E-прогонах в коротком окне может вернуть 429. Окно 60с — retry внутри
  // него бесполезен, поэтому короткий bounded-retry; полный reset покрывает test-level
  // retry (retries: 1 в playwright.config.ts).
  const payload = {
    category: 'cinema',
    title: `H2 ${type} ${Date.now()}`,
    description: 'Evening together',
    event_date: tomorrowISO(),
    max_companions: 1,
    hangout_type: type,
    city: 'Moscow',
    lat: RED_SQUARE.lat,
    lng: RED_SQUARE.lng,
    ...overrides,
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await apiCall(ctx, 'POST', '/api/hangouts', payload, token)
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500))
      continue
    }
    expect(res.ok).toBe(true)
    expect(res.body?.id).toBeGreaterThan(0)
    return res.body?.id as number
  }
  throw new Error('Failed to create hangout after retries (rate limit)')
}

test.describe('Hangouts 2.0: Date flow (like/skip/mutual)', () => {
  test('like records on a date hangout; author cannot like own', async ({ playwright, request }) => {
    const authorCtx = await playwright.request.newContext()
    const likerCtx = await playwright.request.newContext()
    const author = await registerUser(authorCtx, 'auth')
    const liker = await registerUser(likerCtx, 'liker')

    const hangoutId = await createHangout(authorCtx, author.token, 'date')

    // liker лайкает хэнгаут автора
    const like1 = await apiCall(likerCtx, 'POST', `/api/hangouts/${hangoutId}/like`, {}, liker.token)
    expect(like1.status).toBe(200)
    expect(like1.body?.liked).toBe(true)
    // автор не может «лайкнуть в ответ» собственный хэнгаут → mutual=false и чат не создаётся
    expect(like1.body?.mutual).toBe(false)

    // автор не может лайкнуть собственный хэнгаут — 400
    const self = await apiCall(authorCtx, 'POST', `/api/hangouts/${hangoutId}/like`, {}, author.token)
    expect(self.status).toBe(400)
  })

  test('skip records skip status; like is only valid for date-type', async ({ playwright, request }) => {
    const authorCtx = await playwright.request.newContext()
    const skipperCtx = await playwright.request.newContext()
    const compAuthorCtx = await playwright.request.newContext()
    const author = await registerUser(authorCtx, 'auth2')
    const skipper = await registerUser(skipperCtx, 'skip2')

    const hangoutId = await createHangout(authorCtx, author.token, 'date')

    const skip = await apiCall(skipperCtx, 'POST', `/api/hangouts/${hangoutId}/skip`, {}, skipper.token)
    expect(skip.status).toBe(200)
    expect(skip.body?.skipped).toBe(true)

    const detail = await apiCall(skipperCtx, 'GET', `/api/hangouts/${hangoutId}`, undefined, skipper.token)
    expect(detail.status).toBe(200)
    expect(detail.body?.my_like_status).toBe('skip')

    // лайк чужого company-типа запрещён. Отдельный автор: free-юзер ограничен 1 хэнгаутом/день.
    const compAuthor = await registerUser(compAuthorCtx, 'comp3')
    const companyId = await createHangout(compAuthorCtx, compAuthor.token, 'company')
    const like = await apiCall(skipperCtx, 'POST', `/api/hangouts/${companyId}/like`, {}, skipper.token)
    expect(like.status).toBe(400)
  })
})

test.describe('Hangouts 2.0: Company flow (join/leave)', () => {
  test('member joins, chat is created with 2+ participants, then leaves', async ({ playwright, request }) => {
    const authorCtx = await playwright.request.newContext()
    const memberCtx = await playwright.request.newContext()
    const member2Ctx = await playwright.request.newContext()
    const author = await registerUser(authorCtx, 'corg')
    const member = await registerUser(memberCtx, 'cmember')
    const member2 = await registerUser(member2Ctx, 'cmember2')

    const hangoutId = await createHangout(authorCtx, author.token, 'company', { max_companions: 5 })

    // первый участник — в компании становится 1 (организатор в hangout_participants не входит)
    const join1 = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/join`, {}, member.token)
    expect(join1.status).toBe(201)
    expect(join1.body?.joined).toBe(true)
    expect(join1.body?.participant_count).toBe(1)
    // при 1 участнике групповой чат ещё не создаётся
    expect(join1.body?.chat_id).toBeNull()

    // второй участник → 2, создаётся групповой чат
    const join2 = await apiCall(member2Ctx, 'POST', `/api/hangouts/${hangoutId}/join`, {}, member2.token)
    expect(join2.status).toBe(201)
    expect(join2.body?.participant_count).toBe(2)
    expect(join2.body?.chat_id).toBeGreaterThan(0)

    const duplicate = await apiCall(member2Ctx, 'POST', `/api/hangouts/${hangoutId}/join`, {}, member2.token)
    expect(duplicate.status).toBe(409)

    const leave = await apiCall(member2Ctx, 'DELETE', `/api/hangouts/${hangoutId}/join`, undefined, member2.token)
    expect(leave.status).toBe(200)
    expect(leave.body?.left).toBe(true)

    // организатор не может вступить в собственный хэнгаут — 400
    const organizerJoin = await apiCall(authorCtx, 'POST', `/api/hangouts/${hangoutId}/join`, {}, author.token)
    expect(organizerJoin.status).toBe(400)
  })

  test('join is only valid for company-type hangouts', async ({ playwright, request }) => {
    const authorCtx = await playwright.request.newContext()
    const memberCtx = await playwright.request.newContext()
    const author = await registerUser(authorCtx, 'dorg')
    const member = await registerUser(memberCtx, 'djoin')

    const dateId = await createHangout(authorCtx, author.token, 'date')
    const join = await apiCall(memberCtx, 'POST', `/api/hangouts/${dateId}/join`, {}, member.token)
    expect(join.status).toBe(400)
  })
})

test.describe('Hangouts 2.0: Check-in and review', () => {
  test('accepted participant checks in within radius; non-participant is rejected', async ({ playwright, request }) => {
    const authorCtx = await playwright.request.newContext()
    const memberCtx = await playwright.request.newContext()
    const strangerCtx = await playwright.request.newContext()
    const author = await registerUser(authorCtx, 'chkorg')
    const member = await registerUser(memberCtx, 'chkmem')
    const stranger = await registerUser(strangerCtx, 'chkstr')

    // date-type: member должен быть accepted, чтобы чек-иниться.
    // max_companions=2 — иначе после первого accept хэнгаут станет completed (409 на checkin)
    const hangoutId = await createHangout(authorCtx, author.token, 'date', { max_companions: 2 })

    const respond = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/respond`, { message: 'In!' }, member.token)
    expect(respond.ok).toBe(true)
    const responseId = respond.body?.id as number

    const accept = await apiCall(authorCtx, 'PUT', `/api/hangouts/${hangoutId}/responses/${responseId}`, {
      status: 'accepted',
    }, author.token)
    expect(accept.ok).toBe(true)

    // в радиусе Красной площади — OК
    const ok = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/checkin`, {
      lat: RED_SQUARE.lat,
      lng: RED_SQUARE.lng,
    }, member.token)
    expect(ok.status).toBe(200)
    expect(ok.body?.checked_in).toBe(true)

    // слишком далеко — 400
    const far = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/checkin`, {
      lat: 55.0,
      lng: 82.9,
    }, member.token)
    expect(far.status).toBe(400)

    // не-участник чек-иниться не может — 403
    const strangerCheckin = await apiCall(strangerCtx, 'POST', `/api/hangouts/${hangoutId}/checkin`, {
      lat: RED_SQUARE.lat,
      lng: RED_SQUARE.lng,
    }, stranger.token)
    expect(strangerCheckin.status).toBe(403)
  })

  test('reviews: valid -> duplicate (409) -> self (400) -> invalid rating (400)', async ({ playwright, request }) => {
    const authorCtx = await playwright.request.newContext()
    const memberCtx = await playwright.request.newContext()
    const author = await registerUser(authorCtx, 'rvorg')
    const member = await registerUser(memberCtx, 'rvmem')

    const hangoutId = await createHangout(authorCtx, author.token, 'date')

    const respond = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/respond`, { message: 'Go' }, member.token)
    expect(respond.ok).toBe(true)
    const responseId = respond.body?.id as number
    const accept = await apiCall(authorCtx, 'PUT', `/api/hangouts/${hangoutId}/responses/${responseId}`, {
      status: 'accepted',
    }, author.token)
    expect(accept.ok).toBe(true)

    // member ревьюит автора
    const review = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/review`, {
      reviewee_id: author.userId,
      rating: 5,
      tag: 'fun',
    }, member.token)
    expect(review.status).toBe(201)
    expect(review.body?.review).toBe(true)

    // повторный ревью того же юзера — 409
    const dup = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/review`, {
      reviewee_id: author.userId,
      rating: 4,
    }, member.token)
    expect(dup.status).toBe(409)

    // self-review запрещён
    const self = await apiCall(authorCtx, 'POST', `/api/hangouts/${hangoutId}/review`, {
      reviewee_id: author.userId,
      rating: 5,
    }, author.token)
    expect(self.status).toBe(400)

    // невалидный rating — 400
    const bad = await apiCall(memberCtx, 'POST', `/api/hangouts/${hangoutId}/review`, {
      reviewee_id: author.userId,
      rating: 9,
    }, member.token)
    expect(bad.status).toBe(400)
  })
})
