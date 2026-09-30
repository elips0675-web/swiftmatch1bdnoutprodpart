export function dateOnly(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.split('T')[0]
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
