import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, DollarSign, Crown, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

type PricingTier = {
  key?: string;
  tier: string;
  color?: string;
  prices: Record<string, number>;
};

type RevenuePoint = {
  month: string;
  subscriptions: number;
  ads: number;
  boosts: number;
};

type FunnelStep = { stage: string; count: number };

type AdSettings = { google: boolean; yandex: boolean; googleId: string; yandexId: string };

export default function MonetizationPage() {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [pricing, setPricing] = useState<PricingTier[]>([]);
  const [revenueData, setRevenueData] = useState<RevenuePoint[]>([]);
  const [funnelData, setFunnelData] = useState<FunnelStep[]>([]);
  const [ads, setAds] = useState<AdSettings>({ google: true, yandex: false, googleId: 'ca-app-pub-3940256099942544/5224354917', yandexId: 'R-M-DEMO-rewarded' });

  useEffect(() => {
    const token = getToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const apiGet = (url: string) => fetch(url, { headers }).then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json(); });
    const ensureArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
    Promise.all([
      apiGet('/api/admin/monetization/pricing'),
      apiGet('/api/admin/monetization/revenue'),
      apiGet('/api/admin/monetization/funnel'),
      apiGet('/api/admin/monetization/ads').catch(() => null),
    ])
      .then(([pricingData, revenue, funnel, adsData]) => {
        setPricing(ensureArray<PricingTier>(pricingData));
        setRevenueData(ensureArray<RevenuePoint>(revenue));
        setFunnelData(ensureArray<FunnelStep>(funnel));
        if (adsData) setAds(adsData as AdSettings);
      })
      .catch(() => {
        toast.error(t('admin.error.load'));
      })
      .finally(() => setLoading(false));
  }, [t]);

  const updatePrice = (tierIdx: number, period: string, value: string) => {
    setPricing(prev => prev.map((t, i) => i === tierIdx ? { ...t, prices: { ...t.prices, [period]: Number(value) || 0 } } : t));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" /> {t('admin.monetization.pricing_title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {pricing.map((tier, ti) => (
              <div key={tier.key || tier.tier} className="p-4 rounded-2xl border space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tier.color }} />
                  <span className="font-black text-sm uppercase">{tier.tier}</span>
                </div>
                {(['1', '6', '12'] as const).map(period => (
                  <div key={period} className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground w-16">{period} {t('units.month_short')}</Label>
                    <Input type="number" value={tier.prices[period]} onChange={e => updatePrice(ti, period, e.target.value)} className="h-9 rounded-lg text-right font-bold" />
                    <span className="text-xs text-muted-foreground">{t('units.ruble')}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
        <CardFooter className="border-t p-4 flex justify-end">
          <Button onClick={async () => {
            const token = getToken()
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (token) headers['Authorization'] = `Bearer ${token}`
            try {
              const res = await fetch('/api/admin/monetization/pricing', {
                method: 'PUT',
                headers,
                body: JSON.stringify({ tiers: pricing }),
              })
              if (res.ok) toast.success(t('admin.monetization.prices_saved'))
              else throw new Error()
            } catch { toast.error(t('admin.monetization.save_error')) }
          }} className="rounded-full h-10 px-8 font-bold">
            <Save className="mr-2 h-3 w-3" /> {t('admin.monetization.save')}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-black flex items-center gap-2">
            <DollarSign className="h-5 w-5" /> {t('admin.monetization.ad_blocks')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-2xl border">
            <div><Label className="font-bold">Google AdMob</Label><p className="text-xs text-muted-foreground">Rewarded ads</p></div>
            <Switch checked={ads.google} onCheckedChange={v => setAds(p => ({ ...p, google: v }))} />
          </div>
          {ads.google && (
            <div className="pl-4 ml-4 border-l-2 space-y-2">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">Ad Unit ID</Label>
              <Input value={ads.googleId} onChange={e => setAds(p => ({ ...p, googleId: e.target.value }))} className="h-9 rounded-lg font-mono text-xs" />
            </div>
          )}
          <div className="flex items-center justify-between p-4 rounded-2xl border">
            <div><Label className="font-bold">Yandex Ads</Label><p className="text-xs text-muted-foreground">Rewarded video</p></div>
            <Switch checked={ads.yandex} onCheckedChange={v => setAds(p => ({ ...p, yandex: v }))} />
          </div>
          {ads.yandex && (
            <div className="pl-4 ml-4 border-l-2 space-y-2">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">Ad Unit ID</Label>
              <Input value={ads.yandexId} onChange={e => setAds(p => ({ ...p, yandexId: e.target.value }))} className="h-9 rounded-lg font-mono text-xs" />
            </div>
          )}
        </CardContent>
        <CardFooter className="border-t p-4 flex justify-end">
          <Button onClick={async () => {
            const token = getToken()
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (token) headers['Authorization'] = `Bearer ${token}`
            try {
              const res = await fetch('/api/admin/monetization/ads', {
                method: 'PUT',
                headers,
                body: JSON.stringify(ads),
              })
              if (res.ok) toast.success(t('admin.monetization.ads_saved'))
              else throw new Error()
            } catch { toast.error(t('admin.monetization.save_error')) }
          }} className="rounded-full h-10 px-8 font-bold">
            <Save className="mr-2 h-3 w-3" /> {t('admin.monetization.save')}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-black">{t('admin.monetization.monthly_revenue')}</CardTitle>
        </CardHeader>
        <CardContent className="h-[350px]">
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={revenueData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#94a3b8' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
              <Legend />
              <Bar dataKey="subscriptions" name={t('admin.monetization.subscriptions')} fill="#fe3c72" radius={[4, 4, 0, 0]} />
              <Bar dataKey="ads" name={t('admin.monetization.ads')} fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="boosts" name={t('admin.monetization.boosts')} fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-black">{t('admin.monetization.conversion_funnel')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {funnelData.map((step, i) => {
              const pct = funnelData.length > 0 ? Math.round((step.count / funnelData[0].count) * 100) : 0;
              return (
                <div key={step.stage} className="flex items-center gap-3">
                  <span className="text-xs font-bold w-36 text-muted-foreground shrink-0">{step.stage}</span>
                  <div className="flex-1 h-8 bg-muted/30 rounded-lg overflow-hidden relative">
                    <div className="h-full rounded-lg transition-all" style={{ width: `${pct}%`, backgroundColor: `hsl(${340 - i * 20}, 80%, 55%)` }} />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-black">{step.count.toLocaleString()} ({pct}%)</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
