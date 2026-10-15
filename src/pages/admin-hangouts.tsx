import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarDays, Ban, CircleCheck, Loader2, GitMerge } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";

interface AdminHangout {
  id: number;
  author_id: number;
  category: string;
  title: string;
  description: string | null;
  place_name: string | null;
  city: string | null;
  event_date: string;
  max_companions: number;
  status: 'active' | 'cancelled' | 'completed' | 'blocked';
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
  responses_count?: number;
}

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-green-100 text-green-800 border-transparent',
  cancelled: 'bg-gray-100 text-gray-500 border-transparent',
  completed: 'bg-blue-100 text-blue-800 border-transparent',
  blocked: 'bg-red-100 text-red-800 border-transparent',
};

export default function AdminHangoutsPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<AdminHangout[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [mergeTarget, setMergeTarget] = useState<AdminHangout | null>(null);
  const [mergeIntoId, setMergeIntoId] = useState('');
  const [merging, setMerging] = useState(false);

  const fetchData = useCallback(async (status: string) => {
    setLoading(true);
    try {
      const token = getToken();
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/admin/hangouts?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t('hangout.error.load'));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchData(statusFilter); }, [fetchData, statusFilter]);

  const setStatus = async (id: number, status: 'blocked' | 'active') => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/hangouts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(`#${id}: ${t(`hangout.status.${status}`)}`);
      fetchData(statusFilter);
    } catch {
      toast.error(t('hangout.error.load'));
    }
  };

  const openMerge = (h: AdminHangout) => {
    setMergeTarget(h);
    setMergeIntoId('');
  };

  const handleMerge = async () => {
    if (!mergeTarget) return;
    const keepId = Number(mergeIntoId);
    if (!Number.isInteger(keepId) || keepId <= 0 || keepId === mergeTarget.id) {
      toast.error(t('admin.hangouts.merge_invalid'));
      return;
    }
    setMerging(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/hangouts/${mergeTarget.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ mergeIntoId: keepId }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(t('admin.hangouts.merge_success', { id: mergeTarget.id, target: keepId }));
      setMergeTarget(null);
      fetchData(statusFilter);
    } catch {
      toast.error(t('admin.hangouts.merge_error'));
    } finally {
      setMerging(false);
    }
  };

  return (
    <>
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-lg font-black flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          {t('admin.hangouts')}
        </CardTitle>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="h-9 bg-muted/50 rounded-xl p-1">
            <TabsTrigger value="all" className="rounded-lg font-bold text-xs">All</TabsTrigger>
            <TabsTrigger value="active" className="rounded-lg font-bold text-xs">{t('hangout.status.active')}</TabsTrigger>
            <TabsTrigger value="blocked" className="rounded-lg font-bold text-xs">{t('hangout.status.blocked')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">ID</TableHead>
                <TableHead>{t('hangout.label.author')}</TableHead>
                <TableHead>{t('hangout.form.title')}</TableHead>
                <TableHead className="w-28">{t('hangout.form.category')}</TableHead>
                <TableHead className="w-40">{t('hangout.label.when')}</TableHead>
                <TableHead className="w-24">{t('hangout.status.active')}</TableHead>
                <TableHead className="w-44"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    {t('hangout.empty')}
                  </TableCell>
                </TableRow>
              ) : (
                items.map((h) => (
                  <TableRow key={h.id} data-testid={`admin-hangout-${h.id}`}>
                    <TableCell className="font-mono text-xs">{h.id}</TableCell>
                    <TableCell className="text-sm truncate max-w-[140px]">{h.display_name || `user_${h.author_id}`}</TableCell>
                    <TableCell className="text-sm font-medium truncate max-w-[220px]">{h.title}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{t(`hangout.category.${h.category}`)}</Badge></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(h.event_date).toLocaleString()}</TableCell>
                    <TableCell><Badge className={STATUS_BADGES[h.status]}>{t(`hangout.status.${h.status}`)}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1.5 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`merge-hangout-${h.id}`}
                          className="rounded-full h-8 px-3"
                          onClick={() => openMerge(h)}
                        >
                          <GitMerge size={13} className="mr-1" /> {t('admin.hangouts.merge')}
                        </Button>
                        {h.status !== 'blocked' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`block-hangout-${h.id}`}
                            className="rounded-full h-8 px-3 text-destructive hover:text-destructive"
                            onClick={() => setStatus(h.id, 'blocked')}
                          >
                            <Ban size={13} className="mr-1" /> Block
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`unblock-hangout-${h.id}`}
                            className="rounded-full h-8 px-3"
                            onClick={() => setStatus(h.id, 'active')}
                          >
                            <CircleCheck size={13} className="mr-1" /> Unblock
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

    <Dialog open={!!mergeTarget} onOpenChange={(open) => { if (!open) setMergeTarget(null); }}>
      <DialogContent data-testid="merge-hangout-dialog">
        <DialogHeader>
          <DialogTitle>{t('admin.hangouts.merge_title')}</DialogTitle>
          <DialogDescription>
            {t('admin.hangouts.merge_desc', { id: mergeTarget?.id ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <Input
          data-testid="merge-into-id"
          type="number"
          min={1}
          value={mergeIntoId}
          onChange={(e) => setMergeIntoId(e.target.value)}
          placeholder={t('admin.hangouts.merge_placeholder')}
        />
        <DialogFooter>
          <Button variant="ghost" className="rounded-full" onClick={() => setMergeTarget(null)}>
            {t('hangout.action.cancel')}
          </Button>
          <Button
            data-testid="confirm-merge-hangout"
            className="rounded-full font-bold"
            disabled={merging}
            onClick={handleMerge}
          >
            {merging ? <Loader2 size={14} className="mr-2 animate-spin" /> : <GitMerge size={14} className="mr-2" />}
            {t('admin.hangouts.merge_confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
