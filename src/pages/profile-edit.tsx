
import { useState, useEffect } from "react";
import { useRouter } from "@/shims/next-navigation";
import { Sparkles, User, MapPin, Info, Target, Loader as Loader2, Trash2, CloudUpload as UploadCloud, AtSign, Star, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { generateProfileBio } from "@/shims/ai-flows";
import { toast } from "@/hooks/use-toast";
import { getToken } from "@/lib/token";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ZODIAC_SIGNS } from "@/lib/constants";
import { useContentConfig } from "@/lib/useContentConfig";
import { useLanguage } from "@/context/language-context";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { BANNED_WORDS } from "@/lib/constants";
import { VerificationDialog } from "@/components/shared/verification";
import { BottomNav } from "@/components/navigation/bottom-nav";

const INTEREST_KEY_TO_ID: Record<string, number> = {
  'interest.sport': 1, 'interest.music': 2, 'interest.movies': 3, 'interest.books': 4,
  'interest.travel': 5, 'interest.cooking': 6, 'interest.games': 7, 'interest.art': 8,
  'interest.photography': 9, 'interest.tech': 10, 'interest.fashion': 11, 'interest.dance': 12,
  'interest.animals': 13, 'interest.volunteering': 14, 'interest.politics': 15,
  'interest.psychology': 16, 'interest.philosophy': 17, 'interest.yoga': 18,
  'interest.meditation': 19, 'interest.gardening': 20, 'interest.cars': 21,
  'interest.science': 22, 'interest.history': 23, 'interest.architecture': 24,
  'interest.pets': 25,
  'interest.coffee': 26, 'interest.diy': 27, 'interest.extreme': 28,
  'interest.films': 29, 'interest.food': 30, 'interest.hiking': 31,
  'interest.martial_arts': 32, 'interest.podcasts': 33,
  'interest.gaming': 7, 'interest.dancing': 12, 'interest.reading': 4, 'interest.technology': 10,
  'interest.astronomy': 34, 'interest.board_games': 35, 'interest.nature': 36,
};

const PROFILE_API = '/api/profile'
const DEMO_USER_ID = 2

function getDefaultProfile(t: (key: string) => string) {
  return {
    displayName: t('profile.demo_name'),
    age: 24,
    city: t('profile.demo_city'),
    height: 172,
    gender: "female" as const,
    lookingFor: "male" as const,
    datingGoal: "goal.serious_relationship",
    zodiac: "common.zodiac.leo",
    bio: t('profile.demo_bio'),
    interests: ["interest.photography", "interest.travel", "interest.music", "interest.sport"].filter(i => !BANNED_WORDS.includes(i)),
    match: 87,
    attachmentStyle: null as string | null,
    birthDate: "2001-08-10",
    location: t('profile.demo_city'),
    photos: [PlaceHolderImages[0].imageUrl, PlaceHolderImages[2].imageUrl, PlaceHolderImages[4].imageUrl],
  };
}

const NAME_TO_KEY: Record<string, string> = {
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
  'Животные': 'interest.animals', 'Экстрим': 'interest.extreme', 'Фильмы': 'interest.films',
  'Еда': 'interest.food', 'Походы': 'interest.hiking', 'Единоборства': 'interest.martial_arts',
  'Подкасты': 'interest.podcasts', 'Питомцы': 'interest.pets',
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
  'Sport': 'interest.sport', 'Pets': 'interest.pets',
  'DIY': 'interest.diy', 'Extreme': 'interest.extreme', 'Films': 'interest.films',
  'Food': 'interest.food', 'Hiking': 'interest.hiking', 'Martial Arts': 'interest.martial_arts',
  'Podcasts': 'interest.podcasts',
}

