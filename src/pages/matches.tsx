import { useState, useEffect } from 'react'
import { useLanguage } from "@/context/language-context"
import { useRouter } from "@/shims/next-navigation"
import { getToken } from '@/lib/token'
import { Heart, MessageCircle, User as UserIcon, Loader2 } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"

interface MatchUser {
  id: number
  name: string
  photo?: string
  match_date?: string
}

export default function Matches() {
  const { t } = useLanguage()
  const router = useRouter()
  const [matches, setMatches] = useState<MatchUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getToken()
    fetch('/api/matches', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then((data: MatchUser[]) => setMatches(Array.isArray(data) ? data : []))
      .catch(() => setMatches([]))
      .finally(() => setLoading(false))
  }, [])

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
        <div className="space-y-2">
          {matches.map(m => (
            <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-card border hover:shadow-md transition-shadow">
              <Avatar className="w-12 h-12">
                <AvatarImage src={m.photo} />
                <AvatarFallback><UserIcon size={20} /></AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-bold truncate">{m.name}</p>
                {m.match_date && (
                  <p className="text-xs text-muted-foreground">{new Date(m.match_date).toLocaleDateString()}</p>
                )}
              </div>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => router.push(`/chats/${m.id}`)}>
                <MessageCircle size={16} className="mr-1" />
                {t('matches.chat')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
