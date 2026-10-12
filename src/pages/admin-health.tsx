import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface HealthService {
  name: string;
  kind: 'probe' | 'config';
  status: 'ok' | 'mock' | 'error';
  mode: 'live' | 'mock' | 'unavailable';
  latencyMs: number;
}

interface HealthReport {
  status: 'ok' | 'degraded';
  checkedAt: string;
  services: HealthService[];
}

const STATUS_VARIANT: Record<HealthService['status'], 'default' | 'secondary' | 'destructive'> = {
  ok: 'default',
  mock: 'secondary',
  error: 'destructive',
};

export default function AdminHealthPage() {
  const { t } = useLanguage();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/health', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch');
      setReport(await res.json());
    } catch {
      toast.error(t('admin.health.error_load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const serviceName = (name: string) => {
    const key = `admin.health.service.${name}`;
    const label = t(key);
    return label === key ? name : label;
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          {t('admin.health.title')}
        </CardTitle>
        <div className="flex items-center gap-2">
          {report && (
            <Badge variant={report.status === 'ok' ? 'default' : 'destructive'} className="text-[9px]">
              {t(`admin.health.overall.${report.status}`)}
            </Badge>
          )}
          <Button data-testid="refresh-health" variant="ghost" size="icon"
            className="rounded-full text-muted-foreground" onClick={load} aria-label={t('admin.health.refresh')}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading && !report ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !report ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('admin.health.error_load')}</div>
        ) : (
          <>
            {report.checkedAt && (
              <div className="mb-3 text-xs text-muted-foreground">
                {t('admin.health.checked_at')}: {new Date(report.checkedAt).toLocaleString()}
              </div>
            )}
            <ul className="divide-y divide-border rounded-2xl border">
              {report.services.map((s) => (
                <li key={s.name} data-testid={`service-${s.name}`} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/5 transition-colors">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{serviceName(s.name)}</span>
                      <Badge variant={STATUS_VARIANT[s.status]} className="text-[9px]">
                        {t(`admin.health.status.${s.status}`)}
                      </Badge>
                      <Badge variant="outline" className="text-[9px]">
                        {t(`admin.health.mode.${s.mode}`)}
                      </Badge>
                    </div>
                    {s.kind === 'probe' && s.latencyMs > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {s.latencyMs} {t('admin.health.latency')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
