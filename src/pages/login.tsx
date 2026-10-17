
import { useState } from "react";
import { useRouter } from "@/shims/next-navigation";
import { 
  Heart, 
  Mail, 
  Lock, 
  ArrowRight, 
  Sparkles,
  ChevronLeft,
  Chrome,
  Phone,
  LayoutTemplate
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import Link from "@/shims/next-link";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { setToken } from "@/lib/token";
import { useTrackEvent } from "@/hooks/useExperiment";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loginMethod, setLoginMethod] = useState<"email" | "phone">("email");
  const { t } = useLanguage();
  const trackEvent = useTrackEvent();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    if (loginMethod !== 'email') {
        toast({
          title: t('auth.phone_coming_soon'),
          description: t('auth.phone_coming_soon_desc'),
        });
        setIsLoading(false);
        return;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        // Web: refresh_token в httpOnly cookie; храним в sessionStorage только на native
        const { isNative } = await import('@/lib/native');
        if (isNative() && data.refresh_token) sessionStorage.setItem('swiftmatch_refresh_token', data.refresh_token);
        localStorage.setItem('email_verified', data.email_verified ? '1' : '0');
        localStorage.setItem('email', email);
        trackEvent('login_completed', { method: 'email' });
        router.push('/');
        toast({
          title: t('auth.welcome_back'),
          description: t('auth.welcome_back_desc'),
        });
      } else {
        toast({
          title: t('auth.login_error'),
          description: data.message || t('auth.login_error_desc'),
          variant: "destructive",
        });
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("Login Error:", error);
      toast({
          title: t('auth.network_error'),
          description: t('auth.network_error_desc'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      const { getSupabase } = await import('@/lib/supabase')
      const supabase = getSupabase()
      if (!supabase) {
        toast({ title: 'Supabase not configured', variant: "destructive" })
        return
      }
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
      if (error) throw error
    } catch (error: any) {
      if (import.meta.env.DEV) console.error("Google Sign-In Error:", error);
      toast({
          title: t('auth.login_error'),
          description: error.message || t('auth.google_login_error'),
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-white relative overflow-hidden">
      {/* Background Gradients */}
      <div className="absolute top-[-10%] left-[-20%] w-[100%] h-[50%] bg-primary/10 rounded-full blur-[120px] -z-10"></div>
      <div className="absolute bottom-[-10%] right-[-20%] w-[100%] h-[50%] bg-[#ff8e53]/10 rounded-full blur-[120px] -z-10"></div>

      <header className="p-4 flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label={t('common.back')} onClick={() => router.back()} className="rounded-full h-10 w-10">
          <ChevronLeft size={24} />
        </Button>
        <Button variant="ghost" onClick={() => router.push("/")} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          {t('button.go_home')}
        </Button>
      </header>

      <main className="flex-1 px-8 pt-4 pb-12 flex flex-col justify-center max-w-md mx-auto w-full">
        <div className="text-center mb-10">
          <div className="inline-flex p-4 rounded-[2rem] gradient-bg text-white shadow-2xl shadow-primary/30 mb-6 animate-in zoom-in duration-500">
            <Heart size={40} fill="currentColor" />
          </div>
          <h1 className="text-4xl font-black font-headline tracking-tighter mb-3">
            Swift<span className="gradient-text">Match</span>
          </h1>
          <p className="text-muted-foreground text-sm font-medium">{t('auth.tagline')}</p>
        </div>

        <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700">
          <div className="flex gap-2 p-1 bg-muted/30 rounded-2xl mb-2">
            <button 
              onClick={() => setLoginMethod("phone")}
              className={cn(
                "flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                loginMethod === "phone" ? "bg-white shadow-sm text-primary" : "text-muted-foreground"
              )}
            >
              {t('auth.phone_tab')}
            </button>
            <button 
              onClick={() => setLoginMethod("email")}
              className={cn(
                "flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl transition-all",
                loginMethod === "email" ? "bg-white shadow-sm text-primary" : "text-muted-foreground"
              )}
            >
              Email
            </button>
          </div>

          <form onSubmit={handleLogin} noValidate className="space-y-4">
            {loginMethod === "phone" ? (
              <div className="space-y-2">
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                  <Input 
                    data-testid="phone"
                    type="tel" 
                    placeholder="+7 (999) 000-00-00" 
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-14 pl-12 rounded-2xl bg-muted/30 border-0 focus-visible:ring-primary/20 font-bold"
                    required
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <Input 
                      data-testid="email"
                      type="email" 
                      placeholder="Email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-14 pl-12 rounded-2xl bg-muted/30 border-0 focus-visible:ring-primary/20 font-bold"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <Input 
                      data-testid="password"
                      type="password" 
                      placeholder={t('auth.password_placeholder')} 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-14 pl-12 rounded-2xl bg-muted/30 border-0 focus-visible:ring-primary/20 font-bold"
                      required
                    />
                  </div>
                </div>
              </>
            )}

            {loginMethod === "email" && (
              <div className="text-right -mt-2">
                <Link href="/forgot-password" className="text-[10px] font-bold text-primary hover:underline">
                  {t('auth.forgot_password')}
                </Link>
              </div>
            )}
            
            <Button 
              data-testid="submit-login"
              type="submit" 
              disabled={isLoading}
              className="w-full h-14 rounded-full gradient-bg text-white font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] transition-all active:scale-95 border-0"
            >
              {isLoading ? t('auth.logging_in') : t('auth.continue')} <ArrowRight size={18} className="ml-2" />
            </Button>
          </form>

          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border"></span>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-black tracking-widest text-muted-foreground bg-white px-4">
              {t('auth.or')}
            </div>
          </div>

          <Button 
            variant="outline" 
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full h-14 rounded-full border-2 border-muted hover:bg-muted/30 transition-all font-bold gap-3 shadow-sm"
          >
            <Chrome size={20} className="text-[#4285F4]" />
            {t('auth.google_login')}
          </Button>

          <div className="flex flex-col gap-4 pt-2">
            <p className="text-center text-xs text-muted-foreground">
              {t('auth.no_account')}{" "}
              <Link href="/register" className="text-primary font-black uppercase tracking-tighter hover:underline">
                {t('auth.register_link')}
              </Link>
            </p>
            <Button 
              asChild 
              variant="outline" 
              className="w-full h-12 rounded-2xl border-2 border-dashed border-primary/20 text-primary font-black uppercase tracking-[0.15em] text-[10px] bg-primary/5 hover:bg-primary/10 transition-all"
            >
              <Link href="/onboarding">
                <LayoutTemplate size={14} className="mr-2" />
                {t('auth.demo_onboarding')}
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-auto pt-12 flex flex-col items-center gap-4">
          <Badge variant="secondary" className="bg-primary/5 text-primary border-0 px-4 py-2 rounded-xl flex gap-2 shadow-sm">
            <Sparkles size={14} /> <span>{t('auth.private')}</span>
          </Badge>
        </div>
      </main>
    </div>
  );
}
