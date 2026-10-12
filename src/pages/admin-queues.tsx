import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Layers, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface QueueCounts {
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
}

interface QueueFailedJob {
  id: string | number;
  name: string;
  attemptsMade: number;
  failedReason: string;
}

interface QueueStat {
  name: string;
  enabled: boolean;
  counts: QueueCounts | null;
  failed: QueueFailedJob[];
}

interface QueuesResponse {
  queues: QueueStat[];
  available: string[];
  redisConfigured: boolean;
}

const COUNT_KEYS = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;

export default function AdminQueuesPage() {
  const { t } = useLanguage();
  const [data, setData] = useState<QueuesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/queues', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch');
      setData(await res.json());
    } catch {
      toast.error(t('admin.queues.error_load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const retry = useCallback(async (name: string) => {
    setRetrying(name);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/queues/${name}/retry`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to retry');
      const body = await res.json();
      toast.success(t('admin.queues.retried', { count: String(body.retried ?? 0) }));
      await load();
    } catch {
      toast.error(t('admin.queues.error_retry'));
    } finally {
      setRetrying(null);
    }
  }, [t, load]);

  const queueName = (name: string) => {
    const key = `admin.queues.queue.${name}`;
    const label = t(key);
    return label === key ? name : label;
  };

  const hasDisabled = data?.queues.some((queue) => !queue.enabled) ?? false;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          {t('admin.queues.title')}
        </CardTitle>
        <Button data-testid="refresh-queues" variant="ghost" size="icon"
          className="rounded-full text-muted-foreground" onClick={load} aria-label={t('admin.queues.refresh')}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !data ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('admin.queues.error_load')}</div>
        ) : (
          <>
            {hasDisabled && (
              <div data-testid="queue-warning"
                className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                {t(data.redisConfigured ? 'admin.queues.redis_unreachable' : 'admin.queues.redis_not_configured')}
              </div>
            )}
            <div className="space-y-4">
              {data.queues.map((queue) => (
                <div key={queue.name} data-testid={`queue-${queue.name}`} className="rounded-2xl border p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{queueName(queue.name)}</span>
                      <Badge data-testid={`queue-${queue.name}-status`}
                        variant={queue.enabled ? 'default' : 'destructive'} className="text-[9px]">
                        {t(queue.enabled ? 'admin.queues.enabled' : 'admin.queues.disabled')}
                      </Badge>
                    </div>
                    {queue.enabled && queue.failed.length > 0 && (
                      <Button data-testid={`retry-${queue.name}`} variant="outline" size="sm"
                        className="rounded-full" disabled={retrying === queue.name} onClick={() => retry(queue.name)}>
                        <RotateCcw className={`h-3.5 w-3.5 mr-1 ${retrying === queue.name ? 'animate-spin' : ''}`} />
                        {t('admin.queues.retry')}
                      </Button>
                    )}
                  </div>
                  {queue.enabled && queue.counts ? (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {COUNT_KEYS.map((countKey) => (
                        <div key={countKey} className="rounded-xl bg-muted/40 p-2 text-center">
                          <div className="text-lg font-black">{queue.counts?.[countKey] ?? 0}</div>
                          <div className="text-[10px] uppercase text-muted-foreground">
                            {t(`admin.queues.count.${countKey}`)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-muted-foreground">{t('admin.queues.no_stats')}</div>
                  )}
                  {queue.enabled && queue.failed.length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {queue.failed.slice(0, 5).map((job) => (
                        <li key={String(job.id)} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                          <span className="truncate">{job.name} #{job.id}</span>
                          <span className="truncate text-destructive">{job.failedReason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
