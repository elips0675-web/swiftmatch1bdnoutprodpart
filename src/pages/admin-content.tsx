import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, Package, ShieldAlert, Download, Loader2, Globe, ChevronDown, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { invalidateContentCache, useContentConfig } from '@/lib/useContentConfig';
import { POPULAR_CITIES } from '@/lib/constants';
import { exportToCsv } from '@/lib/admin-mock-data';
import { clearToken, getToken } from '@/lib/token';

interface EditableListProps {
  items: string[];
  onAdd: (item: string) => void;
  onDelete: (item: string) => void;
  nounKey: string;
  section: string;
  saving: boolean;
}

function itemLabel(item: string, section: string, t: any): string {
  if (section === 'cities' || section === 'banned_words') return item
  const prefix =
    section === 'interests' ? 'interest.'
    : section === 'goals' ? 'goal.'
    : section === 'education' ? 'education.'
    : null
  if (!prefix) return item
  const raw = item.startsWith(prefix) ? item.slice(prefix.length) : item
  const key = `${prefix}${raw}`
  const translated = t(key)
  return translated !== key ? translated : raw
}

function sortKey(item: string, prefix: string, t: any): string {
  const key = `${prefix}${item}`;
  const translated = t(key);
  return translated !== key ? translated : item;
}

