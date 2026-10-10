import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Save, RotateCcw, SlidersHorizontal, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  affectedUsers: number;
}

export default function FeatureFlagsPage() {
  const { t } = useLanguage();

  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [savedFlags, setSavedFlags] = useState<FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchFlags = async () => {
      try {
        const token = getToken();
        const res = await fetch('/api/admin/features', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error('Failed to fetch');
        const data: Record<string, boolean> = await res.json();
        const mapped: FeatureFlag[] = [
          { key: 'videoCalls', label: t('admin.features.video_calls'), description: t('admin.features.video_calls_desc'), enabled: data.videoCalls ?? true, affectedUsers: 12480 },
          { key: 'aiIcebreakers', label: t('admin.features.ai_icebreakers'), description: t('admin.features.ai_icebreakers_desc'), enabled: data.aiIcebreakers ?? true, affectedUsers: 12480 },
          { key: 'aiBioGeneration', label: t('admin.features.ai_bio'), description: t('admin.features.ai_bio_desc'), enabled: false, affectedUsers: 0 },
          { key: 'aiCompatibility', label: t('admin.features.ai_compatibility'), description: t('admin.features.ai_compatibility_desc'), enabled: data.aiCompatibility ?? true, affectedUsers: 8200 },
          { key: 'groupsPage', label: t('admin.features.groups_page'), description: t('admin.features.groups_page_desc'), enabled: data.groupsPage ?? true, affectedUsers: 12480 },
          { key: 'contests', label: t('admin.features.contests'), description: t('admin.features.contests_desc'), enabled: data.contest ?? true, affectedUsers: 6500 },
          { key: 'premiumTiers', label: t('admin.features.premium_tiers'), description: t('admin.features.premium_tiers_desc'), enabled: true, affectedUsers: 2100 },
          { key: 'showAds', label: t('admin.features.show_ads'), description: t('admin.features.show_ads_desc'), enabled: data.showAds ?? false, affectedUsers: 12480 },
          { key: 'hangouts', label: t('admin.features.hangouts'), description: t('admin.features.hangouts_desc'), enabled: data.hangouts ?? false, affectedUsers: 12480 },
          { key: 'partnerOffers', label: t('admin.features.partner_offers'), description: t('admin.features.partner_offers_desc'), enabled: data.partnerOffers ?? false, affectedUsers: 12480 },
          { key: 'profileActivity', label: t('admin.features.profile_activity'), description: t('admin.features.profile_activity_desc'), enabled: data.profileActivity ?? true, affectedUsers: 12480 },
        ];
        setFlags(mapped);
        setSavedFlags(mapped);
      } catch {
        toast.error(t('admin.error.load'));
      } finally {
        setLoading(false);
      }
    };
    fetchFlags();
  }, [t]);

  const toggle = (key: string) => {
    setFlags(prev => prev.map(f => f.key === key ? { ...f, enabled: !f.enabled } : f));
  };

  const hasChanges = JSON.stringify(flags.map(f => ({ key: f.key, enabled: f.enabled }))) !== JSON.stringify(savedFlags.map(f => ({ key: f.key, enabled: f.enabled })));

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, boolean> = {};
      flags.forEach(f => { payload[f.key] = f.enabled; });
      const token = getToken();
      await fetch('/api/admin/features', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      setSavedFlags([...flags]);
      toast.success(t('admin.features.saved'));
    } catch {
      toast.error(t('admin.error.save'));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setFlags([...savedFlags]);
    toast.info(t('admin.features.reset'));
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-primary" />
          Feature Flags
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {flags.map(flag => (
          <div key={flag.key} className="flex items-center justify-between gap-4 p-4 rounded-2xl border bg-background hover:bg-muted/5 transition-colors">
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <Label htmlFor={flag.key} className="text-sm font-bold cursor-pointer">{flag.label}</Label>
                <Badge variant="outline" className="text-[9px]">{flag.affectedUsers.toLocaleString()} users</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{flag.description}</p>
            </div>
            <Switch id={flag.key} checked={flag.enabled} onCheckedChange={() => toggle(flag.key)} />
          </div>
        ))}
      </CardContent>
      <CardFooter className="flex items-center justify-end gap-3 border-t bg-muted/5 px-6 py-4">
        <Button data-testid="reset-features" variant="ghost" onClick={handleReset} disabled={!hasChanges} className="rounded-full text-xs font-bold h-10 px-6">
          <RotateCcw className="mr-2 h-3 w-3" /> {t('admin.features.reset_btn')}
        </Button>
        <Button data-testid="save-features" onClick={handleSave} disabled={!hasChanges || saving} className="min-w-[140px] rounded-full bg-primary text-primary-foreground font-bold h-10 px-8">
          {saving ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Save className="mr-2 h-3 w-3" />}
          {t('admin.features.save_btn')}
        </Button>
      </CardFooter>
    </Card>
  );
}
