import { useEffect, useState, useCallback } from 'react'
import { getSupabase } from './supabase'
import type { MessageRow, ProfileRow } from '@/types/supabase'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export function useRealtimeMessages(chatId: string | undefined) {
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!chatId) {
      setMessages([])
      setLoading(false)
      return
    }

    const supabase = getSupabase()
    if (!supabase) {
      setMessages([])
      setLoading(false)
      return
    }

    supabase
      .from('messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setMessages((data ?? []) as MessageRow[])
        setLoading(false)
      })

    const channel = supabase
      .channel(`messages:${chatId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload: RealtimePostgresChangesPayload<MessageRow>) => {
          const newMsg = payload.new as MessageRow
          setMessages((prev) => [...prev, newMsg])
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [chatId])

  const sendMessage = useCallback(
    async (text: string, senderId: string, replyTo?: string) => {
      if (!chatId || !text.trim()) return
      const supabase = getSupabase()
      if (!supabase) return
      await supabase.from('messages').insert({
        chat_id: chatId,
        sender_id: senderId,
        text: text.trim(),
        reply_to: replyTo ?? null,
      })
    },
    [chatId],
  )

  return { messages, loading, sendMessage }
}

export function useProfile(id: string | undefined) {
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) {
      setLoading(false)
      return
    }

    const supabase = getSupabase()
    if (!supabase) {
      setLoading(false)
      return
    }
    let cancelled = false

    supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setProfile(data as ProfileRow | null)
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [id])

  return { profile, loading }
}

export function useNearbyProfiles(options?: {
  city?: string
  ageMin?: number
  ageMax?: number
  goal?: string
}) {
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setProfiles([])
      setLoading(false)
      return
    }
    let query = supabase.from('user_search').select('*')

    if (options?.city) query = query.eq('city', options.city)
    if (options?.ageMin) query = query.gte('age', options.ageMin)
    if (options?.ageMax) query = query.lte('age', options.ageMax)
    if (options?.goal) query = query.eq('goal', options.goal)

    query.limit(50).then(({ data }) => {
      setProfiles(data as unknown as ProfileRow[])
      setLoading(false)
    })
  }, [options?.city, options?.ageMin, options?.ageMax, options?.goal])

  return { profiles, loading }
}
