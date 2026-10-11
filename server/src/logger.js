import winston from 'winston'
import path from 'path'
import { fileURLToPath } from 'url'
import { pushLogEntry } from './log-buffer.js'

const LOG_LEVEL = process.env.LOG_LEVEL || 'info'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * G3 #36: файл лога. Текст ошибки жил только в stdout процесса из bat —
 * теперь дублируется в server/logs/api.log (путь переопределяется LOG_FILE).
 * В тестах (NODE_ENV=test, vitest) файловый транспорт не подключается.
 */
function buildFileTransport() {
  if (process.env.NODE_ENV === 'test') return null
  const logFile = process.env.LOG_FILE || path.join(__dirname, '../logs/api.log')
  return new winston.transports.File({ filename: logFile, maxsize: 10 * 1024 * 1024, maxFiles: 3, tailable: true })
}

/**
 * Транспорт-буфер последних warn/error (G3 #36): наполняет log-buffer,
 * из которого админ-эндпоинт GET /api/admin/logs/recent отдаёт последние
 * ошибки без доступа к stdout процесса.
 */
class RecentBufferTransport extends winston.Transport {
  log(info, callback) {
    if (info.level === 'error' || info.level === 'warn') {
      pushLogEntry(info.level, info.message, {
        ts: info.timestamp,
        error: info.err?.message || info.error || null,
        stack: info.err?.stack || info.stack || null,
        rid: info.rid || null,
      })
    }
    callback()
  }
}

const fileTransport = buildFileTransport()

const winstonLogger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: 'swiftmatch-api' },
  transports: [
    new winston.transports.Console(),
    new RecentBufferTransport(),
    ...(fileTransport ? [fileTransport] : []),
  ],
})

export function createLogger(rid) {
  return {
    error: (msg, err) => winstonLogger.error(msg, { rid, err: err?.message || err, stack: err?.stack }),
    warn: (msg) => winstonLogger.warn(msg, { rid }),
    info: (msg) => winstonLogger.info(msg, { rid }),
    debug: (msg) => winstonLogger.debug(msg, { rid }),
  }
}

export const rootLogger = createLogger('bootstrap')
export default winstonLogger