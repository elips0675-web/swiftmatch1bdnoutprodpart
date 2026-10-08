
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "@/shims/next-navigation";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ALL_DEMO_USERS } from "@/lib/demo-data";
import { POPULAR_CITIES } from "@/lib/constants";
import { useLanguage } from "@/context/language-context";
import { ChevronLeft } from "lucide-react";

const ALL_COUNTRIES = Object.keys(POPULAR_CITIES);
const ALL_CITIES = Object.values(POPULAR_CITIES).flat();

export default function FiltersPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [ageRange, setAgeRange] = useState([18, 40]);
  const [distance, setDistance] = useState([50]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedCity, setSelectedCity] = useState("all");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);

  const allInterests = useMemo(() => {
    const interests = new Set<string>();
    ALL_DEMO_USERS.forEach(user => {
      user.interests.forEach(interest => interests.add(interest));
    });
    return Array.from(interests);
  }, []);

  useEffect(() => {
    const savedFilters = localStorage.getItem("searchFilters");
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        setAgeRange(parsed.ageRange || [18, 40]);
        setDistance(parsed.distance || [50]);
        setSelectedCity(parsed.selectedCity || "all");
        setSelectedInterests(parsed.selectedInterests || []);
        if (parsed.selectedCity && parsed.selectedCity !== "all") {
          for (const [country, cities] of Object.entries(POPULAR_CITIES)) {
            if (cities.includes(parsed.selectedCity)) {
              setSelectedCountry(country);
              break;
            }
          }
        }
      } catch (e) {
        if (import.meta.env.DEV) console.error("Failed to parse filters from localStorage", e);
      }
    }
  }, []);

  const cityOptions = useMemo(() => {
    if (!selectedCountry) return ["all"];
    return ["all", ...(POPULAR_CITIES[selectedCountry] || [])];
  }, [selectedCountry]);

  const handleApply = () => {
    const filters = {
      ageRange,
      distance,
      selectedCity,
      selectedInterests
    };
    localStorage.setItem("searchFilters", JSON.stringify(filters));
    router.push("/search"); // Go back to search page to see the result
  };

  const handleInterestToggle = (interest: string) => {
    setSelectedInterests(prev => 
      prev.includes(interest)
        ? prev.filter(i => i !== interest)
        : [...prev, interest]
    );
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
       <header className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white/95 backdrop-blur-lg z-10">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full">
          <ChevronLeft size={24} />
        </Button>
        <h1 className="text-lg font-bold">{t('search.filters')}</h1>
        <div className="w-10"></div>
      </header>

      <main className="flex-1 p-6 space-y-8">
        <FilterSection title={t('filters.age')}>
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-600">{t('filters.age_from_to', { from: ageRange[0], to: ageRange[1] })}</span>
          </div>
          <Slider
            value={ageRange}
            onValueChange={setAgeRange}
            max={65}
            min={18}
            step={1}
          />
        </FilterSection>

        <FilterSection title={t('filters.distance')}>
            <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">{t('filters.distance_up_to', { distance: distance[0] })}</span>
            </div>
            <Slider 
                value={distance}
                onValueChange={setDistance}
                max={200}
                step={5}
            />
        </FilterSection>

        <FilterSection title={t('filters.city')}>
          <div className="space-y-3">
            <Select value={selectedCountry} onValueChange={(v) => { setSelectedCountry(v === "all" ? "" : v); setSelectedCity("all"); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('filters.select_country')} />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                <SelectItem value="all">{t('filters.all_countries')}</SelectItem>
                {ALL_COUNTRIES.map(country => (
                  <SelectItem key={country} value={country}>{country}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedCountry && (
              <Select value={selectedCity} onValueChange={setSelectedCity}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('filters.select_city')} />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  <SelectItem value="all">{t('filters.all_cities')}</SelectItem>
                  {POPULAR_CITIES[selectedCountry].map(city => (
                    <SelectItem key={city} value={city}>{city}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </FilterSection>

        <FilterSection title={t('filters.interests')}>
            <div className="flex flex-wrap gap-2">
                {allInterests.map(interest => (
                    <Button 
                        key={interest} 
                        variant={selectedInterests.includes(interest) ? "default" : "outline"}
                        onClick={() => handleInterestToggle(interest)}
                        className="rounded-full"
                    >
                        {t(interest)}
                    </Button>
                ))}
            </div>
        </FilterSection>
      </main>

      <footer className="p-4 bg-white border-t sticky bottom-0">
        <Button data-testid="apply-filters" onClick={handleApply} className="w-full h-12">{t('button.apply_filters')}</Button>
      </footer>
    </div>
  );
}

function FilterSection({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
      <div>{children}</div>
    </div>
  );
}