function normalizeObjectInterests(interests: any): string[] {
  if (!Array.isArray(interests)) return []
  return [...new Set(interests.map((i: any) => {
    if (typeof i === 'string') return i === 'interest.technology' ? 'interest.tech' : i
    const name = i.name_ru && !/^\?+$/.test(i.name_ru) ? i.name_ru : i.name_en
    return NAME_TO_KEY[name] || name
  }))].filter((i: string) => i && !BANNED_WORDS.includes(i))
}

function mapDbProfile(rows: any) {
  if (!rows) return null
  const p = Array.isArray(rows) ? rows[0] : rows
  return {
    displayName: p.display_name || p.displayName || '',
    age: p.age || 24,
    city: p.city || '',
    height: p.height || 0,
    gender: p.gender || 'female',
    lookingFor: p.looking_for || 'male',
    datingGoal: p.dating_goal || '',
    zodiac: p.zodiac || '',
    bio: p.bio || '',
    interests: normalizeObjectInterests(p.interests),
    match: 87,
    attachmentStyle: p.attachment_style || null,
    birthDate: p.birth_date || '2001-08-10',
    location: p.city || '',
    photos: p.photos || [],
  }
}

function displayInterestLabel(key: string, t: (k: string) => string): string {
  const translated = t(key)
  if (translated !== key) return translated
  for (const p of ['interest.', 'goal.', 'education.']) {
    if (key.startsWith(p)) return key.slice(p.length)
  }
  return key
}

