import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { Sparkles, Check, Zap, Eye, ShieldCheck, Star, Loader2 } from "lucide-react";
import { motion } from 'framer-motion';
import { getToken } from '@/lib/token';
import { toast } from 'sonner';

interface Tier {
  id: string;
  name: string;
  price: number;
  duration_months: number;
  features: string[];
}

const DURATIONS = [
  { months: 1, discount: 0 },
  { months: 6, discount: 20 },
  { months: 12, discount: 40 },
];

function formatPrice(price: number, locale: string = 'ru-RU'): string {
  return price.toLocaleString(locale === 'EN' ? 'en-US' : 'ru-RU') + ' ₽';
}

export function PremiumDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { t, language } = useLanguage();
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [selectedTier, setSelectedTier] = useState('');
  const [selectedDuration, setSelectedDuration] = useState(DURATIONS[0].months);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetch('/api/premium/tiers')
        .then(r => r.json())
        .then((data: Tier[]) => {
          setTiers(data);
          if (data.length > 0) setSelectedTier(data[0].id);
        })
        .catch(() => {
          setTiers([
            { id: 'plus', name: 'Plus', price: 299, duration_months: 1, features: ['5 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня'] },
            { id: 'gold', name: 'Gold', price: 699, duration_months: 1, features: ['10 суперлайков в день', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки'] },
            { id: 'platinum', name: 'Platinum', price: 1499, duration_months: 1, features: ['∞ суперлайков', 'Без рекламы', 'Кто лайкнул меня', 'Режим невидимки', 'Приоритетные лайки', 'Персональный консьерж'] },
          ]);
          setSelectedTier('gold');
        });
      setSelectedDuration(DURATIONS[0].months);
    }
  }, [open]);

  const activeTier = tiers.find(t => t.id === selectedTier);
  const totalPrice = activeTier ? activeTier.price * selectedDuration * (1 - (DURATIONS.find(d => d.months === selectedDuration)?.discount || 0) / 100) : 0;
  const monthlyPrice = selectedDuration > 0 ? Math.round(totalPrice / selectedDuration) : 0;

  const handlePurchase = async () => {
    if (!activeTier) return;
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch('/api/premium/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier: activeTier.id, duration_months: selectedDuration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.code === 'STRIPE_NOT_CONFIGURED' ? t('premium.stripe_unavailable') : (data.message || t('premium.error')));
      if (data.url) {
        window.location.href = data.url;
      } else {
        toast.success(t('premium.activated'));
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error(err?.message || t('premium.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[340px] rounded-[2.5rem] p-0 overflow-hidden border-0 bg-white app-shadow">
        <div className="relative h-32 gradient-bg flex flex-col items-center justify-center text-white p-6 overflow-hidden">
           <div className="absolute inset-0 bg-black/5"></div>
           <motion.div 
              animate={{ rotate: 360 }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute opacity-10"
           >
              <Sparkles size={120} />
           </motion.div>
           <Star className="text-yellow-300 mb-1 drop-shadow-lg relative z-10" size={32} fill="currentColor" />
           <DialogTitle className="text-xl font-black uppercase tracking-tighter relative z-10">Premium</DialogTitle>
           <p className="text-[8px] text-white/80 font-bold uppercase tracking-[0.3em] relative z-10 mt-0.5">
              {t('premium.select_plan')}
           </p>
        </div>

        <div className="p-5 space-y-2.5">
          {tiers.map((tier, idx) => {
            const isSelected = selectedTier === tier.id;
            return (
              <div 
                key={tier.id}
                onClick={() => { setSelectedTier(tier.id); setSelectedDuration(DURATIONS[0].months); }}
                className={cn(
                  "relative p-3 rounded-2xl border-2 transition-all cursor-pointer",
                  isSelected 
                    ? "border-primary bg-primary/5 shadow-md scale-[1.01]" 
                    : "border-muted hover:border-muted-foreground/20"
                )}
              >
                {idx === 1 && (
                  <Badge className="absolute -top-2.5 left-4 bg-primary text-white text-[7px] uppercase font-black border-2 border-white shadow-sm px-2 py-0.5">Best Choice</Badge>
                )}
                <div className="flex justify-between items-center">
                  <div>
                    <h6 className="font-bold text-[10px] text-foreground/80">{tier.name}</h6>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <span className="text-lg font-black text-foreground">{formatPrice(tier.price, language)}</span>
                      <span className="text-[7px] text-muted-foreground font-bold">/ {t('units.month_short')}</span>
                    </div>
                  </div>
                  <div className={cn(
                    "w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all shrink-0",
                    isSelected ? "border-primary bg-primary text-white scale-110 shadow-lg shadow-primary/20" : "border-muted"
                  )}>
                    {isSelected && <Check size={14} strokeWidth={4} />}
                  </div>
                </div>

                {isSelected && (
                  <div className="flex gap-1.5 mt-2 pt-2 border-t border-muted/50">
                    {DURATIONS.map(dur => {
                      const durTotal = tier.price * dur.months * (1 - dur.discount / 100);
                      const durMonthly = Math.round(durTotal / dur.months);
                      return (
                        <div
                          key={dur.months}
                          onClick={(e) => { e.stopPropagation(); setSelectedDuration(dur.months); }}
                          className={cn(
                            "flex-1 py-1.5 rounded-xl border-2 text-center cursor-pointer transition-all",
                            selectedDuration === dur.months
                              ? "border-primary bg-primary/10"
                              : "border-muted hover:border-muted-foreground/20"
                          )}
                        >
                          <div className="text-[9px] font-black">{dur.months} {t('units.month_short')}</div>
                          <div className="text-[8px] text-muted-foreground font-bold">{formatPrice(durMonthly, language)}{t('units.per_month')}</div>
                          {dur.discount > 0 && (
                            <div className="text-[7px] font-black text-green-500">-{dur.discount}%</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 border-t border-muted mt-1">
              <div className="flex items-center gap-1.5 text-[7px] text-muted-foreground font-black uppercase tracking-widest">
                <Zap size={10} className="text-primary" /> {t('premium.unlimited')}
              </div>
              <div className="flex items-center gap-1.5 text-[7px] text-muted-foreground font-black uppercase tracking-widest">
                <Eye size={10} className="text-primary" /> {t('premium.views')}
              </div>
              <div className="flex items-center gap-1.5 text-[7px] text-muted-foreground font-black uppercase tracking-widest">
                <ShieldCheck size={10} className="text-primary" /> {t('premium.incognito')}
              </div>
              <div className="flex items-center gap-1.5 text-[7px] text-muted-foreground font-black uppercase tracking-widest">
                <Sparkles size={10} className="text-primary" /> {t('premium.super_likes')}
              </div>
          </div>
        </div>

        {activeTier && selectedDuration > 0 && (
          <div className="px-5 pb-1">
            <div className="p-2 rounded-xl bg-muted/30 text-center">
              <span className="text-[9px] font-black">{activeTier.name} · {selectedDuration} {t('units.month_short')}</span>
              <span className="text-[11px] font-black ml-2">{formatPrice(Math.round(totalPrice), language)}</span>
              <span className="text-[7px] text-muted-foreground ml-1">({formatPrice(monthlyPrice, language)}{t('units.per_month')})</span>
            </div>
          </div>
        )}

        <DialogFooter className="p-5 pt-2">
          <Button onClick={handlePurchase} disabled={loading || !activeTier} className="w-full h-12 rounded-full gradient-bg text-white font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 active:scale-95 transition-all text-[9px] border-0">
            {loading ? <Loader2 className="animate-spin" size={16} /> : t('premium.start_now')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
