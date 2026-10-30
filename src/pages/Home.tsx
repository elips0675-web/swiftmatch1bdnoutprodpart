
import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { Zap, Search, Sparkles, Trophy, ChevronRight, Music, Dumbbell, Palette, Gamepad2, Film, Globe, ChefHat, Cpu, BookOpen, Shirt, HeartPulse, Dog, FlaskConical, Briefcase, Chrome as HomeIcon, Car, Laugh, Star, Scroll, Users, ChevronLeft, CalendarHeart } from "lucide-react";
import Link from "@/shims/next-link";
import dynamic from "@/shims/next-dynamic";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/shims/next-navigation";
import { useLanguage } from "@/context/language-context";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { ALL_DEMO_USERS, GROUP_CATEGORIES, type DemoGroupCategory } from "@/lib/demo-data";
import { toast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const iconMap: Record<string, React.ElementType> = {
  Music, Dumbbell, Palette, Gamepad2, Film, Globe, ChefHat, Cpu, BookOpen, Sparkles, Shirt, HeartPulse, Dog, FlaskConical, Briefcase, Home: HomeIcon, Car, Laugh, Star, Scroll
};

type HomeUser = {
  id?: number;
  city?: string;
  gender?: string;
  datingGoal?: string;
  interests?: string[];
};

type PopularGroup = DemoGroupCategory & { onlineCount: number };

const TopOfWeekSection = dynamic(() => import('@/components/sections/top-of-week').then(mod => mod.TopOfWeekSection), { 
  ssr: false,
  loading: () => <div className="px-5 pt-8 space-y-4"><Skeleton className="h-8 w-40" /><div className="grid grid-cols-2 gap-4"><Skeleton className="aspect-[4/3] rounded-xl" /><Skeleton className="aspect-[4/3] rounded-xl" /></div></div>
});

const AutosearchDialog = dynamic(() => import('@/components/dialogs/autosearch-dialog').then(mod => mod.AutosearchDialog), { ssr: false });

export default function Home() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const { hangoutsEnabled } = useFeatureFlags();
  const [showAutosearchDialog, setShowAutosearchDialog] = useState(false);
  const [currentUser, setCurrentUser] = useState<HomeUser | null>(null);
  const [popularGroups, setPopularGroups] = useState<PopularGroup[]>([]);
  const [view, setView] = useState<'top-users' | 'popular-groups'>('top-users');

  useEffect(() => {
    const saved = localStorage.getItem('userProfile');
    if (saved) {
      try {
        setCurrentUser(JSON.parse(saved));
      } catch (e) {
        setCurrentUser(ALL_DEMO_USERS[1]);
      }
    } else {
      setCurrentUser(ALL_DEMO_USERS[1]);
    }

    setPopularGroups(GROUP_CATEGORIES.slice(0, 4).map(cat => ({
      ...cat,
      onlineCount: Math.floor(Math.random() * 50) + 10
    })));
  }, []);

  const topUsers = useMemo(() => {
    return [...ALL_DEMO_USERS]
      .filter(u => u.id !== (currentUser?.id || 1))
      .sort((a, b) => b.match - a.match)
      .slice(0, 4);
  }, [currentUser]);

  const runAutosearch = useCallback(() => {
    if (!currentUser) return;
    const filters = {
        ageRange: [18, 40],
        selectedCity: currentUser.city || "all",
        selectedCountry: "",
        distance: [50],
        genderPref: currentUser.gender === 'female' ? 'male' : 'female',
        selectedDatingGoal: currentUser.datingGoal || "all",
        selectedInterests: currentUser.interests || [],
    };
    sessionStorage.setItem('autosearchFilters', JSON.stringify(filters));
    router.push('/search?mode=autosearch');
  }, [currentUser, router]);

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fb] relative">
      <AppHeader />
      {localStorage.getItem('email_verified') === '0' && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
          <p className="text-xs font-bold text-amber-800">{t('auth.verify_prompt')} — {t('auth.verify_prompt_desc')}</p>
          <button onClick={() => {
            const email = localStorage.getItem('email') || '';
            fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
              .then(res => res.json())
              .then(data => toast({ title: data.message }))
              .catch(() => toast({ variant: 'destructive', title: t('common.error') }));
          }} className="text-[10px] font-black uppercase tracking-wider text-amber-700 hover:text-amber-900 shrink-0 ml-2">{t('auth.resend_verification')}</button>
        </div>
      )}
      <main className="flex-1 overflow-y-auto pb-24">
        <section className="px-6 py-10 text-center relative overflow-hidden bg-white border-b border-border/40">
          <Badge variant="secondary" className="mb-4 bg-primary/10 text-primary border-0 gap-1.5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em]">
            <Sparkles size={12} fill="currentColor" /> {t('home.popular')}
          </Badge>
          <h1 className="text-3xl font-black font-headline mb-2 leading-tight tracking-tighter text-foreground">
            {t('home.headline')}
          </h1>
          <p className="text-muted-foreground text-xs font-medium mb-8 mx-auto">
            {t('home.subheadline')}
          </p>

          <div className="grid grid-cols-2 gap-4 mx-auto">
            <Button onClick={() => setShowAutosearchDialog(true)} className="h-14 rounded-xl gradient-bg text-white font-black text-xs shadow-xl border-0 uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-1.5">
              <Zap size={16} fill="currentColor" /> {t('button.autosearch')}
            </Button>
            <Button asChild className="h-14 rounded-xl bg-white border-2 border-primary text-primary font-black text-xs shadow-lg uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-1.5">
              <Link href="/search?mode=nearby" prefetch={true}><Search size={16} className="stroke-[3px]" /> {t('home.nearby')}</Link>
            </Button>
          </div>
        </section>

        <section className="px-5 pt-8">
          <Button asChild className="h-16 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white font-black text-xs shadow-xl shadow-amber-500/20 uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-1.5">
            <Link href="/contest" prefetch={true}>
              <Trophy size={20} fill="currentColor" />
              <span className="text-sm">{t('contest.title')}</span>
            </Link>
          </Button>
        </section>

        {hangoutsEnabled && (
          <section className="px-5 pt-4">
            <Button asChild data-testid="home-hangouts" className="h-16 w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-black text-xs shadow-xl shadow-violet-500/20 uppercase tracking-widest active:scale-95 transition-all flex items-center justify-center gap-1.5">
              <Link href="/hangouts" prefetch={true}>
                <CalendarHeart size={20} />
                <span className="text-sm">{t('hangout.title')}</span>
              </Link>
            </Button>
          </section>
        )}

        <section className="pt-8">
          <div className="flex justify-center gap-8 mb-6 text-sm">
            <button
              onClick={() => setView('top-users')}
              className={cn(
                "font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 pb-2 relative",
                view === 'top-users'
                  ? "text-primary"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              <Star size={14} /> 
              <span>{t('home.top_week')}</span>
              {view === 'top-users' && <motion.div layoutId="active-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></motion.div>}
            </button>
            <button
              onClick={() => setView('popular-groups')}
              className={cn(
                "font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 pb-2 relative",
                view === 'popular-groups'
                  ? "text-primary"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              )}
            >
              <Users size={14} /> 
              <span>{t('home.popular_groups')}</span>
              {view === 'popular-groups' && <motion.div layoutId="active-underline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"></motion.div>}
            </button>
          </div>
        </section>

        {view === 'top-users' ? (
          <section>
            <Suspense fallback={<div className="px-5 pt-2 space-y-4"><Skeleton className="h-8 w-40" /><div className="grid grid-cols-2 gap-4"><Skeleton className="aspect-[4/3] rounded-xl" /></div></div>}>
              <TopOfWeekSection topUsers={topUsers} onLike={(u) => toast({ title: t('toast.liked'), description: t('toast.you_liked') + ' ' + u.name })} t={t} />
            </Suspense>
          </section>
        ) : (
          <section>
              <div className="px-5">
                <div className="grid grid-cols-2 gap-3">
                  {popularGroups.map((group) => {
                    const Icon = iconMap[group.icon] || Users;
                    return (
                      <Link
                        href={`/groups/${group.id}`}
                        key={group.id}
                        prefetch={true}
                        className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden hover:bg-primary/5 transition-all flex flex-col group"
                      >
                        <div className="h-20 w-full flex items-center justify-center border-b border-slate-200">
                          <Icon size={32} className="text-orange-500 group-hover:scale-110 transition-transform duration-300" />
                        </div>
                        <div className="p-4 text-center">
                          <h4 className="font-black text-xs uppercase tracking-tight leading-tight truncate">{language === 'RU' ? group.name_ru : group.name_en}</h4>
                          <p className="text-[10px] text-green-600 font-bold uppercase mt-2 flex items-center justify-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-current rounded-full"></span>
                            {group.onlineCount} {t('chats.online')}
                          </p>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
          </section>
        )}

      </main>

      {showAutosearchDialog && <AutosearchDialog open={showAutosearchDialog} onOpenChange={setShowAutosearchDialog} onAutosearch={runAutosearch} />}

      <BottomNav />
    </div>
  );
}
