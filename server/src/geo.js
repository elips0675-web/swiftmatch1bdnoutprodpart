// Радиус geo-поиска приходит из query-строки как строка и раньше уезжал в SQL как
// есть: Number('abc') → NaN, отрицательные значения давали пустую выдачу, а
// radius=10000000 превращал HAVING в no-op. Клампим в километрах в разумном
// диапазоне, чтобы мусорный ввод давал предсказуемую выдачу, а не тишину.

export const RADIUS_DEFAULT_KM = 50
export const RADIUS_MIN_KM = 1
export const RADIUS_MAX_KM = 500

// null — радиус не задан, вызывающий решает сам (например, не добавлять фильтр).
export function parseRadiusKm(value) {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return RADIUS_DEFAULT_KM
  return Math.min(Math.max(n, RADIUS_MIN_KM), RADIUS_MAX_KM)
}
