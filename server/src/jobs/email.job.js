import nodemailer from 'nodemailer'
import { rootLogger } from '../logger.js'

const RETRY_MAX = 3
const RETRY_DELAY_MS = 1000

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createTransporter() {
  const host = process.env.SMTP_HOST
  if (!host) return null

  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) {
    rootLogger.warn('[email-job] SMTP_USER or SMTP_PASS not set')
    return null
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user, pass },
  })
}

const FROM = process.env.SMTP_FROM || 'noreply@swiftmatch.app'
const WEB_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:8081'

export default async function processEmail(job) {
  const { to, subject, html, type, token } = job.data

  const transport = createTransporter()
  if (!transport) {
    rootLogger.info(`[email-job] SMTP not configured. Would send to ${to}: "${subject}"`)
    return { skipped: true }
  }

  let htmlContent = html
  if (type === 'password-reset') {
    const resetUrl = `${WEB_ORIGIN}/reset-password?token=${token}`
    htmlContent = `<p>Click <a href="${resetUrl}">here</a> to reset your password. This link expires in 1 hour.</p>`
  } else if (type === 'verify-email') {
    const verifyUrl = `${WEB_ORIGIN}/verify-email?token=${token}`
    htmlContent = `<p>Click <a href="${verifyUrl}">here</a> to verify your email address.</p>`
  }

  let lastError
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      await transport.sendMail({ from: FROM, to, subject, html: htmlContent })
      rootLogger.info(`[email-job] Sent to ${to}: "${subject}"`)
      return { sent: true }
    } catch (err) {
      lastError = err
      rootLogger.error(`[email-job] Attempt ${attempt}/${RETRY_MAX} failed for ${to}: ${err.message}`)
      if (attempt < RETRY_MAX) await sleep(RETRY_DELAY_MS * attempt)
    }
  }

  throw lastError
}
