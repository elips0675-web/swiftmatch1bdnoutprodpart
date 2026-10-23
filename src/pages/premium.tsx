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
import {
  FALLBACK_PREMIUM_TIERS,
  PREMIUM_DURATIONS,
  checkoutErrorMessage,
  checkoutRedirectUrl,
  formatPrice,
  isPremiumTierList,
  monthlyPriceFor,
  readJsonBody,
  totalPriceFor,
  type PremiumTier,
} from '@/lib/premium'

export default function Premium() {
  const { t, language } = useLanguage()
  const router = useRouter()
  const [tiers, setTiers] = useState<PremiumTier[]>([])
  const [selectedTier, setSelectedTier] = useState('')
  const [selectedDuration, setSelectedDuration] = useState(PREMIUM_DURATIONS[0].months)
  const [loading, setLoading] = useState(false)
  const trackEvent = useTrackEvent()

  useEffect(() => {
    fetch('/api/premium/tiers')
      .then((res) => readJsonBody(res))
      .then((data) => {
        if (!isPremiumTierList(data)) throw new Error('invalid tiers')
        setTiers(data)
        setSelectedTier(data[0].id)
      })
      .catch(() => {
        setTiers(FALLBACK_PREMIUM_TIERS)
        setSelectedTier('gold')
      })
  }, [])

  const activeTier = tiers.find((tier) => tier.id === selectedTier)
  const totalPrice = activeTier ? totalPriceFor(activeTier, selectedDuration) : 0
  const monthlyPrice = activeTier ? monthlyPriceFor(activeTier, selectedDuration) : 0

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
      const res = await fetch('/api/premium/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ tier: activeTier.id, duration_months: selectedDuration }),
      })
      const data = await readJsonBody(res)
      if (!res.ok) {
        toast.error(checkoutErrorMessage(data, t))
        return
      }
      const redirectUrl = checkoutRedirectUrl(data)
      if (redirectUrl) {
        window.location.href = redirectUrl
        return
      }
      trackEvent('purchase_completed', { tier: activeTier.id, duration_months: selectedDuration, channel: 'web' })
      toast.success(t('premium.activated'))
      router.push('/premium/success')
    } catch {
      toast.error(t('premium.error'))
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
              onClick={() => { setSelectedTier(tier.id); setSelectedDuration(PREMIUM_DURATIONS[0].months) }}
              className={cn(
                "relative p-4 rounded-2xl border-2 transition-all cursor-pointer",
                isSelected
                  ? "border-primary bg-primary/5 shadow-md scale-[1.01]"
                  : "border-muted hover:border-muted-foreground/20"
              )}
            >
              {idx === 1 && (
                <Badge className="absolute -top-2.5 left-4 bg-primary text-white text-xs uppercase font-black border-2 border-white shadow-sm">
                  {t('premium.best_choice')}
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
                  {PREMIUM_DURATIONS.map(dur => {
                    const durMonthly = monthlyPriceFor(tier, dur.months)
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
            <span className="text-lg font-black ml-2">{formatPrice(totalPrice, language)}</span>
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
