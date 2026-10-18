
import { useState, useRef, useEffect } from "react";
import { useRouter } from "@/shims/next-navigation";
import { getSupabase } from "@/lib/supabase";
import { ArrowRight, Sparkles, MapPin, Camera, ChevronLeft, Navigation, Target, Search, VenetianMask, Upload, Loader as Loader2, Moon, Sun } from "lucide-react";
import Image from "@/shims/next-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { generateProfileBio } from "@/shims/ai-flows";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { CIRCADIAN_RHYTHM_OPTIONS } from "@/lib/constants";
import { useContentConfig } from "@/lib/useContentConfig";

const GENDER_OPTIONS = [
  { id: 'male', labelKey: 'onboarding.step1.male' },
  { id: 'female', labelKey: 'onboarding.step1.female' }
];

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(1);
  const totalSteps = 5;

  const supabase = getSupabase();
  const { interests: dynamicInterests, dating_goals: dynamicGoals } = useContentConfig();

  useEffect(() => {
    const initProfile = async () => {
      if (!supabase) return
      const { data: { user } } = await supabase.auth.getUser()
      if (user?.user_metadata) {
        setFormData(prev => ({ 
          ...prev, 
          name: user.user_metadata.name || "",
          photo: user.user_metadata.avatar_url || prev.photo,
        }));
      }
    }
    initProfile()
  }, [supabase]);

  useEffect(() => {
    if (dynamicInterests.length) {
      setFormData(prev => ({
        ...prev,
        interests: prev.interests.filter(i => dynamicInterests.includes(i))
      }))
    }
  }, [dynamicInterests]);

  const [isGeneratingBio, setIsGeneratingBio] = useState(false);
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const [formData, setFormData] = useState({
    gender: "",
    name: "",
    age: "",
    city: "",
    height: "",
    datingGoal: "",
    zodiac: "",
    interests: [] as string[],
    bio: "",
    photo: PlaceHolderImages.find(p => p.id === 'me')?.imageUrl || PlaceHolderImages[10].imageUrl,
    lookingFor: "all",
    circadian: "",
  });

  const nextStep = () => {
    if (step < totalSteps) setStep(step + 1);
    else handleFinish();
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const toggleInterest = (interest: string) => {
    setFormData(prev => ({
      ...prev,
      interests: prev.interests.includes(interest)
        ? prev.interests.filter(i => i !== interest)
        : [...prev.interests, interest]
    }));
  };

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: t('onboarding.loc.fail'), variant: "destructive" });
      return;
    }
    setIsDetectingLocation(true);
    
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${position.coords.latitude}&lon=${position.coords.longitude}&zoom=10`, { headers: { 'User-Agent': 'SwiftMatch/1.0' } });
          const data = await res.json();
          const city = data.address.city || data.address.town || data.address.village || "";
          if (city) {
            setFormData(prev => ({ ...prev, city }));
            toast({ title: `${t('onboarding.loc.success')}${city}` });
          }
        } catch (error) {
          if (import.meta.env.DEV) console.error("Geocoding error:", error);
        } finally {
          setIsDetectingLocation(false);
        }
      },
      () => setIsDetectingLocation(false)
    );
  };

  const handleGenerateBio = async () => {
    if (formData.interests.length === 0) {
      toast({ title: t('onboarding.toast.bio_needs_interests') });
      return;
    }
    setIsGeneratingBio(true);
    try {
      const result = await generateProfileBio({ keywords: formData.interests });
      if (result && result.bio) {
        setFormData(prev => ({ ...prev, bio: result.bio }));
        toast({ title: t('onboarding.toast.bio_ai') });
      } else {
        toast({ variant: "destructive", title: t('toast.ai_error'), description: t('toast.ai_error_desc') });
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error("AI Bio error:", error);
      toast({ variant: "destructive", title: t('toast.ai_error'), description: t('toast.ai_error_desc') });
    } finally {
      setIsGeneratingBio(false);
    }
  };

  const handleTriggerFileInput = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, photo: reader.result as string }));
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFinish = async () => {
    if (!supabase) {
        router.push('/login');
        return;
    }

    try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          router.push('/login');
          return
        }
        const { error } = await supabase
          .from('profiles')
          .upsert({
            id: user.id,
            name: formData.name,
            age: parseInt(formData.age) || null,
            city: formData.city,
            height: parseInt(formData.height) || null,
            goal: formData.datingGoal,
            ...(formData.zodiac ? { zodiac: formData.zodiac } : {}),
            gender: formData.gender,
            looking_for: formData.lookingFor,
            circadian: formData.circadian,
            bio: formData.bio,
            avatar_url: formData.photo,
          })
        if (error) throw error
        
        toast({ title: t('onboarding.toast.finish_title'), description: t('onboarding.toast.finish_desc') });
        router.push("/"); 
    } catch (error) {
        if (import.meta.env.DEV) console.error("Error saving profile:", error);
        toast({ title: t('onboarding.save_error'), variant: "destructive" });
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="space-y-2">
              <h2 className="text-3xl font-black font-headline tracking-tight">{t('onboarding.step1.title')}</h2>
              <p className="text-muted-foreground text-sm">{t('onboarding.step1.desc')}</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">{t('onboarding.step1.label')}</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder={t('onboarding.step1.placeholder')} className="h-14 rounded-xl bg-muted/30 border-0 font-bold px-6" />
              </div>
              <div className="space-y-2 pt-4">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                  <VenetianMask size={14} className="text-primary" /> {t('onboarding.step1.gender_label')}
                </Label>
                <div className="grid grid-cols-1 gap-3">
                  {GENDER_OPTIONS.map(opt => (
                    <button key={opt.id} onClick={() => setFormData({...formData, gender: opt.id})} className={cn("h-14 rounded-xl border-2 transition-all font-bold flex items-center px-6 gap-3", formData.gender === opt.id ? "border-primary bg-primary/5 text-primary" : "border-muted text-muted-foreground bg-transparent hover:bg-muted/30")}>
                      <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", formData.gender === opt.id ? "border-primary bg-primary" : "border-muted")}>
                        {formData.gender === opt.id && <div className="w-2 h-2 bg-white rounded-full"></div>}
                      </div>
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      case 2:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="space-y-2">
              <h2 className="text-3xl font-black font-headline tracking-tight">{t('onboarding.step2.title')}</h2>
              <p className="text-muted-foreground text-sm">{t('onboarding.step2.desc')}</p>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">{t('onboarding.step2.age')}</Label>
                  <Input type="number" value={formData.age} onChange={e => setFormData({...formData, age: e.target.value})} placeholder="25" className="h-14 rounded-xl bg-muted/30 border-0 font-bold px-6" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">{t('onboarding.step2.height')}</Label>
                  <Input type="number" value={formData.height} onChange={e => setFormData({...formData, height: e.target.value})} placeholder="175" className="h-14 rounded-xl bg-muted/30 border-0 font-bold px-6" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">{t('onboarding.step2.city')}</Label>
                <div className="relative">
                  <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 text-primary" size={20} />
                  <Input value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} placeholder={t('onboarding.step2.city_placeholder')} className="h-14 pl-14 pr-16 rounded-xl bg-muted/30 border-0 font-bold" />
                  <button onClick={handleDetectLocation} disabled={isDetectingLocation} type="button" className="absolute right-4 top-1/2 -translate-y-1/2 text-primary hover:bg-muted p-2 rounded-xl transition-colors active:scale-90">
                    <Navigation size={20} className={cn(isDetectingLocation && "animate-pulse")} fill={isDetectingLocation ? "currentColor" : "none"} />
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5">
                      {formData.circadian === 'lark' ? <Sun size={12}/> : <Moon size={12}/>}
                      {t('onboarding.step2.sleep_label')}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                      {CIRCADIAN_RHYTHM_OPTIONS.map(opt => (
                          <Badge
                              key={opt.value}
                              onClick={() => setFormData(prev => ({ ...prev, circadian: opt.value }))}
                              variant={formData.circadian === opt.value ? "default" : "secondary"}
                              className={cn(
                                  "cursor-pointer px-3 py-1.5 rounded-lg transition-all border-0 font-bold text-[11px] uppercase tracking-tight shadow-sm",
                                  formData.circadian === opt.value
                                      ? "gradient-bg text-white shadow-md hover:brightness-110"
                                      : "bg-muted text-muted-foreground hover:bg-border"
                              )}
                          >
                               {t(opt.label)}
                           </Badge>
                       ))}
                  </div>
              </div>
            </div>
          </div>
        );
      case 3:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="space-y-2">
              <h2 className="text-3xl font-black font-headline tracking-tight">{t('onboarding.step3.title')}</h2>
              <p className="text-muted-foreground text-sm">{t('onboarding.step3.desc')}</p>
            </div>
            <div className="space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                  <Target size={14} className="text-primary" /> {t('onboarding.step3.goal_label')}
                </Label>
                <Select value={formData.datingGoal} onValueChange={(val) => setFormData({...formData, datingGoal: val})}>
                  <SelectTrigger className="h-14 rounded-xl bg-muted/30 border-0 font-bold px-6">
                    <SelectValue placeholder={t('onboarding.step3.goal_placeholder')} />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-0 shadow-2xl">
                    {dynamicGoals.map(goal => <SelectItem key={goal} value={goal} className="font-bold py-3">{t(goal)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-2">
                  <Search size={14} className="text-primary" /> {t('onboarding.step3.looking_for')}
                </Label>
                <Select value={formData.lookingFor} onValueChange={(val) => setFormData({...formData, lookingFor: val})}>
                  <SelectTrigger className="h-14 rounded-xl bg-muted/30 border-0 font-bold px-6">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-0 shadow-2xl">
                    <SelectItem value="male" className="font-bold py-3">{t('gender.men')}</SelectItem>
                    <SelectItem value="female" className="font-bold py-3">{t('gender.women')}</SelectItem>
                    <SelectItem value="all" className="font-bold py-3">{t('gender.all')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      case 4:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="space-y-2">
              <h2 className="text-3xl font-black font-headline tracking-tight">{t('onboarding.step4.title')}</h2>
              <p className="text-muted-foreground text-sm">{t('onboarding.step4.desc')}</p>
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              {[...dynamicInterests].sort((a, b) => t(a).localeCompare(t(b))).map(interest => (
                  <Badge key={interest} onClick={() => toggleInterest(interest)} variant={formData.interests.includes(interest) ? "default" : "secondary"} className={cn("cursor-pointer px-4 py-2.5 rounded-xl transition-all border-0 font-bold text-[10px] uppercase tracking-tight shadow-sm", formData.interests.includes(interest) ? "gradient-bg text-white shadow-md" : "bg-muted text-muted-foreground hover:bg-border")}>
                    {t(interest)}
                  </Badge>
              ))}
            </div>
          </div>
        );
      case 5:
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="space-y-2 text-center">
              <div className="relative inline-block mx-auto mb-4">
                <div onClick={handleTriggerFileInput} className="w-40 h-40 rounded-2xl border-[6px] border-white shadow-2xl overflow-hidden relative group cursor-pointer">
                  <Image src={formData.photo} alt="Me" fill className={cn("object-cover transition-all", isUploading && "blur-sm grayscale")} />
                  <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
                    <Camera className="text-white mb-1" size={32} />
                    <span className="text-white text-[9px] font-black uppercase tracking-widest">{t('onboarding.step5.photo_label')}</span>
                  </div>
                </div>
                <button onClick={handleTriggerFileInput} className="absolute -bottom-1 -right-1 bg-primary text-white p-3 rounded-xl shadow-xl border-2 border-white">
                  <Upload size={18} />
                </button>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
              </div>
              <h2 className="text-3xl font-black font-headline tracking-tight">{t('onboarding.step5.title')}</h2>
              <p className="text-muted-foreground text-sm px-4">{t('onboarding.step5.desc')}</p>
            </div>
            <div className="bg-white rounded-2xl p-6 app-shadow border border-border/40 space-y-4">
              <div className="flex justify-between items-center">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">{t('onboarding.step5.bio_label')}</Label>
                <button onClick={handleGenerateBio} disabled={isGeneratingBio} className="text-[9px] font-black text-primary flex items-center gap-1.5 uppercase tracking-widest bg-muted/50 px-3 py-1.5 rounded-full shadow-sm">
                  <Sparkles size={12} className={cn(isGeneratingBio && "animate-spin")} /> AI {t('onboarding.step5.bio_generate')}
                </button>
              </div>
              <Textarea value={formData.bio} onChange={e => setFormData({...formData, bio: e.target.value})} placeholder={t('onboarding.step5.bio_placeholder')} className="min-h-[120px] rounded-xl bg-muted/30 border-0 text-sm font-medium p-4 resize-none" />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="fixed top-0 left-0 right-0 h-1.5 bg-muted z-50">
        <div className="h-full gradient-bg transition-all duration-500 ease-out" style={{ width: `${(step / totalSteps) * 100}%` }}></div>
      </div>
      <header className="p-6 flex items-center justify-between h-20">
        <Button variant="ghost" size="icon" onClick={prevStep} disabled={step === 1} className="rounded-full"><ChevronLeft size={24} /></Button>
        <div className="flex gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} className={cn("w-2 h-2 rounded-full transition-all", step === i + 1 ? "w-6 bg-primary" : "bg-muted")}></div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push("/")} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t('button.go_home')}</Button>
          <Button variant="ghost" onClick={handleFinish} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{t('button.skip')}</Button>
        </div>
      </header>
      <main className="flex-1 px-8 pt-4 pb-24 max-w-md mx-auto w-full">{renderStep()}</main>
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] p-6 bg-white/80 backdrop-blur-md">
        <Button onClick={nextStep} disabled={(formData.gender === "" && step === 1)} className="w-full h-16 rounded-full gradient-bg text-white font-black uppercase tracking-[0.2em] shadow-2xl shadow-primary/30 active:scale-95 transition-all">
          {step === totalSteps ? t('button.start') : t('button.continue')} <ArrowRight size={20} className="ml-2" />
        </Button>
      </div>
    </div>
  );
}
