import { rootLogger } from './logger.js'

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER
const TWILIO_API_BASE_URL = process.env.TWILIO_API_BASE_URL

let twilioClient = null
let initAttempted = false

async function getClient() {
  if (initAttempted) return twilioClient
  initAttempted = true
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    rootLogger.info('SMS: Twilio not configured — using mock')
    return null
  }
  try {
    const twilio = await import('twilio')
    twilioClient = twilio.default(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    if (TWILIO_API_BASE_URL) twilioClient.api.baseUrl = TWILIO_API_BASE_URL
  } catch (err) {
    rootLogger.warn('SMS: Twilio client init failed:', err.message)
  }
  return twilioClient
}

export async function sendSMS(to, body) {
  const client = await getClient()
  if (!client) {
    rootLogger.info(`[SMS MOCK] To: ${to}, Body: ${body}`)
    return { success: true, mock: true }
  }
  try {
    const message = await client.messages.create({
      body,
      from: TWILIO_PHONE_NUMBER,
      to,
    })
    rootLogger.info(`SMS sent to ${to}: sid=${message.sid}`)
    return { success: true, sid: message.sid }
  } catch (err) {
    rootLogger.error(`SMS send failed to ${to}:`, err.message)
    return { success: false, error: err.message }
  }
}

export async function isSMSConfigured() {
  const client = await getClient()
  return !!client
}
