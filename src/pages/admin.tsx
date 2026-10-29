import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserCheck, Heart, DollarSign, TrendingUp, Crown, UserPlus, Flag, Loader2, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell
} from 'recharts';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';
import TwoFaSettings from '@/components/admin/two-fa-settings';

const COLORS = ['#fe3c72','#ff8e53','#3b82f6','#8b5cf6','#10b981','#f59e0b','#ec4899','#6366f1'];

const activityIcons: Record<string, React.ReactNode> = {
  registration: <UserPlus size={14} className="text-blue-500" />,
  match: <Heart size={14} className="text-primary" fill="currentColor" />,
  report: <Flag size={14} className="text-amber-500" />,
  premium: <Crown size={14} className="text-yellow-500" />,
};

interface Stats {
  totalUsers: number;
  activeToday: number;
  totalMatches: number;
  revenue: number;
  activeSubs: number;
  newToday: number;
}

interface RevenueMonth {
  month: string;
  revenue: number;
}

interface TrendItem {
  date: string;
  users: number;
}

interface CityItem {
  name: string;
  value: number;
}

interface ActivityItem {
  id: number;
  type: string;
  text: string;
  time: string;
}

const EMPTY_STATS: Stats = {
  totalUsers: 0,
  activeToday: 0,
  totalMatches: 0,
  revenue: 0,
  activeSubs: 0,
  newToday: 0,
};

const authHeaders = (token: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};

const fetchJson = async <T,>(url: string, token: string | null): Promise<T> => {
  const res = await fetch(url, { headers: authHeaders(token) });
  if (!res.ok) throw new Error('fetch failed');
  return res.json();
};

const asArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

export default function AdminDashboardPage() {
  const [trendPeriod, setTrendPeriod] = useState<'7' | '30' | '90'>('7');
  const { t } = useLanguage();

  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [trendData, setTrendData] = useState<TrendItem[]>([]);
  const [cityData, setCityData] = useState<CityItem[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [revenueByMonth, setRevenueByMonth] = useState<RevenueMonth[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      const token = getToken();
      try {
        const [s, cities, act, rev] = await Promise.all([
          fetchJson<Stats>('/api/admin/stats', token),
          fetchJson<CityItem[]>('/api/admin/city-distribution', token),
          fetchJson<ActivityItem[]>('/api/admin/recent-activity', token),
          fetchJson<RevenueMonth[]>('/api/admin/revenue-by-month', token),
        ]);
        setStats(s);
        setCityData(asArray<CityItem>(cities));
        setActivity(asArray<ActivityItem>(act));
        setRevenueByMonth(asArray<RevenueMonth>(rev));
      } catch {
        setStats(EMPTY_STATS);
        setCityData([]);
        setActivity([]);
        setRevenueByMonth([]);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    const token = getToken();
    fetchJson<TrendItem[]>(`/api/admin/registration-trend?period=${trendPeriod}`, token)
      .then(data => setTrendData(asArray<TrendItem>(data)))
      .catch(() => setTrendData([]));
  }, [trendPeriod]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const dSuffix = t('units.d_short');
  const currency = stats.revenue != null
    ? `${stats.revenue.toLocaleString()} ₽`
    : t('admin.dash.revenue_value');

  const kpis = [
    { title: t('admin.dash.total_users'), value: stats.totalUsers.toLocaleString(), icon: Users, color: 'text-blue-500', change: '' },
    { title: t('admin.dash.new_today'), value: stats.newToday, icon: UserPlus, color: 'text-sky-500', change: '' },
    { title: t('admin.dash.active_today'), value: stats.activeToday, icon: UserCheck, color: 'text-emerald-500', change: stats.totalUsers ? `${Math.round((stats.activeToday / stats.totalUsers) * 100)}% ${t('admin.dash.from_all')}` : '' },
    { title: t('admin.dash.active_subs'), value: stats.activeSubs.toLocaleString(), icon: Crown, color: 'text-yellow-500', change: '' },
    { title: t('admin.dash.total_matches'), value: stats.totalMatches.toLocaleString(), icon: Heart, color: 'text-primary', change: '' },
    { title: t('admin.dash.revenue_month'), value: currency, icon: DollarSign, color: 'text-amber-500', change: '' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-black uppercase tracking-widest text-muted-foreground">{kpi.title}</CardTitle>
              <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black tracking-tighter">{kpi.value}</div>
              {kpi.change && (
                <p className="text-[10px] text-emerald-500 font-bold mt-1 flex items-center gap-1">
                  <TrendingUp size={10} /> {kpi.change}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <TwoFaSettings />
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-black">{t('admin.dash.reg_trend')}</CardTitle>
            <Tabs value={trendPeriod} onValueChange={(v) => setTrendPeriod(v as '7'|'30'|'90')}>
              <TabsList className="h-8">
                <TabsTrigger value="7" className="text-xs px-3 h-6">7{dSuffix}</TabsTrigger>
                <TabsTrigger value="30" className="text-xs px-3 h-6">30{dSuffix}</TabsTrigger>
                <TabsTrigger value="90" className="text-xs px-3 h-6">90{dSuffix}</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorReg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fe3c72" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#fe3c72" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8'}} interval={trendPeriod === '90' ? 9 : trendPeriod === '30' ? 4 : 0} />
                <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
                <Area type="monotone" dataKey="users" stroke="#fe3c72" strokeWidth={3} fillOpacity={1} fill="url(#colorReg)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-black">{t('admin.dash.top_cities')}</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] flex flex-col items-center">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={cityData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
                  {cityData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="w-full space-y-1.5 mt-2">
              {cityData.slice(0, 5).map((c, i) => (
                <div key={c.name} className="flex items-center justify-between text-[10px] font-bold">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i] }} />
                    <span className="text-muted-foreground">{c.name}</span>
                  </div>
                  <span>{c.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-black">{t('admin.dash.revenue_trend')}</CardTitle>
        </CardHeader>
        <CardContent className="h-[250px]">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={revenueByMonth} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fontSize: 9, fill: '#94a3b8'}} />
              <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8'}} />
              <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }} />
              <Area type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={3} fillOpacity={1} fill="url(#colorRev)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-black">{t('admin.dash.recent_activity')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {activity.map(item => (
              <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  {activityIcons[item.type] || <Flag size={14} className="text-muted-foreground" />}
                </div>
                <span className="text-sm font-medium flex-1">{item.text}</span>
                <Badge variant="outline" className="text-[9px] shrink-0">{item.time}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
