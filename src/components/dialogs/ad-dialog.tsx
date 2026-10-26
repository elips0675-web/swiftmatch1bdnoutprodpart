import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { Play } from "lucide-react";
import { toast } from '@/hooks/use-toast';

function isNative(): boolean {
  try {
    return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform() === true
  } catch {
    return false
  }
}

export function AdDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { t } = useLanguage();
  const [isAdLoading, setIsAdLoading] = useState(false);
  const runTokenRef = useRef(0);

  useEffect(() => {
    if (!open) runTokenRef.current += 1;
  }, [open]);

  useEffect(() => () => { runTokenRef.current += 1 }, []);

  const handleWatchAd = async () => {
    const token = runTokenRef.current + 1;
    runTokenRef.current = token;
    setIsAdLoading(true);

    if (isNative()) {
      try {
        const { AdMob } = await import('@capacitor-community/admob');
        await AdMob.showRewardVideoAd();
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[AdMob] SDK not available, using timer fallback:', err);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } else {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (runTokenRef.current !== token) {
      setIsAdLoading(false);
      return;
    }

    setIsAdLoading(false);
    onOpenChange(false);
    toast({
      title: t('ad.profile_unlocked'),
      description: t('ad.unlock_description'),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[320px] rounded-[2.5rem] p-8 text-center bg-white app-shadow border-0">
        <div className="w-20 h-20 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-6 relative">
          <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-ping"></div>
          <Play size={32} className="text-primary ml-1 relative z-10" fill="currentColor" />
        </div>
        <DialogTitle className="text-xl font-black mb-2 font-headline tracking-tighter uppercase">{t('activity.unlock_title')}</DialogTitle>
        <DialogDescription className="text-muted-foreground text-xs mb-8 leading-relaxed font-medium">
          {t('activity.unlock_desc')}
        </DialogDescription>
        
        <div className="flex flex-col gap-3">
          <Button 
            onClick={handleWatchAd}
            disabled={isAdLoading}
            className="w-full h-14 rounded-full gradient-bg text-white font-black uppercase tracking-widest shadow-xl shadow-primary/20 text-[10px] border-0"
          >
            {isAdLoading ? t('common.loading') : t('button.watch')}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-full text-muted-foreground text-[9px] font-black uppercase tracking-widest h-10">
            {t('button.not_now')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
