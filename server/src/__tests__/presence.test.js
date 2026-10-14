import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../db.js', () => ({
  default: { query: vi.fn() },
}))

import pool from '../db.js'
import {
  resetPresence,
  registerSocket,
  unregisterSocket,
  onlineUserIds,
  markOnline,
  markOffline,
  touchLastSeen,
  applyActivityPrivacy,
} from '../presence.js'

beforeEach(() => {
  vi.clearAllMocks()
  pool.query.mockReset()
  pool.query.mockResolvedValue([[], []])
  resetPresence()
})

describe('presence: учёт сокетов пользователя', () => {
  it('первый сокет возвращает true, повторный — false (одна вкладка = один онлайн)', () => {
    expect(registerSocket(7, 's1')).toBe(true)
    expect(registerSocket(7, 's2')).toBe(false)
  })

  it('unregister возвращает true только когда закрылся последний сокет', () => {
    registerSocket(7, 's1')
    registerSocket(7, 's2')
    expect(unregisterSocket(7, 's1')).toBe(false)
    expect(onlineUserIds()).toEqual([7])
    expect(unregisterSocket(7, 's2')).toBe(true)
    expect(onlineUserIds()).toEqual([])
  })

  it('разные пользователи ведутся независимо', () => {
    registerSocket(7, 's1')
    registerSocket(8, 's2')
    registerSocket(7, 's3')
    expect(onlineUserIds().sort((a, b) => a - b)).toEqual([7, 8])
    expect(unregisterSocket(8, 's2')).toBe(true)
    expect(onlineUserIds()).toEqual([7])
    expect(unregisterSocket(7, 's3')).toBe(false)
  })

  it('unregister неизвестного сокета — false, повторная регистрация сокета не плодит юзеров', () => {
    expect(unregisterSocket(7, 'ghost')).toBe(false)
    expect(registerSocket(7, 's1')).toBe(true)
    expect(registerSocket(7, 's1')).toBe(false)
    expect(unregisterSocket(7, 's1')).toBe(true)
    expect(unregisterSocket(7, 's1')).toBe(false)
  })

  it('undefined/null userId не создают запись', () => {
    expect(registerSocket(undefined, 's1')).toBe(false)
    expect(registerSocket(null, 's2')).toBe(false)
    expect(onlineUserIds()).toEqual([])
  })

  it('resetPresence очищает состояние', () => {
    registerSocket(7, 's1')
    resetPresence()
    expect(onlineUserIds()).toEqual([])
    expect(registerSocket(7, 's2')).toBe(true)
  })
})

