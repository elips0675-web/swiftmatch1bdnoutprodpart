import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Send, Mail, Bell, Download, Globe, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface Campaign {
  id: number;
  title: string;
  body: string;
  target: string;
  channel: string;
  status: string;
  sentAt: string;
  delivered: number;
  opened: number;
  clicked: number;
}

const STATUS_BADGE: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-800',
  scheduled: 'bg-blue-100 text-blue-800',
  draft: 'bg-gray-100 text-gray-800',
};

export default function AdminMessagingPage() {
  const { t } = useLanguage();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [target, setTarget] = useState('all');
  const [channel, setChannel] = useState('push');
  const [isSending, setIsSending] = useState(false);

  const fetchCampaigns = useCallback(async () => {
    try {
      const token = getToken();
      const res = await fetch('/api/admin/campaigns', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCampaigns(Array.isArray(data) ? data : []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const handleSend = async () => {
    if (!title || !body) { toast.error(t('admin.messaging.fill_all')); return; }
    setIsSending(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title, body, target, channel }),
      });
      if (!res.ok) throw new Error('Failed to send');
      toast.success(t('admin.messaging.sent'));
      setTitle(''); setBody('');
      fetchCampaigns();
    } catch {
      toast.error(t('admin.error.operation'));
    } finally {
      setIsSending(false);
    }
  };

  const handleExport = () => {
    const csvRows = campaigns.map(c => ({ Заголовок: c.title, Канал: c.channel, Аудитория: c.target, Статус: c.status, Дата: c.sentAt, Доставлено: c.delivered, Открыто: c.opened, Клики: c.clicked }));
    if (!csvRows.length) return;
    const headers = Object.keys(csvRows[0]);
    const csv = [headers.join(','), ...csvRows.map(r => headers.map(h => `"${String(r[h as keyof typeof r] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'campaigns.csv'; link.click();
    URL.revokeObjectURL(link.href);
    toast.success('CSV скачан');
  };

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" /> {t('admin.messaging.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">{t('admin.messaging.channel')}</Label>
              <Select value={channel} onValueChange={setChannel}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="push"><Bell size={14} className="inline mr-1" /> Push</SelectItem>
                  <SelectItem value="email"><Mail size={14} className="inline mr-1" /> Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">{t('admin.messaging.audience')}</Label>
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('admin.messaging.all_users')}</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="new">{t('admin.messaging.new_users')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[10px] font-bold uppercase text-muted-foreground">{t('admin.messaging.subject')}</Label>
              <Input data-testid="messaging-title" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('admin.messaging.subject_placeholder')} className="h-10 rounded-xl" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase text-muted-foreground">{t('admin.messaging.message_text')}</Label>
            <Textarea data-testid="messaging-body" value={body} onChange={e => setBody(e.target.value)} placeholder={t('admin.messaging.text_placeholder')} className="min-h-[120px] rounded-xl" />
          </div>
        </CardContent>
        <CardFooter className="border-t p-4 flex justify-end">
          <Button data-testid="send-campaign" onClick={handleSend} disabled={isSending || !title || !body} className="rounded-full h-10 px-8 font-bold">
            {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {t('admin.messaging.send')}
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-black">{t('admin.messaging.history')}</CardTitle>
          <Button variant="outline" size="sm" className="rounded-xl h-8" onClick={handleExport}>
            <Download size={12} className="mr-1" /> CSV
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.messaging.subject')}</TableHead>
                <TableHead className="hidden sm:table-cell">{t('admin.messaging.channel')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('admin.messaging.audience')}</TableHead>
                <TableHead>{t('admin.messaging.status')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('admin.messaging.delivered')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('admin.messaging.opened')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('admin.messaging.clicked')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" /></TableCell></TableRow>
              ) : campaigns.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-sm max-w-[250px] truncate">{c.title}</TableCell>
                  <TableCell className="hidden sm:table-cell"><Badge variant="outline" className="text-[9px]">{c.channel}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell text-xs">{c.target}</TableCell>
                  <TableCell><Badge className={`text-[9px] border-0 ${STATUS_BADGE[c.status] || ''}`}>{c.status}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell text-xs">{c.delivered?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs">{c.opened?.toLocaleString() ?? '—'}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs">{c.clicked?.toLocaleString() ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
