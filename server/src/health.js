import pool from './db.js'
import { integrationModes } from './runtime.js'

export async function healthHandler(req, res) {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'connected', integrations: integrationModes() })
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected', integrations: integrationModes() })
  }
}
