import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, X, Loader2, Image, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface Photo {
  id: number;
  url: string;
  user_id: number;
  created_at: string;
  display_name: string;
  avatar_url: string;
  moderation_status: string;
}

export default function AdminPhotosPage() {
  const { t } = useLanguage();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<number, boolean>>({});
  const [filter, setFilter] = useState<'all' | 'pending'>('all');
  const [rejectReason, setRejectReason] = useState('admin.photos.reason.inappropriate');

  const fetchPhotos = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const endpoint = filter === 'pending' ? '/api/admin/photos/pending' : '/api/admin/photos';
      const res = await fetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setPhotos(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore network errors */ } finally { setLoading(false) }
  }, [filter]);

  useEffect(() => { fetchPhotos() }, [fetchPhotos]);

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    setSaving(prev => ({ ...prev, [id]: true }));
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/photos/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: action === 'reject' ? JSON.stringify({ reason: rejectReason }) : undefined,
      });
      if (res.ok) {
        setPhotos(prev => prev.filter(p => p.id !== id));
        toast.success(action === 'approve' ? t('admin.photos.approved') : t('admin.photos.rejected'));
      } else {
        toast.error(t('admin.photos.error'));
      }
    } catch { toast.error(t('admin.photos.error')); } finally { setSaving(prev => ({ ...prev, [id]: false })) }
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
                <Image size={18} className="text-primary" />
                {t('admin.photos.title')}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{t('admin.photos.count', { count: photos.length })}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={filter === 'all' ? 'default' : 'secondary'} onClick={() => setFilter('all')} className="rounded-full">
                <Image size={14} className="mr-1" /> {t('admin.photos.all')}
              </Button>
              <Button size="sm" variant={filter === 'pending' ? 'default' : 'secondary'} onClick={() => setFilter('pending')} className="rounded-full">
                <Clock size={14} className="mr-1" /> {t('admin.photos.pending')}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-primary" size={32} /></div>
      ) : photos.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-20 text-center text-muted-foreground">
            <Image size={48} className="mx-auto mb-4 opacity-30" />
            <p className="font-bold">{t('admin.photos.empty')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {photos.map(photo => (
            <Card key={photo.id} className="border-0 shadow-sm overflow-hidden">
              <div className="aspect-[4/3] bg-muted relative">
                <img src={photo.url} alt="" className="w-full h-full object-cover" />
                <Badge className="absolute top-2 right-2 bg-black/60 text-white border-0 text-[10px] uppercase">
                  {photo.moderation_status}
                </Badge>
              </div>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="secondary" className="truncate max-w-[160px]">{photo.display_name}</Badge>
                  <Badge variant="outline" className="text-muted-foreground shrink-0">#{photo.user_id}</Badge>
                </div>
                <div className="flex flex-col gap-2">
                  <Select value={rejectReason} onValueChange={setRejectReason}>
                    <SelectTrigger className="h-8 text-xs" data-testid="reject-reason" aria-label={t('admin.photos.reason_label')}>
                      <SelectValue placeholder={t('admin.photos.reason_label')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin.photos.reason.inappropriate">{t('admin.photos.reason.inappropriate')}</SelectItem>
                      <SelectItem value="admin.photos.reason.spam">{t('admin.photos.reason.spam')}</SelectItem>
                      <SelectItem value="admin.photos.reason.offensive">{t('admin.photos.reason.offensive')}</SelectItem>
                      <SelectItem value="admin.photos.reason.other">{t('admin.photos.reason.other')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleAction(photo.id, 'approve')} disabled={saving[photo.id]} className="flex-1 rounded-full">
                      {saving[photo.id] ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
                      {' '}{t('admin.photos.approve')}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleAction(photo.id, 'reject')} disabled={saving[photo.id]} className="flex-1 rounded-full">
                      {saving[photo.id] ? <Loader2 className="animate-spin" size={14} /> : <X size={14} />}
                      {' '}{t('admin.photos.reject')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