function EditableList({ items, onAdd, onDelete, nounKey, section, saving }: EditableListProps) {
  const { t } = useLanguage();
  const [newItem, setNewItem] = useState('');
  const handleAdd = () => {
    const trimmed = stripPrefix(newItem.trim());
    const stripped = items.map(stripPrefix);
    if (trimmed && !stripped.includes(trimmed)) {
      onAdd(trimmed);
      setNewItem('');
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground font-bold uppercase">
        <span>{t('admin.content.total')}: {items.length}</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" onClick={() => {
          exportToCsv(`${nounKey}.csv`, items.map(i => ({ [nounKey]: i })));
          toast.success(t('admin.content.csv_downloaded'));
        }}><Download size={12} className="mr-1" /> CSV</Button>
      </div>
      <div className="flex flex-wrap items-start gap-2 p-4 rounded-2xl border bg-muted/30">
        {items.map((item) => (
          <Badge key={item} variant="secondary" className="text-xs py-0.5 px-2.5 rounded-full border bg-background shadow-sm flex items-center gap-1 whitespace-nowrap leading-none">
            {itemLabel(item, section, t)}
            <button onClick={(e) => { e.stopPropagation(); if (!confirm(t('admin.content.confirm_delete'))) return; onDelete(item); }} className="text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 size={12} />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Input placeholder={t('admin.content.new_placeholder')} value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdd()} className="h-10 rounded-xl" />
        <Button onClick={handleAdd} disabled={!newItem.trim() || saving} className="rounded-xl h-10 px-6">
          {saving ? <Loader2 size={16} className="animate-spin mr-1" /> : <Plus size={16} className="mr-1" />}
          {t('admin.content.add')}
        </Button>
      </div>
    </div>
  );
}

function stripPrefix(item: string): string {
  for (const p of ['interest.', 'goal.', 'education.']) {
    if (item.startsWith(p)) return item.slice(p.length)
  }
  return item
}

async function saveSection(section: string, items: string[]) {
  const token = getToken()
  const cleanItems = items.map(stripPrefix)
  const res = await fetch(`/api/admin/content/${section}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ items: cleanItems }),
  })
  if (!res.ok) {
    const err = new Error('Failed to save') as Error & { status?: number }
    err.status = res.status
    throw err
  }
  invalidateContentCache()
}

export default function ContentManagementPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const config = useContentConfig();
  const [interests, setInterests] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [education, setEducation] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [forbiddenWords, setForbiddenWords] = useState<string[]>([]);
  const [countriesCities, setCountriesCities] = useState<Record<string, string[]>>({});
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  const [newCountryName, setNewCountryName] = useState('');
  const [newCityForCountry, setNewCityForCountry] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setInterests(config.interests.map(stripPrefix).sort((a, b) => sortKey(a, 'interest.', t).localeCompare(sortKey(b, 'interest.', t))));
    setGoals(config.dating_goals.map(stripPrefix).sort((a, b) => sortKey(a, 'goal.', t).localeCompare(sortKey(b, 'goal.', t))));
    setEducation(config.education.map(stripPrefix).sort((a, b) => sortKey(a, 'education.', t).localeCompare(sortKey(b, 'education.', t))));
    setCities([...config.cities].sort((a, b) => a.localeCompare(b)));
    setForbiddenWords([...config.banned_words].sort((a, b) => a.localeCompare(b)));

    const stored = localStorage.getItem('swiftmatch_countries_cities');
    if (stored) {
      try { setCountriesCities(JSON.parse(stored)); } catch { setCountriesCities({ ...POPULAR_CITIES }); }
    } else {
      setCountriesCities({ ...POPULAR_CITIES });
    }
    setLoading(false);
  }, [config, t]);

  function saveCountriesCities(data: Record<string, string[]>) {
    setCountriesCities(data);
    localStorage.setItem('swiftmatch_countries_cities', JSON.stringify(data));
  }

  const handleSave = async (section: string, items: string[], setter: (v: string[]) => void) => {
    setSaving(section)
    try {
      await saveSection(section, items)
      toast.success(t('admin.content.saved'))
    } catch (e) {
      const status = (e as { status?: number })?.status
      if (status === 401 || status === 403) {
        clearToken();
        toast.error(t('admin.session_expired'));
        navigate('/login');
        return;
      }
      toast.error(t('admin.content.save_error'))
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            {t('admin.content.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="interests" className="w-full">
            <TabsList className="grid w-full grid-cols-2 sm:grid-cols-5 h-auto p-1 bg-muted/50 rounded-xl mb-6">
              <TabsTrigger value="interests" className="rounded-lg py-2 font-bold text-xs">{t('admin.content.tab_interests')} ({interests.length})</TabsTrigger>
              <TabsTrigger value="goals" className="rounded-lg py-2 font-bold text-xs">{t('admin.content.tab_goals')} ({goals.length})</TabsTrigger>
              <TabsTrigger value="education" className="rounded-lg py-2 font-bold text-xs">{t('admin.content.tab_education')} ({education.length})</TabsTrigger>
              <TabsTrigger value="cities" className="rounded-lg py-2 font-bold text-xs">{t('admin.content.tab_cities')} ({cities.length})</TabsTrigger>
              <TabsTrigger value="banned_words" className="rounded-lg py-2 font-bold text-xs">{t('admin.content.forbidden_words')} ({forbiddenWords.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="interests">
              <EditableList items={interests} nounKey="interests" section="interests" saving={saving === 'interests'} onAdd={i => { const next = [...interests, i].sort((a, b) => sortKey(a, 'interest.', t).localeCompare(sortKey(b, 'interest.', t))); setInterests(next); handleSave('interests', next, setInterests); }} onDelete={i => { const next = interests.filter(x => x !== i); setInterests(next); handleSave('interests', next, setInterests); }} />
              <div className="mt-2 flex justify-end">
                <Button size="sm" className="rounded-xl" onClick={() => handleSave('interests', interests, setInterests)} disabled={saving === 'interests'}>{saving === 'interests' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} {t('admin.save')}</Button>
              </div>
            </TabsContent>
            <TabsContent value="goals">
              <EditableList items={goals} nounKey="goals" section="goals" saving={saving === 'dating_goals'} onAdd={i => { const next = [...goals, i].sort((a, b) => sortKey(a, 'goal.', t).localeCompare(sortKey(b, 'goal.', t))); setGoals(next); handleSave('dating_goals', next, setGoals); }} onDelete={i => { const next = goals.filter(x => x !== i); setGoals(next); handleSave('dating_goals', next, setGoals); }} />
              <div className="mt-2 flex justify-end">
                <Button size="sm" className="rounded-xl" onClick={() => handleSave('dating_goals', goals, setGoals)} disabled={saving === 'dating_goals'}>{saving === 'dating_goals' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} {t('admin.save')}</Button>
              </div>
            </TabsContent>
            <TabsContent value="education">
              <EditableList items={education} nounKey="education" section="education" saving={saving === 'education'} onAdd={i => { const next = [...education, i].sort((a, b) => sortKey(a, 'education.', t).localeCompare(sortKey(b, 'education.', t))); setEducation(next); handleSave('education', next, setEducation); }} onDelete={i => { const next = education.filter(x => x !== i); setEducation(next); handleSave('education', next, setEducation); }} />
              <div className="mt-2 flex justify-end">
                <Button size="sm" className="rounded-xl" onClick={() => handleSave('education', education, setEducation)} disabled={saving === 'education'}>{saving === 'education' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} {t('admin.save')}</Button>
              </div>
            </TabsContent>
            <TabsContent value="cities">
              <div className="space-y-6">
                <EditableList items={cities} nounKey="cities" section="cities" saving={saving === 'cities'} onAdd={i => { const next = [...cities, i].sort((a, b) => a.localeCompare(b)); setCities(next); handleSave('cities', next, setCities); }} onDelete={i => { const next = cities.filter(x => x !== i); setCities(next); handleSave('cities', next, setCities); }} />
                <div className="mt-2 flex justify-end">
                  <Button size="sm" className="rounded-xl" onClick={() => handleSave('cities', cities, setCities)} disabled={saving === 'cities'}>{saving === 'cities' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} {t('admin.save')}</Button>
                </div>
                <div className="border-t pt-6">
                  <h4 className="text-sm font-black flex items-center gap-2 mb-4">
                    <Globe size={16} className="text-primary" />
                    Страны
                  </h4>
                  <div className="flex items-center gap-2 mb-4">
                    <Input placeholder="Новая страна" value={newCountryName} onChange={e => setNewCountryName(e.target.value)} className="h-10 rounded-xl" />
                    <Button onClick={() => {
                      const name = newCountryName.trim();
                      if (!name || countriesCities[name]) return;
                      saveCountriesCities({ ...countriesCities, [name]: [] });
                      setNewCountryName('');
                    }} disabled={!newCountryName.trim()} className="rounded-xl h-10 px-6">
                      <Plus size={16} className="mr-1" /> Добавить
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(countriesCities).sort(([a], [b]) => a.localeCompare(b)).map(([country, cityList]) => (
                      <Collapsible key={country} open={expandedCountry === country} onOpenChange={() => setExpandedCountry(expandedCountry === country ? null : country)}>
                        <CollapsibleTrigger className="flex w-full items-center justify-between p-3 rounded-xl border bg-muted/30 hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-2 font-bold text-sm">
                            <MapPin size={14} className="text-primary" />
                            {country}
                            <span className="text-xs text-muted-foreground font-normal ml-1">({cityList.length})</span>
                          </div>
                          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            <button onClick={() => {
                              const next = { ...countriesCities };
                              delete next[country];
                              saveCountriesCities(next);
                            }} className="text-muted-foreground hover:text-destructive transition-colors p-1">
                              <Trash2 size={13} />
                            </button>
                            <ChevronDown size={16} className={`text-muted-foreground transition-transform ${expandedCountry === country ? 'rotate-180' : ''}`} />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="pt-2 pl-4">
                          <div className="flex flex-wrap gap-2 mb-3">
                            {[...cityList].sort((a, b) => a.localeCompare(b)).map(city => (
                              <Badge key={city} variant="secondary" className="text-xs py-0.5 px-2.5 rounded-full border bg-background shadow-sm flex items-center gap-1 whitespace-nowrap leading-none">
                                {city}
                                <button onClick={() => {
                                  saveCountriesCities({ ...countriesCities, [country]: cityList.filter(c => c !== city) });
                                }} className="text-muted-foreground hover:text-destructive transition-colors">
                                  <Trash2 size={12} />
                                </button>
                              </Badge>
                            ))}
                          </div>
                          <div className="flex items-center gap-2">
                            <Input placeholder="Новый город" value={newCityForCountry} onChange={e => setNewCityForCountry(e.target.value)} className="h-9 rounded-xl text-sm" onKeyDown={e => {
                              if (e.key === 'Enter') {
                                const city = newCityForCountry.trim();
                                if (city && !cityList.includes(city)) {
                                  saveCountriesCities({ ...countriesCities, [country]: [...cityList, city].sort((a, b) => a.localeCompare(b)) });
                                  setNewCityForCountry('');
                                }
                              }
                            }} />
                            <Button size="sm" onClick={() => {
                              const city = newCityForCountry.trim();
                              if (city && !cityList.includes(city)) {
                                saveCountriesCities({ ...countriesCities, [country]: [...cityList, city].sort((a, b) => a.localeCompare(b)) });
                                setNewCityForCountry('');
                              }
                            }} disabled={!newCityForCountry.trim()} className="rounded-xl h-9">
                              <Plus size={14} className="mr-1" /> Город
                            </Button>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="banned_words">
              <EditableList items={forbiddenWords} nounKey="words" section="banned_words" saving={saving === 'banned_words'} onAdd={w => { const next = [...forbiddenWords, w].sort((a, b) => a.localeCompare(b)); setForbiddenWords(next); handleSave('banned_words', next, setForbiddenWords); }} onDelete={w => { const next = forbiddenWords.filter(x => x !== w); setForbiddenWords(next); handleSave('banned_words', next, setForbiddenWords); }} />
              <div className="mt-2 flex justify-end">
                <Button size="sm" className="rounded-xl" onClick={() => handleSave('banned_words', forbiddenWords, setForbiddenWords)} disabled={saving === 'banned_words'}>{saving === 'banned_words' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} {t('admin.save')}</Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
