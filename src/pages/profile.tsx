
import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "@/shims/next-navigation";
import { Settings, CircleCheck as CheckCircle2, Camera, Coffee, Music, Globe, Dumbbell, Edit2, Palette, Film, Flower2, Briefcase, Gamepad2, Dog, Ruler, Target, User, Info, Trophy, Heart, VenetianMask, Search, Maximize2, Trash2, X, Star, Check, CircleHelp as HelpCircle, Rocket, CreditCard, Video, BrainCircuit, Users, ChevronRight, AtSign } from "lucide-react";
import { VerificationBadge } from "@/components/shared/verification";
import Image from "@/shims/next-image";
import Link from "@/shims/next-link";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { AppHeader } from "@/components/layout/app-header";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { GROUP_CATEGORIES } from "@/lib/demo-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/context/language-context";
import { cn, getUserTitles } from "@/lib/utils";
import { BANNED_WORDS } from "@/lib/constants";
import { ZodiacIcon } from "@/components/shared/zodiac-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { getToken } from "@/lib/token";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
} from "@/components/ui/carousel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ATTACHMENT_STYLE_INFO } from "@/lib/attachment-styles";

const interestIconsMap: Record<string, any> = {
  "Photography": Camera, "Travel": Globe, "Sports": Dumbbell, "Art": Palette, "Movies": Film, "Yoga": Flower2, "Business": Briefcase, "Gaming": Gamepad2, "Cats": Dog,
  "interest.photography": Camera, "interest.travel": Globe, "interest.coffee": Coffee, "interest.music": Music, "interest.sport": Dumbbell, "interest.art": Palette, "interest.movies": Film, "interest.yoga": Flower2, "interest.games": Gamepad2, "interest.animals": Dog, "interest.books": Heart, "interest.cooking": Coffee, "interest.design": Palette, "interest.nature": Flower2, "interest.fashion": Briefcase, "interest.dance": Music, "interest.tech": Briefcase, "interest.volunteering": Heart, "interest.politics": Briefcase, "interest.psychology": Heart, "interest.philosophy": Heart, "interest.meditation": Flower2, "interest.gardening": Flower2, "interest.cars": Briefcase, "interest.science": Briefcase, "interest.history": Heart, "interest.architecture": Briefcase,
  "interest.coffee": Coffee, "interest.diy": Dumbbell, "interest.extreme": Rocket, "interest.films": Film, "interest.food": Coffee, "interest.hiking": Globe, "interest.martial_arts": Dumbbell, "interest.podcasts": Video,
  "interest.gaming": Gamepad2, "interest.dancing": Music, "interest.reading": Heart, "interest.technology": Briefcase, "interest.astronomy": Star, "interest.board_games": Gamepad2,
};

