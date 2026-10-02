import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import jwt from 'jsonwebtoken'

const OLD_SECRET = 'secret-before-rotation'
const NEW_SECRET = 'secret-after-rotation'

async function loadMiddleware(env) {
  for (const key of ['JWT_SECRET', 'JWT_SECRET_PREV']) delete process.env[key]
  Object.assign(process.env, env)
  vi.resetModules()
  return import('../middleware.js')
}

describe('JWT graceful rotation: verify принимает и новый, и старый ключ', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.JWT_SECRET
    delete process.env.JWT_SECRET_PREV
  })

  it('без JWT_SECRET_PREV токен со старым ключом не проходит (старое поведение)', async () => {
    const { verifyToken } = await loadMiddleware({ JWT_SECRET: NEW_SECRET })
    const token = jwt.sign({ userId: 1 }, OLD_SECRET)

    expect(() => verifyToken(token)).toThrow()
  })

  it('токен, подписанный НОВЫМ ключом, проходит всегда', async () => {
    const { verifyToken } = await loadMiddleware({ JWT_SECRET: NEW_SECRET })
    const token = jwt.sign({ userId: 7, role: 'user' }, NEW_SECRET)

    expect(verifyToken(token)).toMatchObject({ userId: 7, role: 'user' })
  })

  it('токен, подписанный СТАРЫМ ключом, проходит при JWT_SECRET_PREV=old (окно ротации)', async () => {
    const { verifyToken } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: OLD_SECRET })
    const token = jwt.sign({ userId: 42, role: 'user' }, OLD_SECRET)

    expect(verifyToken(token)).toMatchObject({ userId: 42, role: 'user' })
  })

  it('после закрытия окна (JWT_SECRET_PREV убран) старый токен снова не проходит', async () => {
    const { verifyToken: duringWindow } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: OLD_SECRET })
    const token = jwt.sign({ userId: 42 }, OLD_SECRET)
    expect(duringWindow(token)).toMatchObject({ userId: 42 })

    const { verifyToken: afterWindow } = await loadMiddleware({ JWT_SECRET: NEW_SECRET })
    expect(() => afterWindow(token)).toThrow()
  })

  it('поддерживается несколько предыдущих ключей через запятую', async () => {
    const { verifyToken } = await loadMiddleware({
      JWT_SECRET: NEW_SECRET,
      JWT_SECRET_PREV: `older-secret, ${OLD_SECRET} ,another`,
    })

    expect(verifyToken(jwt.sign({ userId: 1 }, OLD_SECRET))).toMatchObject({ userId: 1 })
    expect(verifyToken(jwt.sign({ userId: 2 }, 'older-secret'))).toMatchObject({ userId: 2 })
    expect(verifyToken(jwt.sign({ userId: 3 }, 'another'))).toMatchObject({ userId: 3 })
  })

  it('пробелы и пустые элементы в JWT_SECRET_PREV не ломают проверку', async () => {
    const { verifyToken } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: '  ,  ' })
    expect(verifyToken(jwt.sign({ userId: 9 }, NEW_SECRET))).toMatchObject({ userId: 9 })
  })

  it('дубль текущего ключа в JWT_SECRET_PREV игнорируется', async () => {
    const { verifyToken } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: NEW_SECRET })
    expect(verifyToken(jwt.sign({ userId: 5 }, NEW_SECRET))).toMatchObject({ userId: 5 })
  })

  it('auth() принимает токен со старым ключом в окне ротации', async () => {
    const { auth } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: OLD_SECRET })
    const req = { headers: { authorization: `Bearer ${jwt.sign({ userId: 123 }, OLD_SECRET)}` }, cookies: undefined }
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) }
    const next = vi.fn()

    auth(req, res, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(req.userId).toBe(123)
  })

  it('auth() по-прежнему отдаёт 401 на подделанный токен (graceful rotation не ослабляет проверку)', async () => {
    const { auth } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: OLD_SECRET })
    const req = { headers: { authorization: 'Bearer not-a-jwt' }, cookies: undefined }
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) }
    const next = vi.fn()

    auth(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('optionalAuth() в окне ротации ставит userId, без окна — null', async () => {
    const token = jwt.sign({ userId: 77 }, OLD_SECRET)

    const { optionalAuth: withWindow } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: OLD_SECRET })
    const reqOk = { headers: { authorization: `Bearer ${token}` }, cookies: undefined }
    withWindow(reqOk, {}, vi.fn())
    expect(reqOk.userId).toBe(77)

    const { optionalAuth: withoutWindow } = await loadMiddleware({ JWT_SECRET: NEW_SECRET })
    const reqNo = { headers: { authorization: `Bearer ${token}` }, cookies: undefined }
    withoutWindow(reqNo, {}, vi.fn())
    expect(reqNo.userId).toBeNull()
  })

  it('просроченный токен не проходит даже в окне ротации (TTL соблюдается)', async () => {
    const { verifyToken } = await loadMiddleware({ JWT_SECRET: NEW_SECRET, JWT_SECRET_PREV: OLD_SECRET })
    const expired = jwt.sign({ userId: 1 }, OLD_SECRET, { expiresIn: '-10s' })

    expect(() => verifyToken(expired)).toThrow(/expired/)
  })

  it('в production без JWT_SECRET по-прежнему падает fail-fast', async () => {
    const { verifyToken } = await loadMiddleware({ NODE_ENV: 'production' })
    expect(() => verifyToken(jwt.sign({ userId: 1 }, OLD_SECRET))).toThrow(/JWT_SECRET must be set/)
  })
})
