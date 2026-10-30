
import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { POPULAR_CITIES, CIRCADIAN_RHYTHM_OPTIONS, ATTACHMENT_STYLE_OPTIONS } from "@/lib/constants";
import { useContentConfig } from "@/lib/useContentConfig";
import { cn } from "@/lib/utils";
import { usePremium } from "@/hooks/use-premium";
import { PremiumDialog } from "./premium-dialog";
import { Lock } from "lucide-react";
import { useLanguage } from "@/context/language-context";
import type { AutoSearchFilters } from "@/pages/search";

interface FiltersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFilters: Partial<AutoSearchFilters>;
  onApplyFilters: (newFilters: AutoSearchFilters) => void;
}

export function FiltersDialog({
  open,
  onOpenChange,
  currentFilters,
  onApplyFilters,
}: FiltersDialogProps) {
  const { t } = useLanguage();
  const { interests: dynamicInterests, dating_goals: dynamicGoals } = useContentConfig();
  const { isPremium: isPro } = usePremium();

  const [ageRange, setAgeRange] = useState(currentFilters.ageRange || [18, 40]);
  const [distance, setDistance] = useState(currentFilters.distance || [50]);
  const [selectedCity, setSelectedCity] = useState(currentFilters.selectedCity || "all");
  const [selectedCountryFilters, setSelectedCountryFilters] = useState(currentFilters.selectedCountry || "");
  const [genderPref, setGenderPref] = useState(currentFilters.genderPref || "all");
  const [selectedDatingGoal, setSelectedDatingGoal] = useState(currentFilters.selectedDatingGoal || "all");
  const [selectedInterests, setSelectedInterests] = useState<string[]>(currentFilters.selectedInterests || []);
  const [selectedCircadian, setSelectedCircadian] = useState(currentFilters.selectedCircadian || "all");
  const [selectedAttachment, setSelectedAttachment] = useState(currentFilters.selectedAttachment || "all");
  const [premiumDialogOpen, setPremiumDialogOpen] = useState(false);

  const cities = useMemo(() => {
    if (!selectedCountryFilters || selectedCountryFilters === "all") return ["all"];
    return ["all", ...(POPULAR_CITIES[selectedCountryFilters] || [])];
  }, [selectedCountryFilters]);

  const ALL_COUNTRIES = useMemo(() => Object.keys(POPULAR_CITIES).sort(), []);

  useEffect(() => {
    if (selectedCity && selectedCity !== "all" && !selectedCountryFilters) {
      for (const [country, cities] of Object.entries(POPULAR_CITIES)) {
        if (cities.includes(selectedCity)) {
          setSelectedCountryFilters(country);
          break;
        }
      }
    }
  }, [selectedCity, selectedCountryFilters]);

  const handlePremiumFeatureClick = () => {
    if (!isPro) {
      setPremiumDialogOpen(true);
    }
  };

  const toggleInterest = (interest: string) => {
    if (!isPro) {
      handlePremiumFeatureClick();
      return;
    }
    setSelectedInterests((prev) =>
      prev.includes(interest)
        ? prev.filter((i) => i !== interest)
        : [...prev, interest]
    );
  };

  const handleApply = () => {
    onApplyFilters({
      ageRange,
      distance,
      selectedCity,
      selectedCountry: selectedCountryFilters,
      genderPref,
      selectedDatingGoal: isPro ? selectedDatingGoal : 'all',
      selectedInterests: isPro ? selectedInterests : [],
      selectedCircadian: isPro ? selectedCircadian : 'all',
      selectedAttachment: isPro ? selectedAttachment : 'all',
    });
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[420px] w-[95vw] h-[90vh] rounded-3xl border-0 p-0 bg-white app-shadow flex flex-col">
          <DialogHeader className="p-6 pb-4 border-b">
            <DialogTitle className="text-xl font-black tracking-tight">{t('filters.title')}</DialogTitle>
            <DialogDescription>{t('filters.description')}</DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto">
            <div className="space-y-6 p-6">
              {/* Pro Features Lock */}
              {!isPro && (
                  <div className="p-4 rounded-xl bg-yellow-50 border border-yellow-200 text-yellow-800">
                      <div className="flex items-center gap-3">
                          <Lock className="w-5 h-5" />
                          <div className="flex-1">
                              <h3 className="font-bold text-sm">{t('filters.unlock_all')}</h3>
                              <p className="text-xs">{t('filters.unlock_description')}</p>
                          </div>
                          <Button 
                              size="sm" 
                              className="bg-yellow-400 text-yellow-900 hover:bg-yellow-500 h-8 rounded-lg"
                              onClick={() => setPremiumDialogOpen(true)}
                          >
                              PRO
                          </Button>
                      </div>
                  </div>
              )}

              {/* Dating Goal */}
              <div className="space-y-3" onClick={handlePremiumFeatureClick}>
                <Label className={cn("font-bold flex items-center gap-2", !isPro && "opacity-50")}>
                    {t('filters.dating_goal')} {!isPro && <Lock size={12} />}
                </Label>
                <Select 
                  value={isPro ? selectedDatingGoal : 'all'} 
                  onValueChange={setSelectedDatingGoal}
                  disabled={!isPro}
                >
                  <SelectTrigger className="rounded-xl h-12 font-medium"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="all">{t('filters.all')}</SelectItem>
                    {dynamicGoals.map(goal => <SelectItem key={goal} value={goal}>{t(goal)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Age Range */}
              <div className="space-y-3">
                <Label className="font-bold">{t('filters.age')}: <span className="text-primary font-black">{ageRange[0]} - {ageRange[1]}</span></Label>
                <Slider min={18} max={60} step={1} value={ageRange} onValueChange={setAgeRange} className="[&>span:first-child]:h-1" />
              </div>
              
              {/* Distance */}
              <div className="space-y-3">
                  <Label className="font-bold">{t('filters.distance')}: <span className="text-primary font-black">{t('filters.up_to')} {distance[0]} {t('common.km')}</span></Label>
                  <Slider min={1} max={100} step={1} value={distance} onValueChange={setDistance} />
              </div>

              {/* City */}
              <div className="space-y-3">
                <Label className="font-bold">{t('filters.country_city')}</Label>
                <Select value={selectedCountryFilters} onValueChange={(v) => { setSelectedCountryFilters(v); setSelectedCity("all"); }}>
                  <SelectTrigger className="rounded-xl h-12 font-medium"><SelectValue placeholder={t('filters.select_country')} /></SelectTrigger>
                  <SelectContent className="rounded-xl max-h-60">
                    <SelectItem value="all">{t('filters.all_countries')}</SelectItem>
                    {ALL_COUNTRIES.map(country => <SelectItem key={country} value={country}>{country}</SelectItem>)}
                  </SelectContent>
                </Select>
                {selectedCountryFilters && (
                  <Select value={selectedCity} onValueChange={setSelectedCity}>
                    <SelectTrigger className="rounded-xl h-12 font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-xl max-h-60">
                      {cities.map(city => <SelectItem key={city} value={city}>{city === "all" ? t('filters.all_cities') : city}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
              
              {/* Gender Preference */}
              <div className="space-y-3">
                <Label className="font-bold">{t('filters.looking_for')}</Label>
                 <Select value={genderPref} onValueChange={setGenderPref}>
                    <SelectTrigger className="rounded-xl h-12 font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="male">{t('filters.male')}</SelectItem>
                      <SelectItem value="female">{t('filters.female')}</SelectItem>
                      <SelectItem value="all">{t('filters.all_genders')}</SelectItem>
                    </SelectContent>
                  </Select>
              </div>

              {/* Circadian Rhythm */}
              <div className="space-y-3" onClick={handlePremiumFeatureClick}>
                <Label className={cn("font-bold flex items-center gap-2", !isPro && "opacity-50")}>
                    {t('filters.sleep_mode')} {!isPro && <Lock size={12} />}
                </Label>
                 <Select 
                    value={isPro ? selectedCircadian : 'all'} 
                    onValueChange={setSelectedCircadian} 
                    disabled={!isPro}
                  >
                    <SelectTrigger className="rounded-xl h-12 font-medium"><SelectValue /></SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="all">{t('filters.any')}</SelectItem>
                      {CIRCADIAN_RHYTHM_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{t(opt.label)}</SelectItem>)}
                    </SelectContent>
                  </Select>
              </div>

              {/* Attachment style */}
              <div className="space-y-3" onClick={handlePremiumFeatureClick}>
                  <Label className={cn("font-bold flex items-center gap-2", !isPro && "opacity-50")}>
                      {t('filters.attachment_type')} {!isPro && <Lock size={12} />}
                  </Label>
                  <Select 
                    value={isPro ? selectedAttachment : 'all'} 
                    onValueChange={setSelectedAttachment}
                    disabled={!isPro}
                  >
                      <SelectTrigger className="rounded-xl h-12 font-medium"><SelectValue /></SelectTrigger>
                      <SelectContent className="rounded-xl">
                          <SelectItem value="all">{t('filters.any')}</SelectItem>
                          {ATTACHMENT_STYLE_OPTIONS.map(opt => <SelectItem key={opt.value} value={opt.value}>{t(opt.label)}</SelectItem>)}
                      </SelectContent>
                  </Select>
              </div>

              {/* Interests */}
              <div className="space-y-3">
                  <Label className={cn("font-bold flex items-center gap-2", !isPro && "opacity-50")} onClick={handlePremiumFeatureClick}>
                      {t('filters.interests')} {!isPro && <Lock size={12} />}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                      {[...dynamicInterests].sort((a, b) => t(a).localeCompare(t(b))).map(interest => (
                            <Badge
                                key={interest}
                                onClick={() => toggleInterest(interest)}
                               variant={selectedInterests.includes(interest) ? "default" : "secondary"}
                               className={cn(
                                   "cursor-pointer px-3 py-1.5 rounded-lg transition-all border-0 font-bold text-xs shadow-sm",
                                   selectedInterests.includes(interest) 
                                       ? "gradient-bg text-white hover:brightness-110" 
                                       : "bg-muted text-muted-foreground hover:bg-border",
                                   !isPro && "opacity-50 cursor-not-allowed"
                               )}
                           >
                               {t(interest)}
                           </Badge>
                       ))}
                  </div>
              </div>
            </div>
          </div>
          
          <DialogFooter className="p-6 flex-row gap-3 justify-end bg-muted/30 rounded-b-3xl mt-auto border-t">
            <Button variant="ghost" className="rounded-xl" onClick={() => onOpenChange(false)}>{t('filters.cancel')}</Button>
            <Button onClick={handleApply} className="rounded-xl gradient-bg text-white shadow-lg shadow-primary/20">{t('filters.apply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PremiumDialog open={premiumDialogOpen} onOpenChange={setPremiumDialogOpen} />
    </>
  );
}
