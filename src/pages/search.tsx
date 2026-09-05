
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "@/shims/next-navigation";
import { MapPin, ChevronLeft, ChevronRight, X, Heart, MessageCircle, Flag, Sparkles, Trophy, SlidersHorizontal, Chrome as HomeIcon, LogIn, User as UserIcon } from "lucide-react";
import Image from "@/shims/next-image";
import dynamic from "@/shims/next-dynamic";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { toast } from "@/hooks/use-toast";
import { ALL_DEMO_USERS } from "@/lib/demo-data";
import Link from "@/shims/next-link";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { AttachmentStyle } from "@/lib/attachment-styles";
import { POPULAR_CITIES } from "@/lib/constants";
import { useTrackEvent } from "@/hooks/useExperiment";

const MatchDialog = dynamic(() => import('@/components/dialogs/match-dialog').then(mod => mod.MatchDialog), { ssr: false });
const FiltersDialog = dynamic(() => import('@/components/dialogs/filters-dialog').then(mod => mod.FiltersDialog), { ssr: false });

const cardVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 300 : -300, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction < 0 ? 300 : -300, opacity: 0 }),
};

const REPORT_REASONS = ['report.reason.spam', 'report.reason.abuse', 'report.reason.fake', 'report.reason.scam', 'report.reason.content'];

const attachmentCompatibilityScores: Record<AttachmentStyle, Record<AttachmentStyle, number>> = {
    secure: { secure: 2, anxious: 2, avoidant: 2 },
    anxious: { secure: 2, anxious: 1, avoidant: 0 },
    avoidant: { secure: 2, avoidant: 1, anxious: 0 },
};

function calculateAttachmentCompatibility(style1?: AttachmentStyle, style2?: AttachmentStyle): number {
    if (!style1 || !style2 || !attachmentCompatibilityScores[style1] || attachmentCompatibilityScores[style1][style2] === undefined) {
        return 0; // No info or invalid style, no bonus
    }
    return attachmentCompatibilityScores[style1][style2];
}

interface AutoSearchFilters {
  ageRange: [number, number];
  selectedCity: string;
  selectedCountry: string;
  distance: [number];
  selectedDatingGoal: string;
  selectedInterests: string[];
}
interface SearchUser {
  id: number;
  isSystem?: boolean;
  gender: string;
  lookingFor: string;
  age: number;
  city: string;
  distance: number;
  interests: string[];
  goal?: string;
  circadian?: string;
  attachmentStyle?: AttachmentStyle;
  boost?: { boostedUntil?: string };
}

function performAutosearch(filters: AutoSearchFilters, allUsers: SearchUser[], currentUser: SearchUser) {
    if (!filters || !currentUser) return [];

    const { ageRange, selectedCity, selectedCountry, distance, selectedDatingGoal, selectedInterests } = filters;

    const countryCityList = selectedCountry && POPULAR_CITIES[selectedCountry]
        ? POPULAR_CITIES[selectedCountry]
        : null;

    return allUsers
        .filter(user => {
            if (user.id === currentUser.id || user.isSystem) return false;

            const userGenderMatch = currentUser.lookingFor === 'all' || user.gender === currentUser.lookingFor;
            const currentUserGenderMatch = user.lookingFor === 'all' || currentUser.gender === user.lookingFor;
            if (!userGenderMatch || !currentUserGenderMatch) {
                return false;
            }
            
            const matchesAge = user.age >= ageRange[0] && user.age <= ageRange[1];
            const matchesCity = selectedCity === "all" || selectedCity === "Все" || user.city === selectedCity;
            const matchesCountry = !countryCityList || countryCityList.includes(user.city);
            const matchesDistance = user.distance <= distance[0];
            return matchesAge && matchesCity && matchesCountry && matchesDistance;
        })
        .map(user => {
            const normalizedUserInterests = user.interests.map((i: string) => i.startsWith('interest.') ? i.slice(9) : i);
            const commonInterests = normalizedUserInterests.filter((i: string) => selectedInterests.includes(i)).length;
            const hasMatchingGoal = selectedDatingGoal !== "all" && user.goal === selectedDatingGoal;
            const hasMatchingCircadian = currentUser.circadian && user.circadian && currentUser.circadian === user.circadian;
            const attachmentCompatibility = calculateAttachmentCompatibility(currentUser.attachmentStyle, user.attachmentStyle);
            const isCandidate = hasMatchingGoal || (commonInterests > 0);
            return { ...user, isCandidate, commonInterests, hasMatchingGoal, hasMatchingCircadian, attachmentCompatibility };
        })
        .filter(user => user.isCandidate)
        .sort((a, b) => {
            const aIsBoosted = a.boost && a.boost.boostedUntil && new Date(a.boost.boostedUntil) > new Date();
            const bIsBoosted = b.boost && b.boost.boostedUntil && new Date(b.boost.boostedUntil) > new Date();
            if (aIsBoosted !== bIsBoosted) return aIsBoosted ? -1 : 1;

            if (a.hasMatchingGoal !== b.hasMatchingGoal) return a.hasMatchingGoal ? -1 : 1;

            if (b.attachmentCompatibility !== a.attachmentCompatibility) return b.attachmentCompatibility - a.attachmentCompatibility;

            if (a.distance !== b.distance) return a.distance - b.distance;

            if (b.commonInterests !== a.commonInterests) return b.commonInterests - a.commonInterests;

            if (a.hasMatchingCircadian !== b.hasMatchingCircadian) return a.hasMatchingCircadian ? -1 : 1;

            return 0;
        });
}