export default function EditProfilePage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { interests: dynamicInterests, dating_goals: dynamicGoals } = useContentConfig();

  const [profile, setProfile] = useState<any>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isGeneratingBio, setIsGeneratingBio] = useState(false);
  const [showVerification, setShowVerification] = useState(false);
  const [aliases, setAliases] = useState<{ id: number; alias: string; is_primary: boolean }[]>([]);
  const [newAlias, setNewAlias] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${PROFILE_API}/${DEMO_USER_ID}`)
        if (res.ok) {
          const data = await res.json()
          const photoUrls = (data.photos || []).map((ph: any) => ph.url)
          const mapped = mapDbProfile(data)
          setProfile(mapped)
          if (photoUrls.length > 0) setPhotos(photoUrls)
          else {
            const saved = localStorage.getItem('userProfileGallery')
            if (saved) try { setPhotos(JSON.parse(saved)) } catch { /* ignored */ }
          }
          localStorage.setItem('userProfile', JSON.stringify(mapped))
          setIsLoading(false)
          return
        }
      } catch { /* ignored */ }

      const savedProfile = localStorage.getItem('userProfile');
      let parsed: any;
      if (savedProfile) {
        try {
          parsed = JSON.parse(savedProfile);
          if (parsed.interests && Array.isArray(parsed.interests)) {
            parsed.interests = parsed.interests.filter((i: string) => !BANNED_WORDS.includes(i));
          }
          parsed.photos = Array.isArray(parsed.photos) ? parsed.photos : [];
          parsed.displayName = parsed.displayName || parsed.name || t('profile.someone');
        } catch (e) {
          if (import.meta.env.DEV) console.error("Failed to parse profile", e);
          parsed = { ...getDefaultProfile(t) };
        }
      } else {
        parsed = { ...getDefaultProfile(t) };
      }
      setProfile(parsed);

      const defaultProfile = getDefaultProfile(t);
      const savedPhotos = localStorage.getItem('userProfileGallery');
      if (savedPhotos) {
        try {
          setPhotos(JSON.parse(savedPhotos));
        } catch {
          setPhotos(parsed.photos || defaultProfile.photos);
        }
      } else {
        setPhotos(parsed.photos || defaultProfile.photos);
      }

      setIsLoading(false);
    })()
  }, [t]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch("/api/profile/aliases", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (Array.isArray(data)) setAliases(data); })
      .catch(() => {});
  }, []);

  const addAlias = async () => {
    const trimmed = newAlias.trim();
    if (!trimmed) return;
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/profile/aliases", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ alias: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: data.message || t("profile.alias_error"), variant: "destructive" });
        return;
      }
      const created = await res.json();
      setAliases((prev) => [...prev, created]);
      setNewAlias("");
      toast({ title: t("profile.alias_added") });
    } catch {
      toast({ title: t("profile.alias_error"), variant: "destructive" });
    }
  };

  const deleteAlias = async (aliasId: number) => {
    const token = getToken();
    if (!token) return;
    try {
      await fetch(`/api/profile/aliases/${aliasId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setAliases((prev) => prev.filter((a) => a.id !== aliasId));
      toast({ title: t("profile.alias_deleted") });
    } catch { /* ignored */ }
  };

  const setPrimary = async (aliasId: number) => {
    const token = getToken();
    if (!token) return;
    try {
      await fetch(`/api/profile/aliases/${aliasId}/primary`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}` },
      });
      setAliases((prev) => prev.map((a) => ({ ...a, is_primary: a.id === aliasId })));
    } catch { /* ignored */ }
  };

  const handlePhotosChange = (newPhotos: string[]) => {
    setPhotos(newPhotos);
    localStorage.setItem('userProfileGallery', JSON.stringify(newPhotos.filter(p => !p.startsWith('blob:'))));
  };

  const handleAddPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const previewUrl = URL.createObjectURL(file);
      const updated = [...photos, previewUrl];
      setPhotos(updated);

      const formData = new FormData()
      formData.append('photo', file)
      formData.append('user_id', String(DEMO_USER_ID))
      formData.append('sort_order', String(photos.length))
      fetch('/api/upload', { method: 'POST', body: formData }).catch(() => {})

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        setPhotos(prev => {
          const next = [...prev];
          const idx = next.lastIndexOf(previewUrl);
          if (idx !== -1) next[idx] = dataUrl;
          localStorage.setItem('userProfileGallery', JSON.stringify(next.filter(p => !p.startsWith('blob:'))));
          return next;
        });
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    }
  };

  const handleRemovePhoto = (index: number) => {
    if (photos.length <= 1) {
      toast({ title: t('toast.cannot_delete'), description: t('toast.cannot_delete_desc'), variant: "destructive" });
      return;
    }
    const url = photos[index];
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    localStorage.setItem('userProfileGallery', JSON.stringify(next.filter(p => !p.startsWith('blob:'))));
  };

  const handleGenerateBio = async () => {
    if (!profile?.interests && !profile?.bio) return;
    setIsGeneratingBio(true);
    try {
      const result = await generateProfileBio({ keywords: profile.interests, description: profile.bio });
      setProfile((prev: any) => ({ ...prev, bio: result.bio }));
      toast({ title: t('profile.ai_improve'), description: t('toast.bio_improved') });
    } catch (error) {
      toast({ variant: "destructive", title: t('toast.ai_error'), description: t('toast.ai_error_desc') });
    } finally {
      setIsGeneratingBio(false);
    }
  };

  const handleSave = async () => {
    if (photos.length === 0) {
      toast({ title: t('toast.save_error'), description: t('toast.save_error_desc'), variant: "destructive" });
      return;
    }

    setIsSaving(true);

    const cleanedInterests = (profile.interests || []).filter((i: string) => !BANNED_WORDS.includes(i));

    const dataToSave = {
      ...profile,
      interests: cleanedInterests,
      photos: photos.filter(p => !p.startsWith('blob:')),
    };

    localStorage.setItem('userProfile', JSON.stringify(dataToSave));
    localStorage.setItem('userProfileGallery', JSON.stringify(photos.filter(p => !p.startsWith('blob:'))));

    try {
      const interestIds = (profile.interests || [])
        .map((key: string) => INTEREST_KEY_TO_ID[key])
        .filter(Boolean)

      await fetch(`${PROFILE_API}/${DEMO_USER_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: profile.displayName,
          name: profile.displayName,
          age: profile.age,
          bio: profile.bio,
          gender: profile.gender,
          looking_for: profile.lookingFor,
          dating_goal: profile.datingGoal,
          height: profile.height,
          city: profile.location || profile.city,
          zodiac: profile.zodiac,
          interests: interestIds,
        }),
      })
    } catch (e) {
      if (import.meta.env.DEV) console.error('Failed to save to API', e)
    }

    toast({ title: t('toast.profile_saved'), description: t('toast.profile_saved_desc') });
    setIsSaving(false);
    router.push("/profile");
  };

  const toggleInterest = (interest: string) => {
    if (BANNED_WORDS.includes(interest)) return;
    setProfile((prev: any) => {
      const current = prev.interests || [];
      return {
        ...prev,
        interests: current.includes(interest)
          ? current.filter((i: string) => i !== interest)
          : [...current, interest]
      };
    });
  };

  if (isLoading || !profile) {
    return (
      <div className="flex flex-col min-h-screen bg-[#f8f9fb]">
        <AppHeader />
        <main className="flex-1 p-4 space-y-5 pb-24">
          <div className="bg-white rounded-2xl p-6 app-shadow space-y-6 border border-border/40">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-24 w-full" />
            <div className="h-px bg-border/50"></div>
            <Skeleton className="h-8 w-1/4" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </main>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#f8f9fb]">
      <AppHeader />
      <main className="flex-1 overflow-y-auto p-4 space-y-5 pb-24">

        <div className="bg-white rounded-2xl p-6 app-shadow space-y-6 border border-border/40">

          {/* Photos */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center text-red-600"><Info size={14} /></div>
                <h3 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground">{t('profile.photos')}</h3>
              </div>
              <label htmlFor="photo-upload" className="cursor-pointer text-primary font-bold text-xs uppercase tracking-widest hover:text-primary/80 transition-colors">
                {t('button.upload')}
              </label>
              <input id="photo-upload" type="file" accept="image/*" multiple onChange={handleAddPhoto} className="hidden" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {photos.map((photo, index) => (
                <div key={photo} className="relative aspect-square rounded-xl overflow-hidden group bg-muted">
                  <img src={photo} alt={`Photo ${index + 1}`} className="object-cover w-full h-full" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={() => handleRemovePhoto(index)}
                      className="w-9 h-9 rounded-full bg-red-500/80 text-white flex items-center justify-center hover:bg-red-600 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              <label htmlFor="photo-upload" className="cursor-pointer aspect-square rounded-xl border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center text-muted-foreground hover:bg-muted/50 hover:border-primary transition-colors">
                <UploadCloud size={24} />
                <span className="text-[10px] font-bold mt-1 text-center">{t('profile.add_photo')}</span>
              </label>
            </div>
          </div>

          <div className="h-px bg-border/50 my-6"></div>

          {/* Bio */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600"><Info size={14} /></div>
                <h3 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground">{t('profile.about')}</h3>
              </div>
              <button onClick={handleGenerateBio} disabled={isGeneratingBio} className="text-[9px] font-black text-primary flex items-center gap-1.5 uppercase tracking-tight bg-muted/50 px-3 py-1.5 rounded-full hover:bg-muted transition-colors shadow-sm">
                <Sparkles size={11} className={isGeneratingBio ? "animate-spin" : ""} /> {t('profile.ai_improve')}
              </button>
            </div>
            <Textarea data-testid="profile-bio" value={profile.bio || ''} onChange={e => setProfile({ ...profile, bio: e.target.value })} className="rounded-xl bg-muted/30 border-0 min-h-[90px] text-xs resize-none font-medium p-4" />
          </div>

          <div className="h-px bg-border/50 my-6"></div>

          {/* Basic Info */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><User size={14} /></div>
            <h3 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground">{t('profile.basic_info')}</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.label.name')}</Label>
              <Input data-testid="profile-name" value={profile.displayName || ''} onChange={e => setProfile({ ...profile, displayName: e.target.value })} className="rounded-xl bg-muted/30 border-0 h-11 font-bold px-4 focus-visible:ring-primary/20" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.label.gender')}</Label>
                <Select value={profile.gender || ''} onValueChange={(val) => setProfile({ ...profile, gender: val, lookingFor: val === 'female' ? 'male' : profile.lookingFor })}>
                  <SelectTrigger className="rounded-xl bg-muted/30 border-0 h-11 font-bold px-4"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-xl border-0 shadow-2xl">
                    <SelectItem value="male" className="font-bold text-[11px]">{t('gender.male')}</SelectItem>
                    <SelectItem value="female" className="font-bold text-[11px]">{t('gender.female')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.label.birth_date')}</Label>
                <Input type="date" value={profile.birthDate?.split('T')[0] || ''} onChange={e => setProfile({ ...profile, birthDate: e.target.value })} className="rounded-xl bg-muted/30 border-0 h-11 font-bold px-4 focus-visible:ring-primary/20" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.label.city')}</Label>
              <div className="relative"><MapPin size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/60" /><Input value={profile.location || profile.city || ''} onChange={e => setProfile({ ...profile, location: e.target.value, city: e.target.value })} className="rounded-xl bg-muted/30 border-0 h-11 font-bold pl-10 pr-4 focus-visible:ring-primary/20" /></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.label.height_cm')}</Label>
                <Input type="number" value={profile.height || ''} onChange={e => setProfile({ ...profile, height: parseInt(e.target.value) || 0 })} className="rounded-xl bg-muted/30 border-0 h-11 font-bold px-4 focus-visible:ring-primary/20" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.label.zodiac_sign')}</Label>
                <Select value={profile.zodiac || ''} onValueChange={(val) => setProfile({ ...profile, zodiac: val })}>
                  <SelectTrigger className="rounded-xl bg-muted/30 border-0 h-11 font-bold px-4"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-xl border-0 shadow-2xl">
                    {ZODIAC_SIGNS.map(sign => <SelectItem key={sign} value={sign} className="font-bold text-[11px]">{t(sign)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5 p-4 bg-primary/5 rounded-xl border border-primary/10">
              <Label className="text-[10px] font-black uppercase tracking-widest text-primary ml-1 flex items-center gap-1.5"><Target size={12} /> {t('profile.label.goal')}</Label>
              <Select value={profile.datingGoal || ''} onValueChange={(val) => setProfile({ ...profile, datingGoal: val })}>
                <SelectTrigger className="rounded-xl bg-white border-0 h-11 font-bold px-4 shadow-sm">
                  <SelectValue placeholder={t('onboarding.step3.goal_placeholder')} />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-0 shadow-2xl">
                  {dynamicGoals.map(goal => <SelectItem key={goal} value={goal} className="font-bold text-[11px]">{t(goal)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.label.looking_for')}</Label>
              <Select value={profile.lookingFor || 'male'} onValueChange={(val) => setProfile({ ...profile, lookingFor: val })}>
                <SelectTrigger className="rounded-xl bg-muted/30 border-0 h-11 font-bold px-4"><SelectValue /></SelectTrigger>
                <SelectContent className="rounded-xl border-0 shadow-2xl">
                  <SelectItem value="male" className="font-bold text-[11px]">{t('gender.male')}</SelectItem>
                  <SelectItem value="female" className="font-bold text-[11px]">{t('gender.female')}</SelectItem>
                  <SelectItem value="everyone" className="font-bold text-[11px]">{t('gender.all')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Interests */}
          <div className="space-y-4">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.interests')}</Label>
            <div className="flex flex-wrap gap-2">
              {[...dynamicInterests].sort((a, b) => displayInterestLabel(a, t).localeCompare(displayInterestLabel(b, t))).map(interest => (
                <Badge
                  key={interest}
                  onClick={() => toggleInterest(interest)}
                  variant={(profile.interests || []).includes(interest) ? "default" : "secondary"}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 rounded-lg transition-all border-0 font-bold text-[11px] uppercase tracking-tight shadow-sm",
                    (profile.interests || []).includes(interest) ? "gradient-bg text-white shadow-md hover:brightness-110" : "bg-muted text-muted-foreground hover:bg-border"
                  )}
                >
                  {displayInterestLabel(interest, t)}
                </Badge>
              ))}
            </div>
          </div>

          {/* Aliases (псевдонимы) */}
          <div className="space-y-3">
            <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 ml-1">{t('profile.aliases')}</Label>
            <div className="flex flex-wrap gap-2">
              {aliases.map((a) => (
                <Badge
                  key={a.id}
                  variant={a.is_primary ? "default" : "secondary"}
                  className={cn(
                    "cursor-pointer px-3 py-1.5 rounded-lg transition-all border-0 font-bold text-[11px] uppercase tracking-tight shadow-sm",
                    a.is_primary ? "gradient-bg text-white shadow-md" : "bg-muted text-muted-foreground hover:bg-border"
                  )}
                  onClick={() => setPrimary(a.id)}
                  data-testid={`alias-${a.id}`}
                >
                  <AtSign size={10} className="mr-1 inline" />
                  {a.alias}
                  {a.is_primary && <Star size={10} className="ml-1 inline" fill="currentColor" />}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deleteAlias(a.id); }}
                    className="ml-1.5 opacity-60 hover:opacity-100"
                    data-testid={`delete-alias-${a.id}`}
                  >
                    <Trash2 size={10} />
                  </button>
                </Badge>
              ))}
            </div>
            {aliases.length < 5 && (
              <div className="flex gap-2">
                <Input
                  value={newAlias}
                  onChange={(e) => setNewAlias(e.target.value)}
                  placeholder={t('profile.alias_placeholder')}
                  maxLength={50}
                  className="h-9 text-xs rounded-lg"
                  data-testid="new-alias-input"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-lg text-xs font-bold shrink-0"
                  onClick={addAlias}
                  disabled={!newAlias.trim()}
                  data-testid="add-alias-button"
                >
                  {t('profile.alias_add')}
                </Button>
              </div>
            )}
          </div>

        </div>

        <div className="mt-8 px-2">
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
            const photoCount = photos?.length || 0
            score += Math.min(15, photoCount * 5)
            const interestCount = p?.interests?.length || 0
            score += Math.min(15, interestCount * 3)
            score = Math.min(100, score)
            const label = score < 40 ? 'profile.score_low' : score < 70 ? 'profile.score_medium' : score < 90 ? 'profile.score_high' : 'profile.score_perfect'
            const color = score < 40 ? 'bg-red-500' : score < 70 ? 'bg-amber-500' : score < 90 ? 'bg-green-500' : 'bg-primary'
            return (
              <div className="mb-6 space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-[10px] uppercase tracking-widest text-muted-foreground">{t('profile.score')}</h4>
                  <span className="text-xs font-black">{score}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
                </div>
                <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{t(label)}</p>
              </div>
            )
          })()}
          <div className="py-2">
            <Button data-testid="verify-profile" variant="outline" className="w-full h-11 rounded-xl border-2 border-primary/30 text-primary font-bold text-sm hover:bg-primary/5 active:scale-95 transition-all" onClick={() => setShowVerification(true)}>
              <ShieldCheck size={18} className="mr-2" />{t('verification.verify_button')}
            </Button>
          </div>
          <VerificationDialog open={showVerification} onClose={() => setShowVerification(false)} />
          <Button data-testid="save-profile" onClick={handleSave} disabled={isSaving} className="w-full h-14 rounded-2xl gradient-bg text-white font-black uppercase tracking-widest shadow-xl shadow-primary/30 border-0 hover:brightness-110 active:scale-95 transition-all">
            {isSaving ? <Loader2 className="animate-spin mr-2" /> : null}
            {t('profile.save_all')}
          </Button>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
