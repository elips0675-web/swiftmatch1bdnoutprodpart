import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Webhook, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface Delivery {
  id: number;
  provider: string;
  eventId: string;
  eventType: string | null;
  status: 'received' | 'processed' | 'failed';
  error: string | null;
  attempts: number;
  createdAt: string;
  processedAt: string | null;
}

const REPLAYABLE = new Set(['stripe', 'stripe_event', 'stripe_partner_order', 'stripe_partner_sub', 'stripe_hangout_ticket']);

const STATUS_VARIANT: Record<Delivery['status'], 'secondary' | 'default' | 'destructive'> = {
  received: 'secondary',
  processed: 'default',
  failed: 'destructive',
};

export default function AdminWebhooksPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<Delivery[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [replaying, setReplaying] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (providerFilter) params.set('provider', providerFilter);
      const qs = params.toString();
      const res = await fetch(`/api/admin/webhooks${qs ? `?${qs}` : ''}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch {
      toast.error(t('admin.webhooks.error_list'));
    } finally {
      setLoading(false);
    }
  }, [t, statusFilter, providerFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReplay = async (id: number) => {
    setReplaying(id);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/webhooks/${id}/replay`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed');
      toast.success(t('admin.webhooks.replay_success'));
      await load();
    } catch {
      toast.error(t('admin.webhooks.replay_error'));
    } finally {
      setReplaying(null);
    }
  };

  const providerName = (p: string) => {
    const key = `admin.webhooks.provider.${p}`;
    const label = t(key);
    return label === key ? p : label;
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <Webhook className="h-5 w-5 text-primary" />
          {t('admin.webhooks.title')}
        </CardTitle>
        <div className="flex items-center gap-2">
          <select
            data-testid="filter-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-10 rounded-full border bg-background px-3 text-sm"
          >
            <option value="">{t('admin.webhooks.filter_status')}</option>
            <option value="received">{t('admin.webhooks.status.received')}</option>
            <option value="processed">{t('admin.webhooks.status.processed')}</option>
            <option value="failed">{t('admin.webhooks.status.failed')}</option>
          </select>
          <select
            data-testid="filter-provider"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="h-10 rounded-full border bg-background px-3 text-sm"
          >
            <option value="">{t('admin.webhooks.filter_provider')}</option>
            <option value="stripe">stripe</option>
            <option value="stripe_event">stripe_event</option>
            <option value="stripe_partner_order">stripe_partner_order</option>
            <option value="stripe_partner_sub">stripe_partner_sub</option>
            <option value="stripe_hangout_ticket">stripe_hangout_ticket</option>
          </select>
          <Button data-testid="refresh-webhooks" variant="ghost" size="icon"
            className="rounded-full text-muted-foreground" onClick={load} aria-label={t('admin.webhooks.refresh')}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('admin.webhooks.empty')}</div>
        ) : (
          <>
            <div className="mb-3 text-xs text-muted-foreground">
              {t('admin.webhooks.total')}: {total}
            </div>
            <ul className="divide-y divide-border rounded-2xl border">
              {rows.map((d) => (
                <li key={d.id} data-testid={`delivery-${d.id}`} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/5 transition-colors">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[9px]">{providerName(d.provider)}</Badge>
                      <Badge variant={STATUS_VARIANT[d.status]} className="text-[9px]">
                        {t(`admin.webhooks.status.${d.status}`)}
                      </Badge>
                      {d.attempts > 1 && (
                        <span className="text-[10px] text-muted-foreground">×{d.attempts}</span>
                      )}
                    </div>
                    <p className="truncate text-sm font-semibold">{d.eventType || d.eventId}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{d.eventId}</span>
                      <span>·</span>
                      <span>{new Date(d.createdAt).toLocaleString()}</span>
                    </div>
                    {d.error && <p className="truncate text-xs text-destructive">{d.error}</p>}
                  </div>
                  <Button
                    data-testid={`replay-${d.id}`}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={replaying === d.id || !REPLAYABLE.has(d.provider)}
                    onClick={() => handleReplay(d.id)}
                    aria-label={t('admin.webhooks.replay')}
                  >
                    {replaying === d.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                    <span className="ml-1.5">{replaying === d.id ? t('admin.webhooks.replaying') : t('admin.webhooks.replay')}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
