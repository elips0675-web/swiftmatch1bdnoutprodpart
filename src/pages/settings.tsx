
import { useState, useEffect } from "react";
import { useRouter } from "@/shims/next-navigation";
import { useAuth } from "@/context/auth-context";
import { 
  Bell, 
  Search, 
  EyeOff, 
  ShieldCheck, 
  LogOut, 
  Trash2,
  MapPin,
  ChevronRight,
  Info,
  Scale,
  Sun,
  Moon
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useLanguage } from "@/context/language-context";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push-notifications";
import { NotificationPreferencesSection } from "@/components/settings/notification-preferences-section";
import { SessionsSection } from "@/components/settings/sessions-section";
import { getToken } from "@/lib/token";


export default function SettingsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { logout } = useAuth();
  
  const [settings, setSettings] = useState({
    pushNotifications: true,
    discovery: true,
    incognito: false,
    smartPhotos: true,
    security: true,
    location: true,
    photoVerification: true,
    dataProcessingConsent: true
  });
  const [isClient, setIsClient] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  useEffect(() => {
    setIsClient(true);
    fetch('/api/settings/privacy', {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then(r => r.json())
      .then(data => {
        setSettings(prev => ({ ...prev, incognito: Boolean(data.incognito) }))
        localStorage.setItem('incognito-mode', JSON.stringify(Boolean(data.incognito)))
      })
      .catch(() => {
        const savedIncognito = localStorage.getItem('incognito-mode');
        if (savedIncognito) {
          setSettings(prev => ({ ...prev, incognito: JSON.parse(savedIncognito) }));
        }
      })
    const savedConsent = localStorage.getItem('data-processing-consent');
    if (savedConsent) {
      setSettings(prev => ({ ...prev, dataProcessingConsent: JSON.parse(savedConsent) }));
    }
  }, []);

  const handlePushChange = async (val: boolean) => {
    if (val) {
      const ok = await subscribeToPush();
      if (!ok) {
        toast({
          variant: "destructive",
          title: t('settings.push_denied_title'),
          description: t('settings.push_denied_desc'),
        });
        return;
      }
    } else {
      await unsubscribeFromPush();
    }
    setSettings({ ...settings, pushNotifications: val });
  };

  const handleIncognitoChange = (val: boolean) => {
    setSettings(prev => ({ ...prev, incognito: val }));
    localStorage.setItem('incognito-mode', JSON.stringify(val));
    fetch('/api/settings/privacy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ incognito: val }),
    }).catch(() => {})
    toast({
      title: t('settings.incognito'),
      description: val ? t('settings.incognito.enabled_desc') : t('settings.incognito.disabled_desc'),
    });
  };

  const handleConsentChange = (val: boolean) => {
    setSettings(prev => ({ ...prev, dataProcessingConsent: val }));
    localStorage.setItem('data-processing-consent', JSON.stringify(val));
    fetch('/api/consent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ consent_type: 'data_processing', granted: val }),
    }).catch(() => {})
    toast({
      title: t('settings.data_consent'),
      description: val ? t('settings.consent_enabled') : t('settings.consent_withdrawn'),
    });
  };

  const handleDeleteAccount = async () => {
    if (!confirm(t('delete_profile.confirm'))) return
    try {
      const res = await fetch('/api/profile/me', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (res.ok) {
        toast({ title: t('delete_profile.done') })
        handleLogout()
      } else {
        toast({ variant: 'destructive', title: t('delete_profile.error') })
      }
    } catch {
      toast({ variant: 'destructive', title: t('delete_profile.error') })
    }
  }

  const handleLogout = () => {
    logout();
    localStorage.removeItem('authToken');
    localStorage.removeItem('userProfile');
    localStorage.removeItem('userProfileGallery');
    localStorage.removeItem('incognito-mode');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('swiftchat_')) keysToRemove.push(key);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    toast({
      title: t('logout.title'),
    });
    router.push("/login");
  };

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <AppHeader />
      
      <main className="flex-1 overflow-y-auto p-6 flex flex-col">
        <div className="space-y-6 flex-1 pb-12">
          <section className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">{t('settings.account')}</h5>
            <div className="space-y-1">
