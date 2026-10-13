import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getSupabase } from '@/lib/supabase'
import { useAuth as useAuthContext } from '@/context/auth-context'
import type { ProfileRow } from '@/types/supabase'

interface DocState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

interface CollectionState<T> {
  data: T[]
  loading: boolean
  error: string | null
}

interface FirebaseUser {
  uid: string
  email: string | null
  displayName: string | null
  photoURL: string | null
}

const Ctx = createContext<null>(null)

export const FirebaseClientProvider = ({ children }: { children: ReactNode }) => {
  return <Ctx.Provider value={null}>{children}</Ctx.Provider>
}

export function useFirebase() {
  return null
}

export function useFirestore() {
  return null
}

export function useAuth(): { user: FirebaseUser | null; loading: boolean } {
  const { supabaseUser, isLoading } = useAuthContext()
  if (!supabaseUser) return { user: null, loading: isLoading }

  return {
    user: {
      uid: supabaseUser.id,
      email: supabaseUser.email ?? null,
      displayName: supabaseUser.user_metadata?.name ?? null,
      photoURL: supabaseUser.user_metadata?.avatar_url ?? null,
    },
    loading: isLoading,
  }
}

export function useStorage() {
  return null
}

export async function uploadProfilePhoto(file: File): Promise<string | null> {
  try {
    const supabase = getSupabase()
    if (!supabase) return null
    const ext = file.name.split('.').pop()
    const path = `profiles/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from('photos').upload(path, file)
    if (error) throw error
    const { data: url } = supabase.storage.from('photos').getPublicUrl(path)
    return url.publicUrl
  } catch {
    return null
  }
}

export function useUser(): DocState<FirebaseUser> {
  const { supabaseUser, isLoading } = useAuthContext()
  if (!supabaseUser) return { data: null, loading: isLoading, error: null }
  return {
    data: {
      uid: supabaseUser.id,
      email: supabaseUser.email ?? null,
      displayName: supabaseUser.user_metadata?.name ?? null,
      photoURL: supabaseUser.user_metadata?.avatar_url ?? null,
    },
    loading: isLoading,
    error: null,
  }
}

export function useDoc<T = ProfileRow>(collection: string, id?: string): DocState<T> {
  const [state, setState] = useState<DocState<T>>({ data: null, loading: true, error: null })

  useEffect(() => {
    if (!id) {
      setState({ data: null, loading: false, error: null })
      return
    }

    const supabase = getSupabase()
    if (!supabase) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let cancelled = false

    supabase
      .from(collection as 'profiles')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (!cancelled) {
          setState({ data: data as T | null, loading: false, error: error?.message ?? null })
        }
      })

    return () => { cancelled = true }
  }, [collection, id])

  return state
}

export function useCollection<T = ProfileRow>(collection: string): CollectionState<T> {
  const [state, setState] = useState<CollectionState<T>>({ data: [], loading: true, error: null })

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setState({ data: [], loading: false, error: null })
      return
    }
    let cancelled = false

    supabase
      .from(collection as 'profiles')
      .select('*')
      .limit(50)
      .then(({ data, error }) => {
        if (!cancelled) {
          setState({ data: (data ?? []) as T[], loading: false, error: error?.message ?? null })
        }
      })

    return () => { cancelled = true }
  }, [collection])

  return state
}

export function useMemoFirebase<T>(factory: () => T, _deps: unknown[]) {
  return factory()
}

type EventHandler = (...args: unknown[]) => void

export const errorEmitter = {
  on(_event: string, _handler: EventHandler) {},
  off(_event: string, _handler: EventHandler) {},
  emit(_event: string, ..._args: unknown[]) {},
}
