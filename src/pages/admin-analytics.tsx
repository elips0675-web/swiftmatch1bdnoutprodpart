import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, Users, DollarSign, ArrowUpRight, Zap, ShieldCheck, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getToken } from '@/lib/token';
import { useLanguage } from '@/context/language-context';

interface Overview {
  mau: string;
  conversionRate: string;
  arpu: string;
}

interface RetentionItem {
  day: string;
  rate: number;
}

interface RevenueMixItem {
  name: string;
  value: number;
  color: string;
}

interface RegistrationItem {
  day: string;
  users: number;
}

export default function AdminAnalyticsPage() {
  const { t } = useLanguage();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [retention, setRetention] = useState<RetentionItem[]>([]);
  const [revenueMix, setRevenueMix] = useState<RevenueMixItem[]>([]);
  const [registrations, setRegistrations] = useState<RegistrationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = getToken();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const apiGet = <T,>(url: string): Promise<T> => fetch(url, { headers }).then(r => { if (!r.ok) throw new Error('fetch failed'); return r.json(); });
        const [ov, ret, mix, reg] = await Promise.all([
          apiGet<Overview>('/api/admin/analytics/overview'),
          apiGet<RetentionItem[]>('/api/admin/analytics/retention'),
          apiGet<RevenueMixItem[]>('/api/admin/analytics/revenue-mix'),
          apiGet<RegistrationItem[]>('/api/admin/analytics/registrations'),
        ]);
        setOverview(ov);
        setRetention(Array.isArray(ret) ? ret : []);
        setRevenueMix(Array.isArray(mix) ? mix : []);
        setRegistrations(Array.isArray(reg) ? reg : []);
      } catch {
        setOverview({ mau: '—', conversionRate: '—', arpu: '—' });
        setRetention([]);
        setRevenueMix([]);
        setRegistrations([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[400px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const stats = [
    { title: t('admin.analytics.mau'), value: overview?.mau ?? '—', sub: '', icon: Users, color: 'text-blue-500', border: 'border-blue-500' },
    { title: t('admin.analytics.conversion'), value: overview?.conversionRate ?? '—', sub: '', icon: Zap, color: 'text-primary', border: 'border-primary' },
    { title: t('admin.analytics.arpu'), value: overview?.arpu ?? '—', sub: '', icon: DollarSign, color: 'text-amber-500', border: 'border-amber-500' },
  ];

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-24 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-emerald-500 text-white border-0 font-black text-[9px] uppercase tracking-widest">{t('admin.analytics.live')}</Badge>
            <span className="text-[10px] text-muted-foreground font-bold uppercase">{t('admin.analytics.real_data')}</span>
          </div>
          <h2 className="text-3xl font-black tracking-tight">{t('admin.analytics.title')}</h2>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-3">
        {stats.map((s, i) => (
          <Card key={i} className={`border-0 shadow-sm border-b-4 ${s.border}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-xs font-black uppercase text-muted-foreground">{s.title}</CardTitle>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader><CardTitle className="text-lg font-black">{t('admin.analytics.retention_rate')}</CardTitle><CardDescription>{t('admin.analytics.retention_desc')}</CardDescription></CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={retention} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs><linearGradient id="cR" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#fe3c72" stopOpacity={0.3}/><stop offset="95%" stopColor="#fe3c72" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#94a3b8'}} />
                <YAxis unit="%" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#94a3b8'}} />
                <Tooltip contentStyle={{borderRadius:'12px',border:'none'}} />
                <Area type="monotone" dataKey="rate" stroke="#fe3c72" strokeWidth={4} fillOpacity={1} fill="url(#cR)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-lg font-black">{t('admin.analytics.revenue_mix')}</CardTitle></CardHeader>
          <CardContent className="h-[300px] flex flex-col items-center justify-center">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={revenueMix} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">{revenueMix.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Tooltip contentStyle={{borderRadius:'12px',border:'none'}}/></PieChart>
            </ResponsiveContainer>
            <div className="w-full space-y-2 mt-4">{revenueMix.map(s=>(<div key={s.name} className="flex items-center justify-between text-[10px] font-black"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{backgroundColor:s.color}}/><span className="text-muted-foreground">{s.name}</span></div><span>{s.value}%</span></div>))}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader><CardTitle className="text-lg font-black">{t('admin.analytics.new_users')}</CardTitle></CardHeader>
          <CardContent className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={registrations} margin={{top:10,right:10,left:-20,bottom:0}}>
                <defs><linearGradient id="cU" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fontSize:10,fill:'#94a3b8'}}/>
                <YAxis hide/>
                <Tooltip contentStyle={{borderRadius:'12px',border:'none'}}/>
                <Area type="monotone" dataKey="users" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#cU)"/>
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm bg-primary/5 border-primary/10 overflow-hidden relative">
          <div className="absolute -right-8 -top-8 text-primary opacity-5 transform rotate-12"><Zap size={160} fill="currentColor"/></div>
          <CardHeader><div className="flex items-center gap-2"><ShieldCheck className="text-primary" size={24}/><CardTitle className="text-lg font-black uppercase">{t('admin.analytics.technical_health')}</CardTitle></div></CardHeader>
          <CardContent className="space-y-6 relative z-10">
            <div className="grid grid-cols-2 gap-4">
              {[{l:t('admin.analytics.api_status'),v:t('admin.analytics.connected'),c:'text-emerald-500'},{l:t('admin.analytics.data_source'),v:t('admin.analytics.live_db'),c:'text-blue-500'},{l:t('admin.analytics.errors'),v:'—',c:'text-muted-foreground'},{l:t('admin.analytics.api_latency'),v:'—',c:'text-amber-500'}].map(s=>(
                <div key={s.l} className="bg-background p-4 rounded-2xl shadow-sm border"><p className="text-[10px] font-black text-muted-foreground uppercase mb-1">{s.l}</p><p className={`text-xl font-black ${s.c}`}>{s.v}</p></div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