<div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Bell size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.push_notifications')}</p>
                  </div>
                </div>
                <Switch data-testid="switch-push-notifications"
                  checked={isClient ? settings.pushNotifications : true} 
                  onCheckedChange={handlePushChange} 
                />
              </div>

              <div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <MapPin size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.location')}</p>
                  </div>
                </div>
                <Switch data-testid="switch-location" checked={isClient ? settings.location : true} onCheckedChange={(val) => setSettings({...settings, location: val})} />
              </div>

              <div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                    <Search size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.discovery')}</p>
                  </div>
                </div>
                <Switch data-testid="switch-discovery" checked={isClient ? settings.discovery : true} onCheckedChange={(val) => setSettings({...settings, discovery: val})} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">{t('notif.section')}</h5>
            <NotificationPreferencesSection />
          </section>

          <section className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">{t('settings.privacy')}</h5>
            <div className="space-y-1">
              <div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                    <EyeOff size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.incognito')}</p>
                  </div>
                </div>
                <Switch data-testid="switch-incognito" checked={isClient ? settings.incognito : false} onCheckedChange={handleIncognitoChange} />
              </div>

              <div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.security')}</p>
                    <p className="text-[11px] text-muted-foreground">{t('sessions.desc')}</p>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="sessions-toggle"
                  className="flex items-center gap-2"
                  onClick={() => setSessionsOpen((v) => !v)}
                aria-expanded={sessionsOpen}
                >
                  <Badge variant="outline" className="text-[10px] text-primary border-primary/20">{t('settings.security.status')}</Badge>
                  <ChevronRight size={16} className={cn('text-muted-foreground transition-transform', sessionsOpen && 'rotate-90')} />
                </button>
              </div>

              {sessionsOpen && (
                <div className="pb-3">
                  <SessionsSection />
                </div>
              )}

              <div className="flex items-center justify-between py-3 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.data_consent')}</p>
                  </div>
                </div>
                <Switch data-testid="switch-data-consent" checked={isClient ? settings.dataProcessingConsent : true} onCheckedChange={handleConsentChange} />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">{t('settings.legal')}</h5>
            <div className="space-y-1">
              <div className="flex items-center justify-between py-3 border-b border-border/50 cursor-pointer hover:bg-muted/30 -mx-6 px-6 transition-colors" onClick={() => router.push('/legal/privacy')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                    <Scale size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.privacy_policy')}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
              <div className="flex items-center justify-between py-3 border-b border-border/50 cursor-pointer hover:bg-muted/30 -mx-6 px-6 transition-colors" onClick={() => router.push('/legal/terms')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                    <Scale size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.terms_of_service')}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
              <div className="flex items-center justify-between py-3 border-b border-border/50 cursor-pointer hover:bg-muted/30 -mx-6 px-6 transition-colors" onClick={() => router.push('/legal/data-processing')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                    <Scale size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.data_consent')}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h5 className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">{t('settings.about_app')}</h5>
            <div className="space-y-1">
              <div className="flex items-center justify-between py-3 border-b border-border/50 cursor-pointer hover:bg-muted/30 -mx-6 px-6 transition-colors" onClick={() => router.push('/about')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-500/10 flex items-center justify-center text-orange-500">
                    <Info size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('settings.about_app')}</p>
                    <p className="text-xs text-muted-foreground">{t('settings.about_app_desc')}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
              <div data-testid="safety-link" className="flex items-center justify-between py-3 border-b border-border/50 cursor-pointer hover:bg-muted/30 -mx-6 px-6 transition-colors" onClick={() => router.push('/safety')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{t('safety.title')}</p>
                    <p className="text-xs text-muted-foreground">{t('settings.about_app_desc')}</p>
                  </div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </div>
          </section>

        </div>

        <div className="space-y-3 pt-8 mt-auto">
            <Button data-testid="logout-button"
                onClick={handleLogout}
                className="w-full h-12 rounded-full gradient-bg text-white font-black uppercase tracking-wider shadow-lg shadow-primary/20 active:scale-95 transition-all border-0">
                <LogOut size={16} className="mr-2" /> {t('logout.button')}
            </Button>
            <Button data-testid="delete-account-button"
                variant="ghost" 
                onClick={handleDeleteAccount}
                className="w-full justify-center text-muted-foreground/60 hover:text-destructive text-xs font-normal h-auto py-3 gap-2 px-0 transition-colors">
                <Trash2 size={14} /> {t('delete_profile.button')}
            </Button>
        </div>
      </main>
    </div>
  );
}
