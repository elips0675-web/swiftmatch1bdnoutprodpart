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

export function isAIModerationConfigured() {
  return Boolean(process.env.OPENAI_API_KEY || process.env.AWS_ACCESS_KEY_ID)
}

export function allowUnmoderatedPhotos() {
  if (isProduction()) return false
  if (process.env.NODE_ENV === 'test') {
    return process.env.ALLOW_UNMODERATED_PHOTOS !== 'false'
  }
  return process.env.ALLOW_UNMODERATED_PHOTOS === 'true'
}

export function requirePhotoModerationOrRefuse(res) {
  const prod = isProduction()
  const hasMod = isAIModerationConfigured()
  const allow = allowUnmoderatedPhotos()
  if (hasMod) return false
  if (!prod && allow) return false
  res.status(503).json({
    message: prod ? 'Photo moderation not configured for production' : 'Photo moderation not configured',
    code: 'PHOTO_MODERATION_UNAVAILABLE',
  })
  return true
}

export function integrationModes() {
  const mod = isAIModerationConfigured()
    ? 'live'
    : allowUnmoderatedPhotos()
      ? 'mock'
      : isProduction()
        ? 'unavailable'
        : 'mock'
  return {
    stripe: stripeIsConfigured() ? 'live' : 'mock',
    smtp: process.env.SMTP_HOST ? 'live' : 'mock',
    sms: process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN ? 'live' : 'mock',
    fcm: process.env.FCM_SERVER_KEY || process.env.FCM_SERVICE_ACCOUNT ? 'live' : 'mock',
    redis: process.env.REDIS_URL ? 'live' : 'mock',
    moderation: mod,
  }
}
