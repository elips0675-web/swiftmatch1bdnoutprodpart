import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DatabaseBackup, Download, Loader2, RefreshCw, FileArchive } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/context/language-context';
import { getToken } from '@/lib/token';

interface BackupItem {
  name: string;
  size: number;
  createdAt: string;
}

function formatSize(bytes: number, t: (key: string) => string): string {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(2)} ${t('admin.backup.unit_gb')}`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(2)} ${t('admin.backup.unit_mb')}`;
  return `${(bytes / kb).toFixed(2)} ${t('admin.backup.unit_kb')}`;
}

export default function AdminBackupPage() {
  const { t } = useLanguage();
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingFiles, setCreatingFiles] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/backup', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setBackups(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t('admin.backup.error_list'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/backup', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const key = body?.message === 'BACKUP_MYSQLDUMP_NOT_AVAILABLE' ? 'admin.backup.error_mysqldump' : 'admin.backup.error_create';
        toast.error(t(key));
        return;
      }
      toast.success(t('admin.backup.create_success'));
      await load();
    } catch {
      toast.error(t('admin.backup.error_create'));
    } finally {
      setCreating(false);
    }
  };

  const handleCreateFiles = async () => {
    setCreatingFiles(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/backup/files', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || 'Failed');
      }
      toast.success(t('admin.backup.create_success'));
      await load();
    } catch {
      toast.error(t('admin.backup.error_create'));
    } finally {
      setCreatingFiles(false);
    }
  };

  const handleDownload = async (name: string) => {
    setDownloading(name);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/backup/${encodeURIComponent(name)}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t('admin.backup.error_download'));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-primary" />
          {t('admin.backup.title')}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button data-testid="refresh-backups" variant="ghost" size="icon"
            className="rounded-full text-muted-foreground" onClick={load} aria-label={t('admin.backup.refresh')}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button data-testid="create-backup" onClick={handleCreate} disabled={creating}
            className="rounded-full bg-primary text-primary-foreground font-bold h-10 px-6">
            {creating ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <DatabaseBackup className="mr-2 h-3 w-3" />}
            {creating ? t('admin.backup.creating') : t('admin.backup.create')}
          </Button>
          <Button variant="outline" data-testid="create-backup-files" onClick={handleCreateFiles} disabled={creatingFiles}
            className="rounded-full font-bold h-10 px-6">
            {creatingFiles ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <FileArchive className="mr-2 h-3 w-3" />}
            {creatingFiles ? t('admin.backup.creating_files') : t('admin.backup.create_files')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : backups.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">{t('admin.backup.empty')}</div>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border">
            {backups.map((b) => (
              <li key={b.name} className="flex items-center justify-between gap-4 p-4 hover:bg-muted/5 transition-colors">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-semibold">{b.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{new Date(b.createdAt).toLocaleString()}</span>
                    <Badge variant="secondary" className="text-[9px]">{b.name.endsWith('.zip') ? t('admin.backup.file_label') : t('admin.backup.db_label')}</Badge>
                    <Badge variant="outline" className="text-[9px]">{formatSize(b.size, t)}</Badge>
                  </div>
                </div>
                <Button data-testid={`download-${b.name}`} variant="outline" size="sm" className="rounded-full"
                  disabled={downloading === b.name} onClick={() => handleDownload(b.name)} aria-label={t('admin.backup.download')}>
                  {downloading === b.name ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  <span className="ml-1.5">{t('admin.backup.download')}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
