import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'swiftmatch',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_MAX) || 20,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
})

const originalQuery = pool.query.bind(pool)
pool.query = async (sql, params) => {
  const start = Date.now()
  const result = await originalQuery(sql, params)
  const duration = (Date.now() - start) / 1000
  try {
    const { trackDbQuery } = await import('./metrics.js')
    trackDbQuery(typeof sql === 'string' ? sql : sql.sql, duration)
  } catch {}
  return result
}

export default pool
