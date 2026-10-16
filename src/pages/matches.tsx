import { useState, useEffect } from 'react'
import { useLanguage } from "@/context/language-context"
import { useRouter } from "@/shims/next-navigation"
import { getToken } from '@/lib/token'
import { Heart, MessageCircle, User as UserIcon, Loader2 } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

const PAGE_SIZE = 50

interface MatchUser {
  id: number
  user_id: number
  display_name?: string | null
  name?: string | null
  avatar_url?: string | null
  matched_at?: string
}

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export default function Matches() {
  const { t } = useLanguage()
  const router = useRouter()
  const [matches, setMatches] = useState<MatchUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => {
    fetch(`/api/matches?limit=${PAGE_SIZE}&offset=0`, { headers: authHeaders() })
      .then(r => r.json())
      .then((data: MatchUser[]) => {
        const list = Array.isArray(data) ? data : []
        setMatches(list)
        setHasMore(list.length === PAGE_SIZE)
      })
      .catch(() => setMatches([]))
      .finally(() => setLoading(false))
  }, [])

  const loadMore = () => {
    setLoadingMore(true)
    fetch(`/api/matches?limit=${PAGE_SIZE}&offset=${matches.length}`, { headers: authHeaders() })
      .then(r => r.json())
      .then((data: MatchUser[]) => {
        const list = Array.isArray(data) ? data : []
        setMatches(prev => [...prev, ...list])
        setHasMore(list.length === PAGE_SIZE)
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin" size={32} />
      </div>
    )
  }

  return (
    <div className="p-4 max-w-lg mx-auto space-y-4">
      <h1 className="text-2xl font-black flex items-center gap-2">
        <Heart className="text-primary" size={24} fill="currentColor" />
        {t('matches.title')}
      </h1>

      {matches.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Heart size={48} className="mx-auto mb-4 opacity-30" />
          <p>{t('matches.empty')}</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {matches.map(m => (
              <div key={m.user_id} className="flex items-center gap-3 p-3 rounded-xl bg-card border hover:shadow-md transition-shadow">
                <Avatar className="w-12 h-12">
                  <AvatarImage src={m.avatar_url || undefined} />
                  <AvatarFallback><UserIcon size={20} /></AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-bold truncate">{m.display_name || m.name}</p>
                  {m.matched_at && (
                    <p className="text-xs text-muted-foreground">{new Date(m.matched_at).toLocaleDateString()}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => router.push(`/chats/${m.user_id}`)}>
                  <MessageCircle size={16} className="mr-1" />
                  {t('matches.chat')}
                </Button>
              </div>
            ))}
          </div>
          {hasMore && (
            <Button variant="outline" className="w-full rounded-full" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="animate-spin mr-2" size={16} /> : null}
              {t('matches.load_more')}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
