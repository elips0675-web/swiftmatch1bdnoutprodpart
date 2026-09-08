import { createContext, useContext, useEffect, useReducer, useCallback, useRef, type ReactNode } from 'react'
import { getSupabase } from '@/lib/supabase'
import { setToken, getToken, clearToken } from '@/lib/token'
import type { AuthState } from '@/types'
import type { User, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
  clearError: () => void
  supabaseUser: User | null
  isDemo: boolean
}

type AuthAction =
  | { type: 'AUTH_START' }
  | { type: 'AUTH_SUCCESS'; payload: AuthState['user']; token: string }
  | { type: 'AUTH_FAILURE'; payload: string }
  | { type: 'AUTH_LOGOUT' }
  | { type: 'CLEAR_ERROR' }

const initialState: AuthState = {
  user: null,
  token: null,
  isLoading: true,
  error: null,
}

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'AUTH_START':
      return { ...state, isLoading: true, error: null }
    case 'AUTH_SUCCESS':
      return { user: action.payload, token: action.token, isLoading: false, error: null }
    case 'AUTH_FAILURE':
      return { ...state, isLoading: false, error: action.payload }
    case 'AUTH_LOGOUT':
      return { user: null, token: null, isLoading: false, error: null }
    case 'CLEAR_ERROR':
      return { ...state, error: null }
    default:
      return state
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState)
  const supabaseRef = useRef<SupabaseClient<Database> | null>(null)
  const supabase = getSupabase()
  supabaseRef.current = supabase
  const isDemo = !supabase

  useEffect(() => {
    if (!supabase) {
      const existing = getToken()
      if (existing) {
        try {
          const payload = JSON.parse(atob(existing.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
          dispatch({
            type: 'AUTH_SUCCESS',
            payload: { id: payload.userId, name: '', email: '', avatar: '' },
            token: existing,
          })
        } catch {
          dispatch({ type: 'AUTH_LOGOUT' })
        }
        return
      }
      // Web: JWT в httpOnly cookie — восстанавливаем сессию через /api/auth/me
      fetch('/api/auth/me')
        .then(res => res.ok ? res.json() : null)
        .then(me => {
          if (me?.id && me?.email) {
            dispatch({
              type: 'AUTH_SUCCESS',
              payload: { id: me.id, name: me.name || '', email: me.email, avatar: me.avatar || '' },
              token: 'cookie',
            })
            return
          }
          if (!import.meta.env.PROD) {
            return fetch('/api/auth/dev-login', { method: 'POST' })
              .then(res => res.ok ? res.json() : null)
              .then(data => {
                if (data?.token) {
                  setToken(data.token)
                  dispatch({
                    type: 'AUTH_SUCCESS',
                    payload: { id: 2, name: 'Анна', email: 'demo@mail.ru', avatar: '/demo/people/anna.png' },
                    token: data.token,
                  })
                } else {
                  dispatch({ type: 'AUTH_LOGOUT' })
                }
              })
          }
          dispatch({ type: 'AUTH_LOGOUT' })
        })
        .catch(() => dispatch({ type: 'AUTH_LOGOUT' }))
      return
    }

    let cancelled = false

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return
      if (event === 'SIGNED_IN' && session?.user) {
        const user = session.user
        dispatch({
          type: 'AUTH_SUCCESS',
          payload: {
            id: Number(user.id),
            name: user.user_metadata?.name || user.email?.split('@')[0] || '',
            email: user.email || '',
            avatar: user.user_metadata?.avatar_url || '',
          },
          token: session.access_token,
        })
      } else if (event === 'SIGNED_OUT') {
        dispatch({ type: 'AUTH_LOGOUT' })
      }
    })

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      if (session?.user) {
        const user = session.user
        dispatch({
          type: 'AUTH_SUCCESS',
          payload: {
            id: Number(user.id),
            name: user.user_metadata?.name || user.email?.split('@')[0] || '',
            email: user.email || '',
            avatar: user.user_metadata?.avatar_url || '',
          },
          token: session.access_token,
        })
      } else {
        dispatch({ type: 'AUTH_LOGOUT' })
      }
    })

    return () => {
      cancelled = true
      listener?.subscription.unsubscribe()
    }
  }, [supabase])

  const getClient = useCallback((): SupabaseClient<Database> => {
    const sb = supabaseRef.current
    if (!sb) throw new Error('Supabase not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
    return sb
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    dispatch({ type: 'AUTH_START' })
    try {
      const sb = getClient()
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (err: any) {
      dispatch({ type: 'AUTH_FAILURE', payload: err.message || 'Login failed' })
      throw err
    }
  }, [getClient])

  const loginWithGoogle = useCallback(async () => {
    dispatch({ type: 'AUTH_START' })
    try {
      const sb = getClient()
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google' })
      if (error) throw error
    } catch (err: any) {
      dispatch({ type: 'AUTH_FAILURE', payload: err.message || 'Google login failed' })
      throw err
    }
  }, [getClient])

  const register = useCallback(async (email: string, password: string, name: string) => {
    dispatch({ type: 'AUTH_START' })
    try {
      const sb = getClient()
      const { error } = await sb.auth.signUp({
        email, password,
        options: { data: { name } },
      })
      if (error) throw error
    } catch (err: any) {
      dispatch({ type: 'AUTH_FAILURE', payload: err.message || 'Registration failed' })
      throw err
    }
  }, [getClient])

  const logout = useCallback(async () => {
    try {
      const sb = supabaseRef.current
      if (sb) await sb.auth.signOut()
    } catch { /* ignore */ }
    Promise.resolve(fetch('/api/auth/logout', { method: 'POST' })).catch(() => {})
    clearToken()
    dispatch({ type: 'AUTH_LOGOUT' })
  }, [])

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' })
  }, [])

  const supabaseUser = state.user
    ? ({ id: String(state.user.id), email: state.user.email, user_metadata: { name: state.user.name, avatar_url: state.user.avatar } } as User)
    : null

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        loginWithGoogle,
        register,
        logout,
        clearError,
        supabaseUser,
        isDemo,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
