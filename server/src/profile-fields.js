/**
 * Нормализация значений профиля перед записью в MySQL.
 *
 * Пустая строка из number/select-инпута — это не значение, а «пользователь не
 * заполнил». Раньше такие значения уходили в COALESCE(?, col) как '' и MySQL
 * отвечал ER_WARN_DATA_OUT_OF_RANGE / ER_DATA_TOO_LONG, а маршрут отдавал 500 на
 * весь PUT: одно незаполненное поле ровно одно блокировало сохранение всех
 * остальных (воспроизведено пробой: '', gender=bogus, height=-5 -> 500).
 *
 * Правила:
 *  - текст: '' — законное значение (пользователь очистил поле), undefined —
 *    «поле не прислали», COALESCE оставит прежнее; длиннее колонки — обрезаем,
 *    чтобы не было 500 на ER_DATA_TOO_LONG;
 *  - число / ENUM / дата: '' , null, undefined — «не прислали»; непригодное
 *    значение — 400 с именем поля, потому что это ошибка клиента, а не сервера.
 */

export class FieldError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'FieldError'
    this.field = field
    this.status = 400
  }
}

const BLANK = new Set(['', null, undefined])

/** Пустое значение -> undefined, чтобы COALESCE оставило прежнее. */
export function blankToUndef(value) {
  if (BLANK.has(value)) return undefined
  return value
}

/**
 * Текстовое поле под размер колонки. Пустая строка сохраняется как есть:
 * так пользователь может очистить город или био.
 */
export function textField(value, max) {
  if (value === undefined || value === null) return undefined
  const s = typeof value === 'string' ? value : String(value)
  return s.length > max ? s.slice(0, max) : s
}

/**
 * Целое поле. Пустое -> undefined (не трогаем). Не число или вне диапазона ->
 * 400 с именем поля. zeroBlank нужен для производных полей (age приходит и с
 * нулевым значением, когда возраст не задан).
 */
export function intField(value, field, { min = -Infinity, max = Infinity, zeroBlank = false } = {}) {
  const v = blankToUndef(value)
  if (v === undefined) return undefined
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) throw new FieldError(field, `${field} must be a number`)
  if (zeroBlank && n === 0) return undefined
  const i = Math.trunc(n)
  if (i < min || i > max) throw new FieldError(field, `${field} must be between ${min} and ${max}`)
  return i
}

/** Дробное поле (координаты). Пустое -> undefined. */
export function numField(value, field, { min = -Infinity, max = Infinity } = {}) {
  const v = blankToUndef(value)
  if (v === undefined) return undefined
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) throw new FieldError(field, `${field} must be a number`)
  if (n < min || n > max) throw new FieldError(field, `${field} must be between ${min} and ${max}`)
  return n
}

/** Значение из фиксированного набора (ENUM). Пустое -> undefined. */
export function enumField(value, field, allowed) {
  const v = blankToUndef(value)
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !allowed.includes(v)) {
    throw new FieldError(field, `${field} must be one of: ${allowed.join(', ')}`)
  }
  return v
}

/** Дата YYYY-MM-DD. Пустое -> undefined. Разобранное -> строка без сдвига часового пояса. */
export function dateField(value, field) {
  const v = blankToUndef(value)
  if (v === undefined) return undefined
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new FieldError(field, `${field} must be YYYY-MM-DD`)
  }
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new FieldError(field, `${field} is not a real date`)
  }
  return v
}
