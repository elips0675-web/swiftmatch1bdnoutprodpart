import { Router } from 'express'
import { auth } from '../middleware.js'
import pool from '../db.js'
import { rootLogger } from '../logger.js'
import { createBreaker } from '../circuit-breaker.js'
import { activeUser } from '../active-user.js'
import { notBlocked } from '../user-blocks.js'

const router = Router()

const OPENAI_API_KEY = process.env.OPENAI_API_KEY

const openaiBreaker = createBreaker(
  async ({ target, lang }) => {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: OPENAI_API_KEY })
    const context = target
      ? `User profile: ${target.display_name}, ${target.age} y.o., from ${target.city || 'unknown'}, bio: "${target.bio || ''}", dating goal: ${target.dating_goal || 'unknown'}.`
      : 'User profile unknown.'
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a dating app assistant. Suggest 3 short, friendly, personalized icebreakers (${lang === 'ru' ? 'in Russian' : 'in English'}, 1 sentence each, no questions marks spam, casual tone) to start a chat. Output ONLY a JSON array of strings.`,
        },
        { role: 'user', content: context },
      ],
      temperature: 0.9,
      max_tokens: 200,
    })
    const raw = response.choices[0]?.message?.content || '[]'
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.slice(0, 3)
    return null
  },
  'openai-icebreakers',
  { timeout: 9000, volumeThreshold: 3 },
)

function randomQuestions(rows, n) {
  const shuffled = [...rows].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

// POST /api/icebreakers/suggest — personalized conversation starters
// body: { chat_user_id, language?: 'ru'|'en' }
router.post('/api/icebreakers/suggest', auth, async (req, res) => {
  try {
    const { chat_user_id, language = 'ru' } = req.body
    if (!chat_user_id) {
      return res.status(400).json({ error: 'MISSING_CHAT_USER_ID' })
    }
    const lang = language === 'en' ? 'en' : 'ru'

    const blockFilter = notBlocked('up', req.userId)
    const [profiles] = await pool.query(
      `SELECT up.display_name, up.age, up.bio, up.city, up.dating_goal, up.zodiac
       FROM user_profiles up
       WHERE up.id = ? AND ${activeUser('up')} AND ${blockFilter.sql}`,
      [chat_user_id, ...blockFilter.params],
    )
    const target = profiles[0]

    if (OPENAI_API_KEY) {
      try {
        const suggestions = await openaiBreaker.fire({ target, lang })
        if (suggestions && suggestions.length > 0) {
          return res.json({ source: 'openai', suggestions })
        }
      } catch (err) {
        rootLogger.warn('Icebreakers: OpenAI breaker failed, falling back to DB:', err.message)
      }
    }

    const [themes] = await pool.query(
      `SELECT id, key_id, icon FROM icebreaker_themes ORDER BY sort_order`,
    )
    if (themes.length === 0) {
      return res.json({
        source: 'static',
        suggestions: [
          'Какое твое любимое хобби?',
          'Где ты любишь отдыхать?',
          'Какой фильм посоветуешь?',
        ],
      })
    }

    const themeIds = themes.map(t => t.id)
    const placeholders = themeIds.map(() => '?').join(',')
    const [questions] = await pool.query(
      `SELECT id, theme_id, text_ru, text_en FROM icebreaker_questions
       WHERE theme_id IN (${placeholders}) ORDER BY RAND()`,
      themeIds,
    )

    const textKey = lang === 'en' ? 'text_en' : 'text_ru'
    const byTheme = {}
    questions.forEach(q => {
      if (!byTheme[q.theme_id]) byTheme[q.theme_id] = []
      byTheme[q.theme_id].push(q)
    })

    const suggestions = []
    const usedThemeIds = new Set()
    while (suggestions.length < 3) {
      const remaining = themes.filter(t => !usedThemeIds.has(t.id))
      if (remaining.length === 0) break
      const theme = remaining[Math.floor(Math.random() * remaining.length)]
      const poolQ = byTheme[theme.id] || []
      if (poolQ.length > 0) {
        suggestions.push(poolQ[Math.floor(Math.random() * poolQ.length)][textKey])
      }
      usedThemeIds.add(theme.id)
    }

    return res.json({ source: 'db', suggestions })
  } catch (err) {
    rootLogger.error('Icebreakers suggest error:', err)
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Failed to suggest icebreakers' })
  }
})

export default router