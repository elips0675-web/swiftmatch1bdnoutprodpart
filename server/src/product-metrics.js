export const PRODUCT_METRIC_TARGETS = {
  like_rate: { target: 40, direction: 'min' },
  match_rate: { target: 20, direction: 'min' },
  d7_retention: { target: 15, direction: 'min' },
  first_message_hours: { target: 24, direction: 'max' },
}

function round1(value) {
  return Math.round(value * 10) / 10
}

function percent(part, whole) {
  if (!whole || whole <= 0) return null
  return (part / whole) * 100
}

function status(raw, target, direction) {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return 'unknown'
  return direction === 'max' ? (raw <= target ? 'ok' : 'warn') : (raw >= target ? 'ok' : 'warn')
}

function metric(key, raw) {
  const { target, direction } = PRODUCT_METRIC_TARGETS[key]
  return {
    key,
    value: raw === null || raw === undefined || !Number.isFinite(raw) ? null : round1(raw),
    unit: key === 'first_message_hours' ? 'h' : '%',
    target,
    direction,
    status: status(raw, target, direction),
  }
}

export function buildProductMetrics(counts = {}) {
  const registered = Number(counts.registered) || 0
  const liked = Number(counts.liked) || 0
  const matched = Number(counts.matched) || 0
  const d7Cohort = Number(counts.d7Cohort) || 0
  const d7Retained = Number(counts.d7Retained) || 0
  const messaged = Number(counts.messaged) || 0
  const avgSeconds = counts.avgSeconds === null || counts.avgSeconds === undefined || counts.avgSeconds === ''
    ? NaN
    : Number(counts.avgSeconds)
  const firstMessageHours = messaged > 0 && Number.isFinite(avgSeconds) && avgSeconds >= 0
    ? avgSeconds / 3600
    : null

  return {
    cohort: { registered, liked, matched, messaged, d7Cohort },
    metrics: [
      metric('like_rate', percent(liked, registered)),
      metric('match_rate', percent(matched, registered)),
      metric('d7_retention', percent(d7Retained, d7Cohort)),
      metric('first_message_hours', firstMessageHours),
    ],
  }
}
