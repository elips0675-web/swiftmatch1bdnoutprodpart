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

export function liveHandler(req, res) {
  res.json({ status: 'ok' })
}

export async function readyHandler(req, res) {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ready' })
  } catch {
    res.status(503).json({ status: 'unavailable' })
  }
}
