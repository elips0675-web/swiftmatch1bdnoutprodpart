import mysql from 'mysql2/promise'

// Удаляет тестовые данные после прогона E2E: юзеры e2e_* и layout_*,
// остальное подчищается FK-каскадами (hangouts, likes, chats, messages и т.д.).
// Позволяет многократно гонять E2E без замусоривания боевой БД.
export default async function globalTeardown() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'swiftmatch',
  })

  try {
    const [rows] = await conn.execute(
      "SELECT id FROM users WHERE email LIKE 'e2e\\_%' OR email LIKE 'layout\\_%'",
    )
    const ids = (rows as Array<{ id: number }>).map((r) => r.id)
    if (ids.length > 0) {
      await conn.execute('DELETE FROM users WHERE id IN (?)', [ids])
      console.log(`🧹 E2E teardown: deleted ${ids.length} test users`)
    } else {
      console.log('🧹 E2E teardown: nothing to delete')
    }
  } finally {
    await conn.end()
  }
}