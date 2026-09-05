import { useState, useEffect, useCallback } from 'react'
import { INTEREST_OPTIONS, DATING_GOALS, EDUCATION_OPTIONS, CAPITALS } from './constants'
import { FORBIDDEN_WORDS_DEFAULT } from './admin-mock-data'

export interface ContentConfig {
  interests: string[]
  dating_goals: string[]
  education: string[]
  banned_words: string[]
  cities: string[]
}

const FALLBACK: ContentConfig = {
  interests: [...INTEREST_OPTIONS].sort(),
  dating_goals: [...DATING_GOALS],
  education: [...EDUCATION_OPTIONS],
  banned_words: [...FORBIDDEN_WORDS_DEFAULT],
  cities: [...CAPITALS],
}

let cached: ContentConfig | null = null
let loadingPromise: Promise<ContentConfig> | null = null
let version = 0
const listeners: Set<() => void> = new Set()

function notify() {
  listeners.forEach(fn => fn())
}

function normalizeInterests(items: string[]): string[] {
  return [...new Set(items.map(i => (i === 'technology' ? 'tech' : i)))]
}

function mapKeys(items: string[], prefix: string): string[] {
  return items.map(item => item.startsWith(prefix) ? item : prefix + item).sort()
}

async function fetchConfig(): Promise<ContentConfig> {
  try {
    const res = await fetch('/api/content')
    if (!res.ok) throw new Error('Failed to fetch')
    const data = await res.json()
    cached = {
      interests: mapKeys(normalizeInterests(data.interests || []), 'interest.'),
      dating_goals: mapKeys(data.dating_goals || [], 'goal.'),
      education: mapKeys(data.education || [], 'education.'),
      banned_words: data.banned_words || [],
      cities: data.cities || [],
    }
    return cached
  } catch {
    cached = FALLBACK
    return FALLBACK
  }
}

function getOrFetch(): Promise<ContentConfig> {
  if (cached) return Promise.resolve(cached)
  if (!loadingPromise) loadingPromise = fetchConfig()
  return loadingPromise
}

export function useContentConfig(): ContentConfig {
  const [config, setConfig] = useState<ContentConfig>(cached || FALLBACK)

  useEffect(() => {
    if (cached) return
    getOrFetch().then(setConfig)
  }, [])

  const forceRefresh = useCallback(() => {
    cached = null
    loadingPromise = null
    getOrFetch().then(setConfig)
  }, [])

  useEffect(() => {
    listeners.add(forceRefresh)
    return () => listeners.delete(forceRefresh)
  }, [forceRefresh])

  return config
}

export function getContentConfig(): Promise<ContentConfig> {
  return getOrFetch()
}

export function invalidateContentCache(): void {
  cached = null
  loadingPromise = null
  version++
  notify()
}
