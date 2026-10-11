import { describe, it, expect, beforeEach } from 'vitest'
import { pushLogEntry, getRecentLogs, resetRecentLogs } from '../log-buffer.js'

describe('G3 #36: log-buffer (кольцевой буфер последних ошибок)', () => {
  beforeEach(() => resetRecentLogs())

  it('хранит записи и отдаёт копию', () => {
    pushLogEntry('error', 'boom', { error: 'kaboom', rid: 'r1' })
    pushLogEntry('warn', 'careful', { rid: 'r2' })
    const logs = getRecentLogs()
    expect(logs).toHaveLength(2)
    expect(logs[0]).toMatchObject({ level: 'error', message: 'boom', error: 'kaboom', rid: 'r1' })
    expect(logs[1]).toMatchObject({ level: 'warn', message: 'careful' })
    // вернулась копия, а не живой массив
    logs.push({ fake: true })
    expect(getRecentLogs()).toHaveLength(2)
  })

  it('сериализует error/stack в строки, а не оставляет объекты', () => {
    pushLogEntry('error', 'boom', { error: new Error('x'), stack: new Error('y').stack })
    const [entry] = getRecentLogs()
    expect(typeof entry.error).toBe('string')
    expect(entry.error).toContain('x')
    expect(typeof entry.stack).toBe('string')
  })

  it('ограничивает буфер 200 записями (старые вытесняются)', () => {
    for (let i = 0; i < 250; i++) pushLogEntry('error', `e${i}`)
    const logs = getRecentLogs()
    expect(logs).toHaveLength(200)
    expect(logs[0].message).toBe('e50')
    expect(logs[199].message).toBe('e249')
  })

  it('пустой буфер отдаёт []', () => {
    expect(getRecentLogs()).toEqual([])
  })
})