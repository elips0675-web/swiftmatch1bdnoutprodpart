
import { useState } from "react";
import { useRouter } from "@/shims/next-navigation";
import {
  Heart,
  Mail,
  Lock,
  ArrowRight,
  User,
  Phone,
  ChevronLeft,
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import Link from "@/shims/next-link";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/context/language-context";
import { useTrackEvent } from "@/hooks/useExperiment";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [ageConfirm, setAgeConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { t } = useLanguage();
  const trackEvent = useTrackEvent();

  const validateEmail = (email: string) => {
    return String(email)
      .toLowerCase()
      .match(
        /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
      );
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      toast({ title: t('common.error'), description: t('register.name_required'), variant: "destructive" });
      return;
    }

    if (!validateEmail(email)) {
      toast({ title: t('common.error'), description: t('register.invalid_email'), variant: "destructive" });
      return;
    }

    if (password.length < 8) {
      toast({ title: t('common.error'), description: t('register.password_length'), variant: "destructive" });
      return;
    }

    if (!ageConfirm) {
      toast({ title: t('common.error'), description: t('register.age_required'), variant: "destructive" });
      return;
    }

    if (!consent) {
      toast({ title: t('common.error'), description: t('register.consent_required'), variant: "destructive" });
      return;
    }

    setIsLoading(true);

    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password, displayName: name, phone: phone || undefined, consent }),
        });

        const data = await response.json();

        if (response.ok) {
            trackEvent('register_completed', {});
            toast({
                title: t('common.success'),
                description: t('register.account_created'),
            });
            router.push('/login'); // Перенаправляем на страницу входа
        } else {
            toast({
                title: t('register.registration_error'),
                description: data.message || t('register.create_account_failed'),
                variant: "destructive",
            });
        }
    } catch (error) {
        if (import.meta.env.DEV) console.error("Registration Error:", error);
        toast({
                title: t('auth.network_error'),
                description: t('auth.network_error_desc'),
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

      <header className="p-4 flex items-center">
        <Button variant="ghost" size="icon" aria-label={t('common.back')} onClick={() => router.back()} className="rounded-full h-10 w-10">
          <ChevronLeft size={24} />
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
          <p className="text-muted-foreground text-sm font-medium">{t('register.tagline')}</p>
        </div>

        <div className="space-y-6 animate-in slide-in-from-bottom-8 duration-700">
          <form onSubmit={handleRegister} noValidate className="space-y-4">
             <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input 
                data-testid="name"
                type="text" 
                placeholder={t('register.name_placeholder')} 
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-14 pl-12 rounded-2xl bg-muted/30 border-0 focus-visible:ring-primary/20 font-bold"
                required
              />
            </div>
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
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input 
                data-testid="password"
                type="password" 
                placeholder={t('register.password_placeholder')} 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 pl-12 rounded-2xl bg-muted/30 border-0 focus-visible:ring-primary/20 font-bold"
                required
              />
            </div>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <Input 
                data-testid="phone"
                type="tel" 
                placeholder="+7 (999) 123-45-67"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-14 pl-12 rounded-2xl bg-muted/30 border-0 focus-visible:ring-primary/20 font-bold"
              />
            </div>
            
<div className="flex items-start gap-3 py-1">
              <Checkbox
                data-testid="age-checkbox"
                id="age-confirm"
                checked={ageConfirm}
                onCheckedChange={(val) => setAgeConfirm(val === true)}
                className="mt-0.5"
              />
              <label htmlFor="age-confirm" className="text-xs text-muted-foreground leading-relaxed select-none">
                {t('register.age_label')}
              </label>
            </div>

            <div className="flex items-start gap-3 py-1">
              <Checkbox
                data-testid="consent-checkbox"
                id="consent"
                checked={consent}
                onCheckedChange={(val) => setConsent(val === true)}
                className="mt-0.5"
              />
              <label htmlFor="consent" className="text-xs text-muted-foreground leading-relaxed select-none">
                {t('register.consent_label')}{" "}
                <Link href="/legal/data-processing" className="text-primary hover:underline font-medium">
                  {t('register.consent_doc')}
                </Link>{" "}
                и{" "}
                <Link href="/legal/privacy" className="text-primary hover:underline font-medium">
                  {t('register.consent_privacy')}
                </Link>
                {" "}и{" "}
                <Link href="/legal/terms" className="text-primary hover:underline font-medium">
                  {t('register.consent_terms')}
                </Link>
              </label>
            </div>

            <Button
              data-testid="submit-register"
              type="submit" 
              disabled={isLoading}
              className="w-full h-14 rounded-2xl gradient-bg text-white font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.02] transition-all active:scale-95 border-0"
            >
              {isLoading ? t('register.creating') : t('register.create_account')} <ArrowRight size={18} className="ml-2" />
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            {t('register.has_account')}{" "}
            <Link href="/login" className="text-primary font-black uppercase tracking-tighter hover:underline">
              {t('auth.login_link')}
            </Link>
          </p>
        </div>

        <div className="mt-auto pt-12 flex flex-col items-center gap-4">
          <Badge variant="secondary" className="bg-primary/5 text-primary border-0 px-4 py-2 rounded-xl flex gap-2 shadow-sm">
            <Sparkles size={14} /> <span>{t('register.safe')}</span>
          </Badge>
        </div>
      </main>
    </div>
  );
}
