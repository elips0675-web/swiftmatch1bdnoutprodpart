export function isProduction() {
  return process.env.NODE_ENV === 'production'
}

export function stripeIsConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function stripeIsLiveMode() {
  return process.env.STRIPE_LIVE === 'true'
}

export function refuseMockPayment(res) {
  const prod = isProduction()
  const live = stripeIsLiveMode()
  if (!prod && !live) return false
  res.status(503).json({
    message: prod ? 'Stripe not configured for production' : 'Stripe not configured in live mode',
    code: 'STRIPE_NOT_CONFIGURED',
  })
  return true
}

export function integrationModes() {
  return {
    stripe: stripeIsConfigured() ? 'live' : 'mock',
    smtp: process.env.SMTP_HOST ? 'live' : 'mock',
    sms: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? 'live' : 'mock',
    fcm: process.env.FCM_SERVER_KEY || process.env.FCM_SERVICE_ACCOUNT ? 'live' : 'mock',
    redis: process.env.REDIS_URL ? 'live' : 'mock',
  }
}