function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t, language } = useLanguage();
  const trackEvent = useTrackEvent();
  const [userList, setUserList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageTitle, setPageTitle] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [matchUser, setMatchUser] = useState<any>(null);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportDescription, setReportDescription] = useState('');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [votedEntries, setVotedEntries] = useState<number[]>([]);
  const [hasError, setHasError] = useState(false);

  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [searchFilters, setSearchFilters] = useState(null);

  useEffect(() => {
    const saved = localStorage.getItem('userProfile');
    let userToSet;
    if (saved) {
      try {
        userToSet = JSON.parse(saved);
      } catch (e) {
        userToSet = ALL_DEMO_USERS[0];
      }
    } else {
      userToSet = ALL_DEMO_USERS[0];
    }
    if (!userToSet.img || !userToSet.photoURL) {
      const demoMatch = ALL_DEMO_USERS.find(u => u.name === (userToSet.displayName || userToSet.name)) || ALL_DEMO_USERS.find(u => u.gender === userToSet.gender) || ALL_DEMO_USERS[0];
      userToSet.img = userToSet.img || demoMatch.img;
      userToSet.photoURL = userToSet.photoURL || demoMatch.img;
    }
    setCurrentUser(userToSet);

    const userIndex = ALL_DEMO_USERS.findIndex(u => u.id === userToSet.id);
    if (userIndex !== -1) {
        ALL_DEMO_USERS[userIndex] = userToSet;
    }

  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const mode = searchParams.get('mode');
    let initialUsers: any[] = [];
    setIsLoading(true);
    if (mode === 'autosearch') {
        setPageTitle(t('button.autosearch'));
        const filters = JSON.parse(sessionStorage.getItem('autosearchFilters') || 'null');
        setSearchFilters(filters);
        if (filters) {
            setSelectedInterests(filters.selectedInterests || []);
            initialUsers = performAutosearch(filters, ALL_DEMO_USERS, currentUser);
        } else {
            initialUsers = ALL_DEMO_USERS.slice(1, 11);
        }
    } else {
        setPageTitle(t('home.nearby'));
        initialUsers = ALL_DEMO_USERS.filter(u => u.id !== currentUser.id && !u.isSystem).slice(0, 10);
        setSelectedInterests([]);
    }
    setUserList(initialUsers);
    setCurrentIndex(0);
    setIsLoading(false);
  }, [searchParams, currentUser, t]);

  useEffect(() => {
    if (userList.length > 0) return;
    const timer = setTimeout(() => {
      if (userList.length === 0) setHasError(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [isLoading, userList.length]);
  
  const handleApplyFilters = (newFilters: any) => {
      sessionStorage.setItem('autosearchFilters', JSON.stringify(newFilters));
      setSearchFilters(newFilters);
      setIsLoading(true);
      setSelectedInterests(newFilters.selectedInterests || []);
      const newUsers = performAutosearch(newFilters, ALL_DEMO_USERS, currentUser);
      setUserList(newUsers);
      setCurrentIndex(0);
      setIsLoading(false);
      setIsFiltersOpen(false);
      toast({ title: t('toast.filters_applied'), description: t('toast.filters_applied_desc', { count: newUsers.length }) });
  }

  const user = userList[currentIndex] || null;

  const handleNext = () => { 
    if (currentIndex < userList.length - 1) {
      setDirection(1); 
      setCurrentIndex(prev => prev + 1); 
    } else {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => { 
    if (currentIndex > 0) { 
      setDirection(-1); 
      setCurrentIndex(prev => prev - 1); 
    } 
  };

  const handleLike = async () => {
    if (!user) return;
    trackEvent('swipe_like', { target_user_id: user.id });
    toast({ title: t('toast.like'), description: t('toast.you_liked_desc', { name: user.name }) });
    if (Math.random() > 0.7) {
      setMatchUser(user);
    } else {
      handleNext();
    }
  };
  
  const handleSuperLike = async () => {
    if (!user) return;
    trackEvent('swipe_super_like', { target_user_id: user.id });
    if ((currentUser.superLikes || 0) > 0) {
      const updatedUser = { ...currentUser, superLikes: currentUser.superLikes - 1 };
      setCurrentUser(updatedUser);
      localStorage.setItem('userProfile', JSON.stringify(updatedUser));
      toast({ title: t('toast.super_like'), description: t('toast.super_like_desc', { name: user.name }) });
      setMatchUser(user);
    } else {
      toast({ variant: 'destructive', title: t('toast.no_super_likes'), description: t('toast.no_super_likes_desc') });
    }
  };

  const handleVote = (e: React.MouseEvent, userId: number) => {
    e.stopPropagation();
    if (votedEntries.includes(userId)) return;
    setVotedEntries([...votedEntries, userId]);
    toast({
      title: t('toast.vote_accepted'),
      description: t('toast.vote_accepted_desc'),
    });
  };

  const handleReportSubmit = () => {
    if (!reportReason) {
      toast({ variant: 'destructive', title: t('report.toast.no_reason_title'), description: t('report.toast.no_reason_desc') });
      return;
    }
    toast({ title: t('report.toast.success_title'), description: `${t('report.toast.success_desc')} ${user?.name || ''}.` });
    setIsReportDialogOpen(false);
    setReportReason('');
    setReportDescription('');
  };

  if (hasError) {
    return (
      <>
        <AppHeader />
        <main className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#f8f9fb] pb-24">
          <Sparkles size={48} className="text-muted-foreground opacity-20 mb-4" />
          <h4 className="text-xl font-black uppercase mb-6">{t('search.no_profiles')}</h4>
          <div className="flex flex-col gap-3 w-full max-w-[240px]">
            <Button onClick={() => router.push('/')} variant="outline" className="w-full h-12 rounded-xl font-black uppercase text-[11px] tracking-widest flex items-center gap-2">
              <HomeIcon size={16} /> {t('nav.home')}
            </Button>
            <Button onClick={() => router.push('/login')} className="w-full h-12 rounded-xl gradient-bg text-white font-black uppercase text-[11px] tracking-widest border-0 flex items-center gap-2">
              <LogIn size={16} /> {t('nav.login')}
            </Button>
            <Button onClick={() => router.back()} variant="outline" className="w-full h-12 rounded-xl font-black uppercase text-[11px] tracking-widest flex items-center gap-2" disabled={window.history.length <= 1}>
              <ChevronLeft size={16} /> {t('button.back')}
            </Button>
          </div>
        </main>
        <BottomNav />
      </>
    );
  }

  if (isLoading) return <div className="flex-1 flex items-center justify-center h-full"><Skeleton className="w-[90%] h-[70vh] rounded-2xl" /></div>;

  const noMoreUsers = !user || currentIndex >= userList.length;

  return (
    <>
      <AppHeader />
      <main className="flex-1 overflow-hidden px-4 pt-4 pb-24 flex flex-col items-center relative bg-[#f8f9fb]">
        <div className="text-center mb-4 flex items-center gap-2">
            <Badge variant="outline" className="text-[8px] font-bold bg-white">{currentIndex + 1} / {userList.length}</Badge>
            <Badge variant="secondary" className="text-[8px] font-bold text-primary bg-primary/5">{pageTitle}</Badge>
            {searchParams.get('mode') === 'autosearch' && (
                <button onClick={() => setIsFiltersOpen(true)} className="p-2 bg-white rounded-full shadow-sm">
                    <SlidersHorizontal size={14} className="text-primary" />
                </button>
            )}
        </div>
        
        {noMoreUsers ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center h-full bg-[#f8f9fb]">
                <Sparkles size={48} className="text-muted-foreground opacity-20 mb-4" />
                <h4 className="text-xl font-black uppercase">{t('search.no_profiles')}</h4>
                <p className="text-sm text-muted-foreground mt-2">{t('search.no_profiles_desc')}</p>
                <Button data-testid="change-filters" variant="outline" onClick={() => setIsFiltersOpen(true)} className="mt-8 rounded-full px-8 uppercase text-[10px] font-black">{t('button.change_filters')}</Button>
            </div>
        ) : (
          <>
            <div className="relative w-full flex-1 mb-10 max-w-[360px] flex items-center justify-center">
              <Button data-testid="prev-profile" variant="ghost" size="icon" onClick={handlePrev} disabled={currentIndex === 0} className="absolute -left-4 z-20 w-10 h-10 rounded-full bg-white/80 shadow-lg border-0"><ChevronLeft size={24} /></Button>
              <Button data-testid="next-profile" variant="ghost" size="icon" onClick={handleNext} disabled={currentIndex >= userList.length - 1} className="absolute -right-4 z-20 w-10 h-10 rounded-full bg-white/80 shadow-lg border-0"><ChevronRight size={24} /></Button>

              <AnimatePresence mode="wait" custom={direction}>
                {user && <motion.div
                  key={user.id}
                  custom={direction}
                  variants={cardVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2 }
                  }}
                  className="absolute w-full h-full bg-white rounded-2xl overflow-hidden app-shadow border-4 border-white cursor-pointer group anti-screenshot"
                  onClick={() => router.push(`/user?id=${user.id}`)}
                >
                  <Image 
                    src={user.img} 
                    alt={user.name} 
                    fill 
                    sizes="(max-width: 360px) 100vw, 360px"
                    priority={currentIndex === 0}
                    className="object-cover transition-transform duration-700 group-hover:scale-105" 
                  />
                  
                  <button 
                    onClick={(e) => handleVote(e, user.id)}
                    className={cn(
                      "absolute top-4 right-4 z-30 h-12 w-auto px-4 rounded-full backdrop-blur-md flex items-center justify-center transition-all active:scale-90 border-2 gap-2",
                      votedEntries.includes(user.id) 
                        ? "bg-orange-500 text-white border-orange-400 shadow-xl"
                        : "bg-black/40 text-white border-white/20 shadow-lg hover:bg-black/50"
                    )}
                  >
                    {!votedEntries.includes(user.id) && <span className="font-bold text-sm">{t('button.vote')}</span>}
                    <Trophy size={20} fill={votedEntries.includes(user.id) ? "currentColor" : "none"} />
                  </button>

                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent"></div>
                  <div className="absolute bottom-6 left-6 right-6 text-white text-left">
                    <h3 className="text-3xl font-black font-headline mb-1">{user.name}, {user.age}</h3>
                    <p className="text-white/90 text-xs flex items-center gap-1 font-bold mb-3"><MapPin size={14} /> {user.distance} {t('units.km')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {user.interests.slice(0, 3).map((interest: string) => {
                        const isCommon = selectedInterests.includes(interest);
                        return (
                          <span key={interest} className={cn(
                            "px-2.5 py-1 backdrop-blur-md text-[9px] rounded-full font-black uppercase tracking-widest border transition-all flex items-center gap-1",
                            isCommon 
                              ? "bg-primary text-white border-primary shadow-lg shadow-primary/20 scale-110 z-10" 
                              : "bg-white/20 text-white border-white/10"
                          )}>
                            {isCommon && <Sparkles size={8} className="fill-current" />}
                            {t(interest)}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>}
              </AnimatePresence>
            </div>

            <div className="flex justify-center items-center w-full max-w-sm gap-2">
                <Button
                    variant="outline"
                    className="w-[3.5rem] h-[3.5rem] rounded-full bg-white shadow-xl border-0 text-slate-400 hover:text-slate-600 active:scale-90 transition-all flex items-center justify-center"
                    onClick={handleNext}
                >
                    <X size={26} strokeWidth={3} />
                </Button>
                <Button
                    className="relative w-16 h-16 rounded-full bg-blue-500 text-white shadow-2xl shadow-blue-500/40 hover:scale-110 active:scale-95 transition-all border-0 disabled:bg-slate-300 disabled:shadow-none flex items-center justify-center"
                    onClick={handleSuperLike}
                    disabled={(currentUser?.superLikes || 0) === 0}
                >
                    <Sparkles size={32} fill="currentColor" />
                    <span className="absolute bottom-1.5 text-[10px] font-bold">{currentUser?.superLikes || 0}</span>
                </Button>
                <Button
                    className="w-[4.5rem] h-[4.5rem] rounded-full gradient-bg text-white shadow-2xl shadow-primary/40 hover:scale-110 active:scale-95 transition-all border-0 flex items-center justify-center"
                    onClick={handleLike}
                >
                    <Heart size={36} fill="currentColor" />
                </Button>
                <Button
                    asChild
                    variant="outline"
                    className="w-[3.5rem] h-[3.5rem] rounded-full bg-white shadow-xl border-0 text-green-400 hover:text-green-600 active:scale-90 transition-all flex items-center justify-center"
                >
                    <Link href={`/chats?matchId=${user.id}`}>
                        <MessageCircle size={28} />
                    </Link>
                </Button>
                <Button
                    asChild
                    variant="outline"
                    data-testid={`search-profile-btn-${user.id}`}
                    className="w-[3.5rem] h-[3.5rem] rounded-full bg-white shadow-xl border-0 text-blue-400 hover:text-blue-600 active:scale-90 transition-all flex items-center justify-center"
                >
                    <Link href={`/user?id=${user.id}`} prefetch={true} onClick={(e) => e.stopPropagation()}>
                        <UserIcon size={26} strokeWidth={2} />
                    </Link>
                </Button>

            </div>

            <Button
                asChild
                variant="outline"
                className="mt-8 mb-8 h-9 px-8 rounded-full bg-white shadow-lg border-0 text-primary font-bold active:scale-95 transition-all text-sm"
            >
                <Link href={`/user?id=${user.id}`} prefetch={true}>
                    {t('search.open_profile')}
                </Link>
            </Button>

          </>
        )}
      </main>
      
      {matchUser && (
        <MatchDialog
          open={!!matchUser}
          onOpenChange={(open) => !open && setMatchUser(null)}
          currentUser={currentUser}
          matchUser={matchUser}
        />
      )}

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent className="max-w-[400px] rounded-3xl border-0 p-0 bg-white app-shadow">
          <DialogHeader className="p-6 pb-4 text-left">
              <DialogTitle className="flex items-center gap-2 font-black tracking-tight">
                  <Flag size={20} className="text-destructive" />
                  {t('report.title')}
              </DialogTitle>
              <DialogDescription className="pt-2">
                  {t('report.description')}
              </DialogDescription>
          </DialogHeader>
          <div className="px-6 space-y-4">
              <RadioGroup value={reportReason} onValueChange={setReportReason} className="space-y-2">
                  {REPORT_REASONS.map(reasonKey => (
                      <div key={reasonKey} className="flex items-center space-x-3 bg-muted/40 p-3 rounded-lg">
                          <RadioGroupItem value={t(reasonKey)} id={reasonKey} />
                          <Label htmlFor={reasonKey} className="font-bold text-sm cursor-pointer">{t(reasonKey)}</Label>
                      </div>
                  ))}
              </RadioGroup>
              <Textarea placeholder={t('report.details_placeholder')} value={reportDescription} onChange={(e) => setReportDescription(e.target.value)} className="min-h-[80px] rounded-xl bg-muted/40 border-0 focus-visible:ring-primary/20" />
          </div>
          <DialogFooter className="p-6 flex-row gap-2 justify-end bg-muted/20 rounded-b-3xl">
              <Button variant="ghost" className="rounded-full" onClick={() => setIsReportDialogOpen(false)}>{t('report.button.cancel')}</Button>
              <Button className="bg-destructive hover:bg-destructive/90 text-destructive-foreground rounded-full" onClick={handleReportSubmit}>{t('report.button.send')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {searchFilters && <FiltersDialog 
        open={isFiltersOpen} 
        onOpenChange={setIsFiltersOpen} 
        currentFilters={searchFilters}
        onApplyFilters={handleApplyFilters}
      />}
      
      <BottomNav />
    </>
  );
}

export default function SearchPage() {
    return <Suspense fallback={<div className="flex-1 flex items-center justify-center h-full"><Skeleton className="w-[90%] h-[70vh] rounded-2xl" /></div>}><SearchContent /></Suspense>;
}