export default function ProfilePage() {
  const router = useRouter();
  const { t, language } = useLanguage();
  const [profile, setProfile] = useState<any>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const [isBoosted, setIsBoosted] = useState(false);
  
  const [photoToDelete, setPhotoToDelete] = useState<number | null>(null);
  const [isViewerOpen, setIsViewerOpen] = useState(false);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const storiesInputRef = useRef<HTMLInputElement>(null);

  // Stories states
  const [stories, setStories] = useState<any[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [aliases, setAliases] = useState<{ id: number; alias: string; is_primary: boolean }[]>([]);
  const [photoVerified, setPhotoVerified] = useState(false);

  // Contest states
  const [isSelectionOpen, setIsSelectionOpen] = useState(false);
  const [selectedPhotoForContest, setSelectedPhotoForContest] = useState<string | null>(null);
  const [hasParticipated, setHasParticipated] = useState(false);

  // Boost Dialog
  const [isBoostDialogOpen, setIsBoostDialogOpen] = useState(false);

type InterestInput = string | { name_ru?: string; name_en?: string };

function normalizeInterests(interests: InterestInput[]): string[] {
  if (!Array.isArray(interests)) return []
  if (interests.length === 0) return []
  if (typeof interests[0] === 'string') return [...new Set(interests.map((i: string) => i === 'interest.technology' ? 'interest.tech' : i))].filter((i: string) => !BANNED_WORDS.includes(i))
  const nameToKey: Record<string, string> = {
    'Спорт': 'interest.sport', 'Музыка': 'interest.music', 'Фотография': 'interest.photography',
    'Путешествия': 'interest.travel', 'Кофе': 'interest.coffee', 'Искусство': 'interest.art',
    'Кино': 'interest.movies', 'Йога': 'interest.yoga', 'Бизнес': 'interest.business',
    'Игры': 'interest.games', 'Кошки': 'interest.animals', 'Чтение': 'interest.books',
    'Кулинария': 'interest.cooking', 'Творчество': 'interest.art', 'Природа': 'interest.nature',
    'Рукоделие': 'interest.diy', 'Дизайн': 'interest.design', 'Мода': 'interest.fashion',
    'Танцы': 'interest.dance', 'Технологии': 'interest.tech', 'Волонтерство': 'interest.volunteering',
    'Политика': 'interest.politics', 'Психология': 'interest.psychology', 'Философия': 'interest.philosophy',
    'Медитация': 'interest.meditation', 'Садоводство': 'interest.gardening', 'Автомобили': 'interest.cars',
    'Наука': 'interest.science', 'История': 'interest.history', 'Архитектура': 'interest.architecture',
    'Экстрим': 'interest.extreme', 'Фильмы': 'interest.films', 'Еда': 'interest.food',
    'Походы': 'interest.hiking', 'Единоборства': 'interest.martial_arts', 'Подкасты': 'interest.podcasts',
    'Sports': 'interest.sport', 'Music': 'interest.music', 'Photography': 'interest.photography',
    'Travel': 'interest.travel', 'Coffee': 'interest.coffee', 'Art': 'interest.art',
    'Movies': 'interest.movies', 'Yoga': 'interest.yoga', 'Business': 'interest.business',
    'Gaming': 'interest.games', 'Cats': 'interest.animals', 'Books': 'interest.books',
    'Cooking': 'interest.cooking', 'Nature': 'interest.nature', 'Design': 'interest.design',
    'Fashion': 'interest.fashion', 'Dance': 'interest.dance',
    'Tech': 'interest.tech', 'Animals': 'interest.animals', 'Volunteering': 'interest.volunteering',
    'Politics': 'interest.politics', 'Psychology': 'interest.psychology', 'Philosophy': 'interest.philosophy',
    'Meditation': 'interest.meditation', 'Gardening': 'interest.gardening', 'Cars': 'interest.cars',
    'Science': 'interest.science', 'History': 'interest.history', 'Architecture': 'interest.architecture',
    'DIY': 'interest.diy', 'Extreme': 'interest.extreme', 'Films': 'interest.films',
    'Food': 'interest.food', 'Hiking': 'interest.hiking', 'Martial Arts': 'interest.martial_arts',
    'Podcasts': 'interest.podcasts',
    'Sport': 'interest.sport', 'Животные': 'interest.animals',
    'Питомцы': 'interest.pets', 'Pets': 'interest.pets',
  }
  return interests.map((i: InterestInput) => {
    if (typeof i === 'string') return i
    const ru = i.name_ru && !/^\?+$/.test(i.name_ru) ? i.name_ru : i.name_en
    return nameToKey[ru || ''] || ru || ''
  }).filter((i: string) => !BANNED_WORDS.includes(i))
}

  useEffect(() => {
    setIsMounted(true);

    const savedProfile = localStorage.getItem('userProfile');
    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile);
        if (parsed.displayName && /^\?+$/.test(parsed.displayName)) throw new Error('corrupted');
        if (parsed.bio && /^\?+$/.test(parsed.bio)) throw new Error('corrupted');
        if (parsed.city && /^\?+$/.test(parsed.city)) throw new Error('corrupted');
        if (parsed.interests && Array.isArray(parsed.interests)) {
            parsed.interests = normalizeInterests(parsed.interests);
        }
        setProfile({
          ...parsed,
          displayName: parsed.displayName || parsed.name || t('profile.someone'),
          lookingFor: parsed.gender === 'female' ? 'male' : parsed.lookingFor,
        });
      } catch (e) {
        if (import.meta.env.DEV) console.error("Failed to parse profile", e);
      }
    } else {
      setProfile({
        displayName: t('profile.demo_name'),
        age: 24,
        city: t('profile.demo_city'),
        height: 172,
        gender: "female",
        lookingFor: "male",
        datingGoal: "goal.serious_relationship",
        zodiac: "common.zodiac.leo",
        bio: t('profile.demo_bio'),
        interests: ["interest.photography", "interest.travel", "interest.coffee", "interest.music", "interest.sport"].filter(i => !BANNED_WORDS.includes(i)),
        match: 87,
        attachmentStyle: null,
      });
    }

    (async () => {
      try {
        const res = await fetch('/api/profile/2')
        if (res.ok) {
          const data = await res.json()
          const apiInterests = normalizeInterests(data.interests)
          setProfile(prev => {
            const updated = {
              displayName: data.display_name || prev?.displayName || t('profile.someone'),
              age: data.age || prev?.age || 24,
              city: data.city || prev?.city || t('profile.demo_city'),
              height: data.height || prev?.height || 172,
              gender: data.gender || prev?.gender || 'female',
              lookingFor: data.looking_for || prev?.lookingFor || 'male',
              datingGoal: data.dating_goal || prev?.datingGoal || '',
              zodiac: data.zodiac || prev?.zodiac || '',
              bio: data.bio || prev?.bio || '',
              interests: apiInterests.length > 0 ? apiInterests : prev?.interests || [],
              match: prev?.match || 87,
              attachmentStyle: data.attachment_style || prev?.attachmentStyle || null,
            }
            localStorage.setItem('userProfile', JSON.stringify(updated))
            return { ...prev, ...updated }
          })
          return
        }
      } catch { /* ignored */ }
    })();
    
    (async () => {
      try {
        const res = await fetch('/api/photos/2', {
          headers: { Authorization: `Bearer ${getToken()}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.length > 0) {
            setPhotos(data.map((p: { url: string }) => p.url))
            return
          }
        }
      } catch { /* ignored */ }
      const savedPhotos = localStorage.getItem('userProfileGallery');
      if (savedPhotos) {
        setPhotos(JSON.parse(savedPhotos));
      } else {
        const defaultPhotos = [PlaceHolderImages[0].imageUrl, PlaceHolderImages[2].imageUrl, PlaceHolderImages[4].imageUrl];
        setPhotos(defaultPhotos);
        localStorage.setItem('userProfileGallery', JSON.stringify(defaultPhotos));
      }
    })();

    const savedStories = localStorage.getItem('userProfileStories');
    if (savedStories) {
      setStories(JSON.parse(savedStories));
    }

    const participationStatus = localStorage.getItem('contest_participation');
    if (participationStatus) setHasParticipated(true);


    // Cleanup blob URLs on unmount
    return () => {
      photos.forEach(photo => {
        if (photo.startsWith('blob:')) {
          URL.revokeObjectURL(photo);
        }
      });
      stories.forEach(story => {
        if (story.url.startsWith('blob:')) {
          URL.revokeObjectURL(story.url);
        }
      });
    };
  }, [t]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch("/api/profile/aliases", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (Array.isArray(data)) setAliases(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch("/api/profile/verification", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.verified) setPhotoVerified(true); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (profile?.boost?.boostedUntil) {
        const boostEndDate = new Date(profile.boost.boostedUntil);
        if (boostEndDate > new Date()) {
            setIsBoosted(true);
            const timeLeft = Math.round((boostEndDate.getTime() - new Date().getTime()) / 60000);
            toast({ title: t('toast.boost_active'), description: t('toast.boost_active_desc', { minutes: timeLeft }) });
        }
    }
  }, [profile]);

  const handleAddPhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const file = event.target.files[0];

      const previewUrl = URL.createObjectURL(file);
      setPhotos((prev) => [...prev, previewUrl]);

      const formData = new FormData();
      formData.append('photo', file);
      formData.append('user_id', '2');
      formData.append('sort_order', String(photos.length));

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (res.ok) {
          toast({ title: t('toast.photo_uploaded'), description: t('toast.photo_uploaded_desc') });
        }
      } catch {
        toast({ variant: 'destructive', title: t('common.error') });
      }

      const fileToDataUrl = (f: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(f);
        });

      fileToDataUrl(file)
        .then((dataUrl) => {
          setPhotos((prev) => {
            const next = [...prev];
            const idx = next.lastIndexOf(previewUrl);
            if (idx !== -1) next[idx] = dataUrl;

            localStorage.setItem("userProfileGallery", JSON.stringify(next));
            return next;
          });
        })
        .catch((e) => {
          if (import.meta.env.DEV) console.error("Photo convert error:", e);
          // Если конвертация не удалась, оставляем preview, но оно не переживет перезагрузку.
        })
        .finally(() => {
          event.target.value = "";
        });
    }
  };

  const handleAddStoryClick = () => {
    storiesInputRef.current?.click();
  };

  const handleStoryFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files[0]) {
        const file = event.target.files[0];
        const videoUrl = URL.createObjectURL(file);
        const storyId = `story_${Date.now()}`;

        const newStory = { id: storyId, url: videoUrl, isUploading: true };
        setStories(prev => [newStory, ...prev]);

        let progress = 0;
        setUploadProgress(prev => ({ ...prev, [storyId]: 0 }));
        
        const interval = setInterval(() => {
          progress += Math.random() * 15 + 5; // Simulate 5-15 second upload
          if (progress > 100) progress = 100;
          
          setUploadProgress(prev => ({ ...prev, [storyId]: progress }));

          if (progress >= 100) {
            clearInterval(interval);
            
            const finalStories = stories.map(s => s.id === storyId ? { ...s, url: videoUrl, isUploading: false } : s);
            localStorage.setItem('userProfileStories', JSON.stringify(finalStories));

            setStories(prev => prev.map(s => s.id === storyId ? { ...s, isUploading: false } : s));
            
            setTimeout(() => {
              setUploadProgress(prev => {
                const newProgress = { ...prev };
                delete newProgress[storyId];
                return newProgress;
              });
            }, 1000);
          }
        }, 700);
        
        event.target.value = '';
      }
  };


  const handleDeletePhoto = () => {
    if (photoToDelete === null) return;
    
    if (photos.length <= 1) {
      toast({
        variant: "destructive",
        title: t('delete_photo_error.title'),
        description: t('delete_photo_error.description'),
      });
      setPhotoToDelete(null);
      return;
    }
    
    const photoUrlToDelete = photos[photoToDelete];
    if (photoUrlToDelete.startsWith('blob:')) {
      URL.revokeObjectURL(photoUrlToDelete);
    }

    const newPhotos = photos.filter((_, i) => i !== photoToDelete);
    setPhotos(newPhotos);
    
    const persistentPhotos = newPhotos.filter(p => !p.startsWith('blob:'));
    localStorage.setItem('userProfileGallery', JSON.stringify(persistentPhotos));

    toast({ title: t('toast.photo_deleted') });
    setPhotoToDelete(null);
  };

  const openViewer = (index: number) => {
    setActivePhotoIndex(index);
    setIsViewerOpen(true);
  };

  const handleSubmitToContest = () => {
    if (!selectedPhotoForContest) return;
    if (selectedPhotoForContest.startsWith('blob:')) {
        toast({ variant: 'destructive', title: t('toast.error'), description: t('toast.contest_temp_error') })
        return;
    }
    setHasParticipated(true);
    localStorage.setItem('contest_participation', 'true');
    setIsSelectionOpen(false);
    toast({
      title: t('toast.contest_accepted'),
      description: t('toast.contest_accepted_desc'),
    });
  };
  
  const activateBoost = () => {
    if (isBoosted) {
      toast({ title: t('toast.boost_already_active') });
      return;
    }
    const boostEndTime = new Date(new Date().getTime() + 30 * 60 * 1000);
    const updatedUser = { ...profile, boost: { boostedUntil: boostEndTime.toISOString() } };
    setProfile(updatedUser);
    localStorage.setItem('userProfile', JSON.stringify(updatedUser));
    setIsBoosted(true);
    toast({
      title: t('toast.boost_activated'),
      description: t('toast.boost_activated_desc'),
    });
  };

  const handleBoost = (method: 'ad' | 'payment') => {
    setIsBoostDialogOpen(false);
    if (method === 'ad') {
      activateBoost();
    } else {
      toast({
        title: t('toast.payment'),
        description: t('toast.payment_coming_soon'),
      });
    }
  };

  if (!isMounted || !profile) return (
    <div className="flex flex-col h-screen bg-[#f8f9fb]">
      <AppHeader />
      <main className="flex-1 p-6"><Skeleton className="h-64 w-full rounded-2xl" /></main>
      <BottomNav />
    </div>
  );

  const earnedTitles = getUserTitles(profile, language);
  const joinedGroupNames: string[] = profile?.joinedGroups || [];

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fb]">
       <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileSelected} 
        style={{ display: 'none' }} 
        accept="image/*"
      />
      <input 
        type="file"
        ref={storiesInputRef}
        onChange={handleStoryFileSelected}
        style={{ display: 'none' }}
        accept="video/mp4,video/quicktime,video/x-matroska"
      />
      <AppHeader />
      <main className="flex-1 overflow-y-auto pb-24">
        <div className="h-24 gradient-bg relative -mx-5 mb-10">
          <div className="absolute top-1/2 -translate-y-1/2 left-[calc(50%+4rem)] right-0 flex justify-center gap-3">
            <Link href="/profile/edit" className="text-white/90 p-2 bg-black/10 rounded-full backdrop-blur-md transition-all active:scale-95"><Edit2 size={18} /></Link>
            <Link href="/faq" className="text-white/90 p-2 bg-black/10 rounded-full backdrop-blur-md transition-all active:scale-95"><HelpCircle size={18} /></Link>
            <Link href="/settings" className="text-white/90 p-2 bg-black/10 rounded-full backdrop-blur-md transition-all active:scale-95"><Settings size={18} /></Link>
          </div>
        </div>
        
        <div className="-mt-20 px-5">
          <div className="text-center mb-6">
            <div className="relative inline-block mb-4">
              <div className="relative w-32 h-32 rounded-2xl border-[6px] border-white app-shadow overflow-hidden bg-muted anti-screenshot">
                <Image src={photos[0] || PlaceHolderImages[0].imageUrl} alt="Profile" fill className="object-cover" />
              </div>
            </div>
            <h3 className="text-2xl font-black font-headline tracking-tight flex items-center justify-center gap-2">{profile.displayName}, {profile.age} <CheckCircle2 size={20} className="text-primary" fill="currentColor" />{photoVerified && <VerificationBadge verified className="ml-1" />}</h3>
            {aliases.length > 0 && (
              <div className="flex flex-wrap justify-center gap-1.5 mt-1.5">
                {aliases.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 text-[10px] font-bold text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                    <AtSign size={9} />{a.alias}{a.is_primary && <Star size={9} className="text-amber-500" fill="currentColor" />}
                  </span>
                ))}
              </div>
            )}
            <p className="text-muted-foreground text-[10px] font-black uppercase tracking-widest opacity-80 mt-1">{profile.city}</p>
            <div className="mt-4 flex justify-center">
                <Button 
                    onClick={() => setIsBoostDialogOpen(true)} 
                    className={cn("h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg transition-all text-white active:scale-95 px-6", isBoosted ? "bg-purple-600 shadow-purple-600/40 animate-pulse" : "bg-orange-500 shadow-orange-500/40")}
                >
                    <Rocket size={16} className="mr-2"/>
                    {isBoosted ? t('profile.boost_active') : t('profile.boost')}
                </Button>
            </div>
          </div>

          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="grid w-full grid-cols-4 bg-muted p-1 rounded-xl mb-6">
              <TabsTrigger value="profile" className="text-[11px]">{t('profile.tab.data')}</TabsTrigger>
              <TabsTrigger value="gallery" className="text-[11px]">{t('profile.tab.gallery')}</TabsTrigger>
              <TabsTrigger value="stories" className="text-[11px]">{t('profile.tab.stories')}</TabsTrigger>
              <TabsTrigger value="groups" className="text-[11px]">{t('profile.tab.groups')}</TabsTrigger>
            </TabsList>
            <TabsContent value="profile">
              <div className="bg-white rounded-2xl p-6 app-shadow border border-border/40 space-y-6">
                {(() => {
                  const p = profile
                  let score = 0
                  if (p?.displayName) score += 10
                  if (p?.bio) score += Math.min(15, Math.floor((p.bio?.length || 0) / 15))
                  if (p?.gender) score += 5
                  if (p?.city) score += 10
                  if (p?.zodiac) score += 5
                  if (p?.education) score += 5
                  if (p?.datingGoal) score += 10
                  if (p?.height) score += 5
                  if (p?.attachmentStyle) score += 5
                  const photoCount = p?.photos?.length || 0
                  score += Math.min(15, photoCount * 5)
                  const interestCount = p?.interests?.length || 0
                  score += Math.min(15, interestCount * 3)
                  score = Math.min(100, score)
                  const label = score < 40 ? 'profile.score_low' : score < 70 ? 'profile.score_medium' : score < 90 ? 'profile.score_high' : 'profile.score_perfect'
                  const color = score < 40 ? 'bg-red-500' : score < 70 ? 'bg-amber-500' : score < 90 ? 'bg-green-500' : 'bg-primary'
                  return (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Target size={16} className="text-primary" />
                          <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.score')}</h4>
                        </div>
                        <span className="text-[11px] font-black">{score}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
                      </div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t(label)}</p>
                    </div>
                  )
                })()}
                {earnedTitles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Trophy size={16} className="text-primary" />
                      <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.rank')}</h4>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {earnedTitles.map((title) => (
                        <Badge key={title.id} variant="secondary" className={cn("border-0 gap-2 py-2 px-3.5 font-bold text-[10px] rounded-lg shadow-sm", title.color)}>
                          <Star size={12} fill="currentColor" className="opacity-70" /> {title.displayName}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600"><Info size={14} /></div>
                    <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.about')}</h4>
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed font-medium italic">"{profile.bio}"</p>
                </div>

                <div className="h-px bg-border/50"></div>

                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><User size={14} /></div>
                    <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.data_interests')}</h4>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t('profile.label.gender')}</span>
                      <Badge variant="secondary" className="w-full justify-start py-2 px-3 rounded-lg bg-muted/40 border-0 font-bold text-[11px] gap-2">
                        <VenetianMask size={12} className="text-primary" />
                        {profile.gender === 'female' ? t('gender.female') : t('gender.male')}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t('profile.label.looking_for')}</span>
                      <Badge variant="secondary" className="w-full justify-start py-2 px-3 rounded-lg bg-muted/40 border-0 font-bold text-[11px] gap-2">
                        <Search size={12} className="text-primary" />
                        {profile.lookingFor === 'male' ? t('gender.men') : profile.lookingFor === 'female' ? t('gender.women') : t('gender.all')}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t('profile.label.goal')}</span>
                      <Badge variant="secondary" className="w-full justify-start py-2 px-3 rounded-lg bg-primary/5 border-0 font-bold text-[11px] gap-2 text-primary">
                        <Target size={12} />
                        {t(profile.datingGoal)}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t('profile.label.zodiac')}</span>
                      <Badge variant="secondary" className="w-full justify-start py-2 px-3 rounded-lg bg-muted/40 border-0 font-bold text-[11px] gap-2">
                        <ZodiacIcon sign={profile.zodiac} />
                        {t(profile.zodiac)}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase text-muted-foreground ml-1">{t('profile.label.height')}</span>
                      <Badge variant="secondary" className="w-full justify-start py-2 px-3 rounded-lg bg-muted/40 border-0 font-bold text-[11px] gap-2">
                        <Ruler size={12} className="text-primary" />
                        {profile.height} {t('units.cm')}
                      </Badge>
                    </div>
                  </div>
                  <div className="pt-2 flex flex-wrap gap-2">
                    {[...(profile.interests || [])].filter((interest: string) => !BANNED_WORDS.includes(interest)).sort((a, b) => t(a).localeCompare(t(b))).map((interest: string) => {
                      const Icon = interestIconsMap[interest] || Heart;
                      return (
                        <Badge key={interest} variant="secondary" className="bg-muted/50 text-foreground/80 border-0 gap-2 py-2 px-3 font-bold text-[11px] rounded-lg transition-all hover:bg-muted/70 shadow-sm">
                          <Icon size={12} className="text-primary" /> {t(interest)}
                        </Badge>
                      );
                    })}
                  </div>
                </div>

                <div className="h-px bg-border/50"></div>

                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600"><BrainCircuit size={14} /></div>
                        <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.psych_tests')}</h4>
                    </div>
                    
                    {profile.attachmentStyle ? (
                        <div className="p-4 bg-purple-50/50 rounded-xl border border-purple-100 space-y-3">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-purple-800 ml-1 flex items-center gap-1.5"><Heart size={12} /> {t('profile.attachment_test')}</Label>
                            <div className="flex items-center gap-3 bg-white p-3 rounded-lg shadow-sm">
                                <div className="text-2xl">{ATTACHMENT_STYLE_INFO[profile.attachmentStyle].emoji}</div>
                                <div>
                                    <div className="font-bold">{t(ATTACHMENT_STYLE_INFO[profile.attachmentStyle].labelKey)}</div>
                                    <p className="text-xs text-muted-foreground">{t('profile.retake_test_desc')}</p>
                                </div>
                            </div>
                            <Button onClick={() => router.push('/profile/attachment-test')} className="w-full h-11 rounded-lg bg-white text-purple-800 font-bold shadow-sm border border-purple-100 hover:bg-purple-50">
                                {t('profile.retake_test')}
                            </Button>
                        </div>
                    ) : (
                        <div className="rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-600 p-6 text-white relative overflow-hidden app-shadow">
                            <div className="relative z-10">
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm">
                                        <BrainCircuit size={22} />
                                    </div>
                                    <h3 className="text-lg font-black tracking-tight">{t('profile.know_yourself')}</h3>
                                </div>
                                <p className="text-xs text-white/80 mb-6 font-medium leading-relaxed">
                                    {t('profile.attachment_test_desc')}
                                </p>
                                <Button 
                                    onClick={() => router.push('/profile/attachment-test')} 
                                    className="w-full h-12 rounded-xl bg-white text-purple-600 font-black uppercase tracking-widest text-xs shadow-lg active:scale-95 transition-all flex items-center justify-center gap-1.5"
                                >
                                    {t('profile.start_test')}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

              </div>
            </TabsContent>
            <TabsContent value="gallery">
              <div className="bg-white rounded-2xl p-6 app-shadow border border-border/40 mb-6">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <Camera size={18} className="text-primary" />
                    <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.gallery')}</h4>
                  </div>
                  <button onClick={handleAddPhotoClick} className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest text-primary px-3 bg-primary/5 hover:bg-primary/10 transition-colors">{t('profile.add')}</button>
                </div>
                <div className="grid grid-cols-2 gap-3 anti-screenshot">
                  {photos.map((url, idx) => (
                    <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden bg-muted border border-border/10 group shadow-sm">
                      <Image src={url} alt={`Gallery ${idx}`} fill className="object-cover transition-transform group-hover:scale-105 duration-500" />
                      
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                        <button 
                          onClick={() => openViewer(idx)}
                          className="bg-white/20 backdrop-blur-md border border-white/30 text-white rounded-full px-4 py-1.5 flex items-center gap-1.5 scale-90 hover:scale-100 transition-transform active:scale-95"
                        >
                          <Maximize2 size={12} />
                          <span className="text-[9px] font-black uppercase tracking-widest">{t('button.reveal')}</span>
                        </button>
                      </div>

                      <button 
                        onClick={() => setPhotoToDelete(idx)}
                        className="absolute top-2 right-2 w-8 h-8 rounded-xl bg-white shadow-lg flex items-center justify-center text-destructive hover:scale-110 active:scale-95 transition-all z-20 opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <section className="mb-10 mt-6">
                <div className="bg-white rounded-2xl p-6 border-2 border-amber-100 app-shadow relative overflow-hidden group">
                  <div className="absolute -right-4 -bottom-4 opacity-5 text-amber-500 group-hover:rotate-12 transition-transform duration-500">
                    <Trophy size={120} fill="currentColor" />
                  </div>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-12 h-12 rounded-2xl bg-amber flex items-center justify-center text-amber-500 border border-amber-100">
                      <Trophy size={24} fill="currentColor" />
                    </div>
                    <div>
                      <h4 className="text-lg font-black tracking-tight">{t('contest.participate_banner')}</h4>
                      <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">{t('contest.subtitle')}</p>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground/80 mb-6 leading-relaxed font-medium">
                    {t('contest.rules_desc')}
                  </p>
                  <Button 
                    onClick={() => !hasParticipated && setIsSelectionOpen(true)}
                    disabled={hasParticipated}
                    variant={hasParticipated ? "secondary" : "outline"}
                    className={cn(
                      "w-full h-12 rounded-xl font-black uppercase text-[10px] tracking-widest shadow-sm transition-all",
                      hasParticipated 
                        ? "bg-green-50 text-green-600 border-green-100 cursor-default" 
                        : "border-amber-200 text-amber-600 hover:bg-amber-50 active:scale-95"
                    )}
                  >
                    {hasParticipated ? (
                      <span className="flex items-center gap-2"><Check size={14} /> {t('profile.application_sent')}</span>
                    ) : (
                      t('button.participate')
                    )}
                  </Button>
                </div>
              </section>
            </TabsContent>
            <TabsContent value="stories">
              <div className="bg-white rounded-2xl p-6 app-shadow border border-border/40">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <Video size={18} className="text-primary" />
                    <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.stories')}</h4>
                  </div>
                  <button onClick={handleAddStoryClick} className="h-8 rounded-lg text-[9px] font-black uppercase tracking-widest text-primary px-3 bg-primary/5 hover:bg-primary/10 transition-colors">{t('profile.add')}</button>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {stories.map((story) => {
                    const progress = uploadProgress[story.id];
                    const isUploading = story.isUploading;
                    
                    return (
                      <div key={story.id} className="relative aspect-[9/16] rounded-xl overflow-hidden bg-muted border border-border/10 group shadow-sm">
                        <video src={story.url} className="object-cover w-full h-full" playsInline muted loop autoPlay />
                        
                        {isUploading && progress < 100 && (
                          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center backdrop-blur-sm transition-opacity duration-500">
                              <div className="relative w-16 h-16">
                                  <svg className="w-full h-full" viewBox="0 0 100 100">
                                      <circle
                                          className="text-gray-600/50"
                                          strokeWidth="5"
                                          stroke="currentColor"
                                          fill="transparent"
                                          r="40"
                                          cx="50"
                                          cy="50"
                                      />
                                      <circle
                                          className="text-primary"
                                          strokeWidth="5"
                                          strokeDasharray={2 * Math.PI * 40}
                                          strokeDashoffset={(2 * Math.PI * 40) - (progress / 100) * (2 * Math.PI * 40)}
                                          strokeLinecap="round"
                                          stroke="currentColor"
                                          fill="transparent"
                                          r="40"
                                          cx="50"
                                          cy="50"
                                          style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
                                      />
                                  </svg>
                                  <span className="absolute inset-0 flex items-center justify-center text-white text-xs font-bold">
                                      {Math.round(progress)}%
                                  </span>
                              </div>
                                  <span className="text-white/80 text-[10px] mt-2 font-semibold uppercase tracking-wider">{t('common.loading')}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div 
                    onClick={handleAddStoryClick}
                    className="aspect-[9/16] rounded-xl bg-muted/50 border-2 border-dashed border-border/30 flex flex-col items-center justify-center text-center text-muted-foreground hover:bg-muted/100 hover:border-primary/50 hover:text-primary transition-all cursor-pointer p-2"
                  >
                    <Video size={24} className="mb-2" />
                    <span className="font-black text-[10px] uppercase tracking-widest leading-tight">{t('profile.add_story')}</span>
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="groups">
              <div className="bg-white rounded-2xl p-6 app-shadow border border-border/40">
                <div className="flex items-center gap-2 mb-5">
                  <Users size={18} className="text-primary" />
                  <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t('profile.groups')}</h4>
                </div>
                {joinedGroupNames.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-8 font-medium">{t('chats.no_groups')}</p>
                ) : (
                  <div className="space-y-2">
                    {GROUP_CATEGORIES.flatMap(cat =>
                      cat.subgroups
                        .filter(sub => joinedGroupNames.includes(sub.name_ru) || joinedGroupNames.includes(sub.name_en))
                        .map(sub => (
                          <Link href={`/chats?groupId=${sub.id}`} key={sub.id} className="flex items-center justify-between p-3.5 bg-muted/30 rounded-xl hover:bg-muted/60 transition-all cursor-pointer group border border-border/20">
                            <div className="flex-1 min-w-0">
                              <h4 className="font-bold text-sm text-foreground truncate">
                                {language === 'RU' ? sub.name_ru : sub.name_en}
                              </h4>
                              <div className="flex items-center text-muted-foreground text-[10px] mt-1 gap-3">
                                <span className="flex items-center gap-1 font-bold uppercase tracking-wider">
                                  <Users size={11} className="text-muted-foreground/60" /> {sub.members}
                                </span>
                                <span className="flex items-center gap-1 font-bold uppercase tracking-wider text-green-600">
                                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                                  {sub.online} {t('chats.online')}
                                </span>
                              </div>
                            </div>
                            <div className="ml-3 shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-all">
                              <ChevronRight size={14} className="text-primary" />
                            </div>
                          </Link>
                        ))
                    )}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <AlertDialog open={photoToDelete !== null} onOpenChange={(open) => !open && setPhotoToDelete(null)}>
        <AlertDialogContent className="rounded-2xl border-0 p-6 bg-white app-shadow">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-black tracking-tight">{t('dialog.delete_photo.title')}</AlertDialogTitle>
            <AlertDialogDescription className="font-medium text-muted-foreground">
              {t('dialog.delete_photo.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-3 sm:gap-0 sm:justify-end mt-4">
            <AlertDialogCancel className="rounded-xl border-muted font-bold text-xs uppercase tracking-widest h-11 flex-1 sm:flex-none">
              {t('dialog.delete_photo.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeletePhoto}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold text-xs uppercase tracking-widest h-11 flex-1 sm:flex-none"
            >
              {t('dialog.delete_photo.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={isViewerOpen} onOpenChange={setIsViewerOpen}>
        <DialogContent className="max-w-[440px] w-[95vw] h-[85vh] p-0 border-0 bg-transparent shadow-none flex flex-col items-center justify-center [&>button]:hidden">
          <DialogTitle className="sr-only">{t('profile.gallery')}</DialogTitle>
          <Carousel className="w-full h-full" opts={{ startIndex: activePhotoIndex }}>
            <CarouselContent className="h-full ml-0">
              {photos.map((url, idx) => (
                <CarouselItem key={`viewer-${url}-${idx}`} className="h-[80vh] flex items-center justify-center p-4 pl-4">
                  <div className="relative w-full h-full rounded-2xl overflow-hidden app-shadow border-4 border-white bg-black/20 anti-screenshot">
                    <Image src={url} alt={`Gallery view`} fill sizes="(max-width: 480px) 100vw, 440px" className="object-cover" />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-4 bg-black/50 border-0 text-white hover:bg-black/70 z-50 rounded-full" />
            <CarouselNext className="right-4 bg-black/50 border-0 text-white hover:bg-black/70 z-50 rounded-full" />
          </Carousel>
          <div className="absolute top-6 right-6 z-50">
              <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={() => setIsViewerOpen(false)}
                  className="w-10 h-10 rounded-full bg-black/20 backdrop-blur-md border-white/20 text-white hover:bg-black/40 transition-all active:scale-90 shadow-lg"
              >
                  <X size={20} />
              </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isSelectionOpen} onOpenChange={setIsSelectionOpen}>
        <DialogContent className="max-w-[400px] rounded-3xl border-0 p-0 bg-white app-shadow overflow-hidden">
          <div className="p-6 pb-4">
            <DialogTitle className="text-xl font-black tracking-tight mb-1">{t('profile.contest_selection_title')}</DialogTitle>
            <p className="text-xs text-muted-foreground font-medium">{t('profile.contest_selection_desc')}</p>
          </div>
          <div className="px-6 py-2">
            <div className="grid grid-cols-2 gap-3 max-h-[300px] overflow-y-auto pr-1 no-scrollbar">
              {photos.map((url, idx) => (
                <div 
                  key={`select-${idx}`}
                  onClick={() => setSelectedPhotoForContest(url)}
                  className={cn(
                    "relative aspect-square rounded-2xl overflow-hidden cursor-pointer transition-all border-4",
                    selectedPhotoForContest === url ? "border-primary shadow-lg scale-[0.98]" : "border-transparent opacity-70 grayscale-[50%] hover:opacity-100 hover:grayscale-0",
                    url.startsWith('blob:') && "opacity-50 grayscale cursor-not-allowed"
                  )}
                >
                  <Image src={url} alt={`Photo ${idx}`} fill className="object-cover" />
                  {selectedPhotoForContest === url && !url.startsWith('blob:') && (
                    <div className="absolute inset-0 bg-primary/10 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-lg">
                        <Check size={20} className="text-primary" strokeWidth={4} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="p-6 flex flex-col gap-3">
            <Button 
              onClick={handleSubmitToContest}
              disabled={!selectedPhotoForContest || selectedPhotoForContest.startsWith('blob:')}
              className="w-full h-14 rounded-2xl gradient-bg text-white font-black uppercase tracking-widest shadow-xl shadow-primary/20 border-0 active:scale-95 transition-all"
            >
              {t('profile.contest_submit')}
            </Button>
            <Button variant="ghost" onClick={() => setIsSelectionOpen(false)} className="w-full h-10 rounded-xl text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              {t('button.close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isBoostDialogOpen} onOpenChange={setIsBoostDialogOpen}>
        <DialogContent className="max-w-[400px] rounded-3xl border-0 p-0 bg-white app-shadow overflow-hidden">
          <div className="p-6 pb-4">
            <DialogTitle className="text-xl font-black tracking-tight mb-1 flex items-center gap-2"><Rocket size={20} className="text-primary"/>{t('profile.boost')}</DialogTitle>
            <p className="text-xs text-muted-foreground font-medium">{t('profile.boost_dialog_desc')}</p>
          </div>
          <div className="p-6 flex flex-col items-center gap-3">
            <Button 
              onClick={() => handleBoost('ad')}
              className="h-14 rounded-2xl bg-green-500 hover:bg-green-600 text-white font-bold shadow-xl shadow-green-500/20 border-0 active:scale-95 transition-all flex items-center gap-2 w-full justify-center"
            >
              <Video size={20} />
              <span>{t('profile.boost_watch_ad')}</span>
            </Button>
            <Button 
              onClick={() => handleBoost('payment')}
              className="h-14 rounded-2xl gradient-bg text-white font-bold shadow-xl shadow-primary/20 border-0 active:scale-95 transition-all flex items-center gap-2 w-full justify-center"
            >
              <CreditCard size={20} />
              <span>{t('profile.boost_pay')}</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
