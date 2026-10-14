const PRIVATE_NETWORKS = 'uniquelocal'

export function resolveTrustProxy(raw = process.env.TRUST_PROXY) {
  const value = raw === undefined || raw === null ? '' : String(raw).trim()
  if (value === '') return PRIVATE_NETWORKS
  const lower = value.toLowerCase()
  if (lower === 'false' || lower === 'off' || lower === '0') return false
  if (lower === 'true' || lower === 'on') return PRIVATE_NETWORKS
  const hops = Number(value)
  if (!Number.isNaN(hops)) return Number.isInteger(hops) && hops >= 1 ? hops : false
  return value
}
