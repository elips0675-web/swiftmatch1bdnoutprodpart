import { rootLogger } from './logger.js'
import { readFile } from 'fs/promises'

// ─── Config ───────────────────────────────────────────────────
const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'

let openaiClient = null
let rekognitionClient = null

// ─── Lazy init ─────────────────────────────────────────────────
async function getOpenAI() {
  if (openaiClient !== null) return openaiClient
  if (!OPENAI_API_KEY) { openaiClient = false; return false }
  try {
    const OpenAI = (await import('openai')).default
    openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY })
  } catch (err) {
    rootLogger.warn('AI moderation: OpenAI init failed:', err.message)
    openaiClient = false
  }
  return openaiClient
}

async function getRekognition() {
  if (rekognitionClient !== null) return rekognitionClient
  if (!process.env.AWS_ACCESS_KEY_ID) { rekognitionClient = false; return false }
  try {
    const { RekognitionClient } = await import('@aws-sdk/client-rekognition')
    rekognitionClient = new RekognitionClient({ region: AWS_REGION })
  } catch (err) {
    rootLogger.warn('AI moderation: Rekognition init failed:', err.message)
    rekognitionClient = false
  }
  return rekognitionClient
}

// ─── Text moderation ───────────────────────────────────────────
// Returns { safe: boolean, reasons: string[], confidence: number }
export async function moderateText(text) {
  const client = await getOpenAI()
  if (client) {
    try {
      const response = await client.moderations.create({ input: text })
      const result = response.results[0]
      const categories = Object.entries(result.categories)
        .filter(([, flagged]) => flagged)
        .map(([key]) => key)
      return {
        safe: !result.flagged,
        reasons: categories,
        confidence: result.category_scores?.hate || 0,
        source: 'openai',
      }
    } catch (err) {
      rootLogger.warn('AI moderation: OpenAI API error:', err.message)
    }
  }

  // Fallback: regex-based heuristic
  return heuristicTextModeration(text)
}

function heuristicTextModeration(text) {
  const lower = text.toLowerCase()
  const patterns = [
    { key: 'explicit_sexual', re: /porn|xxx|sex\s+(video|chat|cam)/i },
    { key: 'hate_speech', re: /\b(kill|die|hate)\s+(all|every|you)\b/i },
    { key: 'spam', re: /follow\s+(me|for)|click\s+(here|link)|free\s+(money|cash)/i },
    { key: 'personal_info', re: /\b\d{10,}\b|\b[\w.-]+@[\w.-]+\.\w{2,}\b/ },
    { key: 'violence', re: /\b(shoot|stab|bomb|attack|hurt)\s+(you|someone|people)\b/i },
  ]

  const found = patterns.filter(({ re }) => re.test(lower)).map(({ key }) => key)
  return {
    safe: found.length === 0,
    reasons: found,
    confidence: found.length > 0 ? 0.6 : 0.95,
    source: 'heuristic',
  }
}

// ─── Image moderation ──────────────────────────────────────────
// Returns { safe: boolean, reasons: string[], labels: string[] }
export async function moderateImage(filePath) {
  const client = await getRekognition()
  if (client) {
    try {
      const { DetectModerationLabelsCommand } = await import('@aws-sdk/client-rekognition')
      const imageBuffer = await readFile(filePath)
      const command = new DetectModerationLabelsCommand({
        Image: { Bytes: imageBuffer },
        MinConfidence: 70,
      })
      const response = await client.send(command)
      const labels = response.ModerationLabels || []
      const unsafe = labels.filter(l => l.ParentName !== 'Safe' && l.ParentName !== 'Neutral')
      return {
        safe: unsafe.length === 0,
        reasons: unsafe.map(l => l.Name),
        labels: labels.map(l => `${l.Name} (${Math.round(l.Confidence)}%)`),
        source: 'rekognition',
      }
    } catch (err) {
      rootLogger.warn('AI moderation: Rekognition error:', err.message)
    }
  }

  // Fallback: без вердикта AI фото НЕ одобряем автоматически (fail-closed).
  // Статус остаётся тем, что выставил INSERT (в проде — 'pending' до ручной проверки).
  rootLogger.warn(`AI moderation: no Rekognition verdict, ${filePath} left unmoderated`)
  return { safe: null, reasons: ['moderation_unavailable'], labels: [], source: 'none' }
}

// ─── Bulk profile review ───────────────────────────────────────
export async function reviewProfile(profile) {
  const textFields = [profile.display_name, profile.bio, profile.city].filter(Boolean).join(' ')
  return moderateText(textFields)
}

export function isAIModerationConfigured() {
  return !!(OPENAI_API_KEY || process.env.AWS_ACCESS_KEY_ID)
}