describe('presence: записи в user_profiles', () => {
  it('markOnline поднимает флаг и обновляет last_seen', async () => {
    await markOnline(7)
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE user_profiles SET online = 1, last_seen = NOW() WHERE id = ?',
      [7],
    )
  })

  it('markOffline сбрасывает флаг и фиксирует last_seen', async () => {
    await markOffline(7)
    expect(pool.query).toHaveBeenCalledWith(
      'UPDATE user_profiles SET online = 0, last_seen = NOW() WHERE id = ?',
      [7],
    )
  })

  it('touchLastSeen с пустым списком не трогает БД', async () => {
    expect(await touchLastSeen([])).toBe(0)
    expect(await touchLastSeen(undefined)).toBe(0)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('touchLastSeen дедуплицирует id и отбрасывает мусор', async () => {
    expect(await touchLastSeen([7, '7', 8, 0, -1, null, undefined, 2.5])).toBe(2)
    expect(pool.query).toHaveBeenCalledTimes(1)
    const [sql, params] = pool.query.mock.calls[0]
    expect(sql).toBe('UPDATE user_profiles SET last_seen = NOW() WHERE id IN (?, ?)')
    expect(params).toEqual([7, 8])
  })
})

describe('applyActivityPrivacy: сокрытие статуса активности', () => {
  it('прятает online и last_seen у чужого профиля и убирает служебные поля', () => {
    const row = { id: 5, online: 1, last_seen: '2026-01-01 10:00:00', show_online: 0, show_last_seen: 0 }
    const out = applyActivityPrivacy(row, 1)
    expect(out.online).toBe(0)
    expect(out.last_seen).toBeNull()
    expect(out).not.toHaveProperty('show_online')
    expect(out).not.toHaveProperty('show_last_seen')
  })

  it('себе показывает как есть', () => {
    const row = { id: 5, online: 1, last_seen: 'x', show_online: 0, show_last_seen: 0 }
    const out = applyActivityPrivacy(row, 5)
    expect(out.online).toBe(1)
    expect(out.last_seen).toBe('x')
    expect(out).not.toHaveProperty('show_online')
    expect(out).not.toHaveProperty('show_last_seen')
  })

  it('строки без колонок (миграция не применена) не маскируются', () => {
    const row = { id: 5, online: 1, last_seen: 'x' }
    const out = applyActivityPrivacy(row, 1)
    expect(out.online).toBe(1)
    expect(out.last_seen).toBe('x')
    expect(out).not.toHaveProperty('show_online')
  })

  it('независимые поля: show_online=1 показывает точку, show_last_seen=0 прячет дату', () => {
    const rows = [
      { id: 5, online: 1, last_seen: 'a', show_online: 1, show_last_seen: 0, display_name: 'A' },
      { id: 6, online: 1, last_seen: 'b', show_online: 0, show_last_seen: 1, display_name: 'B' },
      { id: 7, online: 0, last_seen: 'c', show_online: 1, show_last_seen: 1, display_name: 'C' },
    ]
    const out = applyActivityPrivacy(rows, 1)
    expect(out[0].online).toBe(1)
    expect(out[0].last_seen).toBeNull()
    expect(out[1].online).toBe(0)
    expect(out[1].last_seen).toBe('b')
    expect(out[2].online).toBe(0)
    expect(out[2].last_seen).toBe('c')
    expect(out.map((r) => r.display_name)).toEqual(['A', 'B', 'C'])
    expect(out.every((r) => !('show_online' in r) && !('show_last_seen' in r))).toBe(true)
  })

  it('строка чужого пользователя, у которого masked поля частично включены', () => {
    const rows = [{ id: 5, online: 1, last_seen: 'a', show_online: 1, show_last_seen: 1 }]
    const out = applyActivityPrivacy(rows, 1)
    expect(out[0].online).toBe(1)
    expect(out[0].last_seen).toBe('a')
  })

  it('кастомный id-поля для мэтчей, чатов и встреч (row.id — не профиль)', () => {
    const rows = [
      { id: 900, user_id: 5, online: 1, show_online: 0 },
      { id: 901, user_id: 6, online: 1, show_online: 1 },
    ]
    const out = applyActivityPrivacy(rows, 1, (row) => row.user_id)
    expect(out[0].online).toBe(0)
    expect(out[1].online).toBe(1)

    const chats = [
      { id: 42, other_user_id: 5, online: 1, show_online: 0 },
      { id: 43, other_user_id: 1, online: 1, show_online: 0 },
    ]
    const outChats = applyActivityPrivacy(chats, 1, (row) => row.other_user_id)
    expect(outChats[0].online).toBe(0)
    expect(outChats[1].online).toBe(1)
  })

  it('анонимный зритель (viewerId undefined) не считается автором', () => {
    expect(applyActivityPrivacy({ id: 5, online: 1, show_online: 0 }, undefined).online).toBe(0)
    expect(applyActivityPrivacy({ id: 5, online: 1, show_online: 0 }, null).online).toBe(0)
  })

  it('falsy/пустой payload возвращается как есть', () => {
    expect(applyActivityPrivacy(null, 1)).toBeNull()
    expect(applyActivityPrivacy(undefined, 1)).toBeUndefined()
    expect(applyActivityPrivacy([], 1)).toEqual([])
  })

  it('show_online возвращает числовой строковый 0 из старых записей', () => {
    expect(applyActivityPrivacy({ id: 5, online: 1, show_online: '0' }, 1).online).toBe(0)
  })
})
