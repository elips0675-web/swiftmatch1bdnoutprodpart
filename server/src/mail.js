import { emailQueue } from './queue.js'
import { rootLogger } from './logger.js'

let directSendWarned = false

// Контракт: ни одна из send*() не бросает наружу. Вызовы в auth.js — fire-and-forget
// без .catch(), а Node завершает процесс на unhandled rejection. Падение SMTP или
// очереди не должно ломать регистрацию, вход и сброс пароля.
async function queueMail(data) {
  if (emailQueue) {
    try {
      await emailQueue.add(data)
      return { queued: true }
    } catch (err) {
      rootLogger.error(`[mail] queue add failed for ${data.to}: ${err.message}`)
      return { failed: true, error: err.message }
    }
  }

  if (!directSendWarned) {
    directSendWarned = true
    rootLogger.warn('[mail] Email queue unavailable — sending directly via SMTP (no queue retries)')
  }

  try {
    const { default: processEmail } = await import('./jobs/email.job.js')
    return await processEmail({ data })
  } catch (err) {
    rootLogger.error(`[mail] direct send failed for ${data.to}: ${err.message}`)
    return { failed: true, error: err.message }
  }
}

const FROM = process.env.SMTP_FROM || process.env.EMAIL_FROM || 'noreply@swiftmatch.app'
if (!process.env.SMTP_FROM && !process.env.EMAIL_FROM && process.env.NODE_ENV === 'production') {
  rootLogger.warn('[mail] SMTP_FROM not configured — using default noreply@swiftmatch.app')
}

export async function sendPasswordResetEmail(to, token) {
  return queueMail({
    to,
    subject: 'Reset your SwiftMatch password',
    type: 'password-reset',
    token,
    from: FROM,
  })
}

export async function sendVerificationEmail(to, token) {
  return queueMail({
    to,
    subject: 'Verify your SwiftMatch email',
    type: 'verify-email',
    token,
    from: FROM,
  })
}

export async function sendCustomEmail(to, subject, html) {
  return queueMail({ to, subject, html, from: FROM })
}
