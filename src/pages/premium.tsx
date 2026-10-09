import { useState, useEffect } from 'react'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useLanguage } from "@/context/language-context"
import { useRouter } from "@/shims/next-navigation"
import { Sparkles, Check, Zap, Eye, ShieldCheck, Star, Loader2, ArrowLeft } from "lucide-react"
import { motion } from 'framer-motion'
import { getToken } from '@/lib/token'
import { isNative } from '@/lib/native'
import { purchaseWithIAP } from '@/lib/iap'
import { useTrackEvent } from '@/hooks/useExperiment'
import { toast } from 'sonner'

interface Tier {
  id: string
  name: string
  price: number
  duration_months: number
  features: string[]
}

const DURATIONS = [
  { months: 1, discount: 0 },
  { months: 6, discount: 20 },
  { months: 12, discount: 40 },
]

function formatPrice(price: number, locale: string = 'ru-RU'): string {
  return price.toLocaleString(locale === 'EN' ? 'en-US' : 'ru-RU') + ' ₽'
}

export default function Premium() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [tiers, setTiers] = useState<Tier[]>([])
  const [selectedTier, setSelectedTier] = useState('')
  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[0].months)
  const [loading, setLoading] = useState(false)
  const trackEvent = useTrackEvent()

  useEffect(() => {
    fetch('/api/premium/tiers')
      .then(r => r.json())
      .then((data: Tier[]) => {
        setTiers(data)
        if (data.length > 0) setSelectedTier(data[0].id)
      })
      .catch(() => {
        setTiers([
          { id: 'plus', name: 'Plus', price: 299, duration_months: 1, features: ['5 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня'] },
          { id: 'gold', name: 'Gold', price: 699, duration_months: 1, features: ['10 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки'] },
          { id: 'platinum', name: 'Platinum', price: 1499, duration_months: 1, features: ['∞ суперлайков', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки', 'Персональный консьерж'] },
        ])
        setSelectedTier('gold')
      })
  }, [])

  const activeTier = tiers.find(t => t.id === selectedTier)
  const totalPrice = activeTier ? activeTier.price * selectedDuration * (1 - (DURATIONS.find(d => d.months === selectedDuration)?.discount || 0) / 100) : 0
  const monthlyPrice = selectedDuration > 0 ? Math.round(totalPrice / selectedDuration) : 0

  const handlePurchase = async () => {
    if (!activeTier) return
    setLoading(true)
    try {
      if (isNative()) {
        const iap = await purchaseWithIAP(activeTier.id, selectedDuration)
        if (iap.ok) {
          trackEvent('purchase_completed', { tier: activeTier.id, duration_months: selectedDuration, channel: 'iap' })
          toast.success(t('premium.activated'))
          router.push('/premium/success')
          return
        }
        if (!iap.fallback) {
          toast.error(iap.message || t('premium.error'))
          return
        }
      }
      const token = getToken()
      const res = await fetch('/api/premium/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier: activeTier.id, duration_months: selectedDuration }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.code === 'STRIPE_NOT_CONFIGURED' ? t('premium.stripe_unavailable') : (data.message || t('premium.error')))
      if (data.url) {
        window.location.href = data.url
      } else {
        trackEvent('purchase_completed', { tier: activeTier.id, duration_months: selectedDuration, channel: 'web' })
        toast.success(t('premium.activated'))
        router.push('/premium/success')
      }
    } catch (err: any) {
      toast.error(err?.message || t('premium.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white p-4">
      <div className="max-w-md mx-auto space-y-4">
        <button onClick={() => router.back()} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft size={16} /> {t('common.back')}
        </button>

        <div className="text-center">
          <Star className="text-yellow-500 mx-auto mb-2" size={32} fill="currentColor" />
          <h1 className="text-2xl font-black">Premium</h1>
          <p className="text-sm text-muted-foreground">{t('premium.select_plan')}</p>
        </div>

        {tiers.map((tier, idx) => {
          const isSelected = selectedTier === tier.id
          return (
            <div
              key={tier.id}
              onClick={() => { setSelectedTier(tier.id); setSelectedDuration(DURATIONS[0].months) }}
              className={cn(
                "relative p-4 rounded-2xl border-2 transition-all cursor-pointer",
                isSelected
                  ? "border-primary bg-primary/5 shadow-md scale-[1.01]"
                  : "border-muted hover:border-muted-foreground/20"
              )}
            >
              {idx === 1 && (
                <Badge className="absolute -top-2.5 left-4 bg-primary text-white text-xs uppercase font-black border-2 border-white shadow-sm">
                  Best Choice
                </Badge>
              )}
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-lg">{tier.name}</h3>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-2xl font-black">{formatPrice(tier.price, language)}</span>
                    <span className="text-xs text-muted-foreground">/ {t('units.month_short')}</span>
                  </div>
                </div>
                <div className={cn(
                  "w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all shrink-0",
                  isSelected ? "border-primary bg-primary text-white scale-110 shadow-lg shadow-primary/20" : "border-muted"
                )}>
                  {isSelected && <Check size={14} strokeWidth={4} />}
                </div>
              </div>

              {isSelected && (
                <div className="flex gap-2 mt-3 pt-3 border-t">
                  {DURATIONS.map(dur => {
                    const durTotal = tier.price * dur.months * (1 - dur.discount / 100)
                    const durMonthly = Math.round(durTotal / dur.months)
                    return (
                      <div
                        key={dur.months}
                        onClick={(e) => { e.stopPropagation(); setSelectedDuration(dur.months) }}
                        className={cn(
                          "flex-1 py-2 rounded-xl border-2 text-center cursor-pointer transition-all",
                          selectedDuration === dur.months
                            ? "border-primary bg-primary/10"
                            : "border-muted hover:border-muted-foreground/20"
                        )}
                      >
                        <div className="text-sm font-black">{dur.months} {t('units.month_short')}</div>
                        <div className="text-xs text-muted-foreground">{formatPrice(durMonthly, language)}{t('units.per_month')}</div>
                        {dur.discount > 0 && (
                          <div className="text-xs font-black text-green-500">-{dur.discount}%</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {activeTier && selectedDuration > 0 && (
          <div className="p-3 rounded-xl bg-muted/30 text-center">
            <span className="font-bold">{activeTier.name} · {selectedDuration} {t('units.month_short')}</span>
            <span className="text-lg font-black ml-2">{formatPrice(Math.round(totalPrice), language)}</span>
            <span className="text-xs text-muted-foreground ml-1">({formatPrice(monthlyPrice, language)}{t('units.per_month')})</span>
          </div>
        )}

        <Button
          onClick={handlePurchase}
          disabled={loading || !activeTier}
          className="w-full h-14 rounded-full gradient-bg text-white font-black uppercase tracking-widest shadow-2xl shadow-primary/30 text-sm border-0"
        >
          {loading ? <Loader2 className="animate-spin" size={20} /> : t('premium.start_now')}
        </Button>
      </div>
    </div>
  )
}
