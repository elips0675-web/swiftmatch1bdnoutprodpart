import { describe, it, expect, vi, afterEach } from 'vitest'
import winstonLogger, { createLogger } from '../logger.js'

describe('createLogger: стрелки error/debug уходят в winston', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('error кладёт message и stack Error-объекта', () => {
    const spy = vi.spyOn(winstonLogger, 'error').mockImplementation(() => winstonLogger)
    const log = createLogger('rid-err')
    const err = new Error('boom')
    log.error('failed', err)
    expect(spy).toHaveBeenCalledWith('failed', { rid: 'rid-err', err: 'boom', stack: err.stack })
  })

  it('error с не-Error значением отдаёт его как err без стека', () => {
    const spy = vi.spyOn(winstonLogger, 'error').mockImplementation(() => winstonLogger)
    const log = createLogger('rid-plain')
    log.error('plain', 'oops')
    expect(spy).toHaveBeenCalledWith('plain', { rid: 'rid-plain', err: 'oops', stack: undefined })
  })

  it('debug уходит в winston с rid', () => {
    const spy = vi.spyOn(winstonLogger, 'debug').mockImplementation(() => winstonLogger)
    const log = createLogger('rid-dbg')
    log.debug('trace')
    expect(spy).toHaveBeenCalledWith('trace', { rid: 'rid-dbg' })
  })
})
