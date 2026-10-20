import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Smartphone, ChevronDown, Globe, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/context/language-context';
import { toast } from '@/hooks/use-toast';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export function PwaInstallBanner() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsStandalone(!!isStandaloneMode);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(isIosDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    let showTimer: ReturnType<typeof setTimeout> | undefined;

    const tryShow = () => {
      if (isStandaloneMode) return;
      const dismissed = sessionStorage.getItem('pwa-install-dismissed');
      if (dismissed) return;
      showTimer = setTimeout(() => setIsVisible(true), isIosDevice ? 4000 : 2000);
    };

    const cookieConsent = localStorage.getItem('cookie-consent');
    if (cookieConsent) {
      tryShow();
      return () => {
        if (showTimer) clearTimeout(showTimer);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      };
    }

    const onConsent = () => tryShow();
    window.addEventListener('cookie-consent-accepted', onConsent);
    return () => {
      if (showTimer) clearTimeout(showTimer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('cookie-consent-accepted', onConsent);
    };
  }, []);

  const handleInstall = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        toast({ title: t('pwa.install.success') });
        setIsVisible(false);
      }
    } else {
      setShowGuide(!showGuide);
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem('pwa-install-dismissed', 'true');
    setIsVisible(false);
    setShowGuide(false);
  };

  if (isStandalone) return null;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-24 left-4 right-4 z-[100] sm:left-auto sm:right-4 sm:max-w-sm"
        >
          <div className="bg-white rounded-[2rem] p-6 app-shadow border border-border/50 flex flex-col gap-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 gradient-bg opacity-20"></div>
            
            <div className="flex items-start gap-4">
              <button onClick={handleInstall} className="w-12 h-12 rounded-2xl gradient-bg flex items-center justify-center text-white shrink-0 shadow-lg shadow-primary/20 cursor-pointer active:scale-90 transition-transform">
                <Download size={24} />
              </button>
              <div className="flex-1 pt-1">
                <h5 className="text-sm font-black tracking-tight leading-tight">
                  {t('pwa.install.title')}
                </h5>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-1 font-medium">
                  {t('pwa.install.description')}
                </p>
              </div>
              <button onClick={handleDismiss} className="text-muted-foreground/40 hover:text-foreground p-1 transition-colors">
                <X size={18} />
              </button>
            </div>

            <>
              {installPrompt && !isIos && (
                <Button
                  onClick={handleInstall}
                  className="w-full h-12 rounded-xl gradient-bg text-white font-black uppercase text-[11px] tracking-widest border-0 shadow-xl shadow-primary/20 active:scale-95 transition-all flex items-center gap-2"
                >
                  <Smartphone size={16} />
                  {t('pwa.install.button')}
                </Button>
              )}

              {!installPrompt && !isIos && (
                <>
                  <Button
                    onClick={() => setShowGuide(!showGuide)}
                    variant="outline"
                    className="w-full h-12 rounded-xl font-black uppercase text-[11px] tracking-widest flex items-center gap-2"
                  >
                    <Smartphone size={16} />
                    {t('pwa.install.guide_button')}
                    <ChevronDown size={14} className={`transition-transform duration-200 ${showGuide ? 'rotate-180' : ''}`} />
                  </Button>

                  <AnimatePresence>
                    {showGuide && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="bg-muted/30 rounded-2xl p-3 flex flex-col gap-2 border border-border/40">
                          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-tight text-foreground/70">
                            <div className="w-6 h-6 rounded-lg bg-white flex items-center justify-center shadow-sm text-foreground">
                              <Menu size={14} />
                            </div>
                            <span>1. {t('pwa.install.menu_open')}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-tight text-foreground/70">
                            <div className="w-6 h-6 rounded-lg bg-white flex items-center justify-center shadow-sm text-foreground">
                              <Download size={14} />
                            </div>
                            <span>2. {t('pwa.install.menu_install')}</span>
                          </div>
                          <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-tight text-foreground/70">
                            <div className="w-6 h-6 rounded-lg bg-white flex items-center justify-center shadow-sm text-foreground">
                              <Globe size={14} />
                            </div>
                            <span>3. {t('pwa.install.address_bar_install')}</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              )}

              <Button
                onClick={handleDismiss}
                variant="ghost"
                className="w-full h-10 rounded-xl font-black text-[10px] uppercase tracking-widest text-muted-foreground"
              >
                {t('pwa.install.cancel')}
              </Button>
            </>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
