import { useCallback, useEffect, useState } from "react";
import { Monitor, Smartphone, Globe, LogOut, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { useLanguage } from "@/context/language-context";
import { useAuth } from "@/context/auth-context";
import { api } from "@/lib/api";

interface Session {
  familyId: string;
  current: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

function deviceKind(ua: string | null) {
  if (!ua) return "unknown";
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return "mobile";
  if (/Macintosh|Windows|X11|Linux/i.test(ua)) return "desktop";
  return "unknown";
}

function describeDevice(ua: string | null, t: (k: string) => string) {
  if (!ua) return t('sessions.unknown_device');
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : null;
  const os = /Windows/i.test(ua) ? 'Windows'
    : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
    : /Android/i.test(ua) ? 'Android'
    : /Macintosh|Mac OS/i.test(ua) ? 'macOS'
    : /X11|Linux/i.test(ua) ? 'Linux'
    : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser || os || t('sessions.unknown_device');
}

function formatDate(value: string, locale: string) {
  const d = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(locale === 'EN' ? 'en-US' : 'ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SessionsSection() {
  const { t, language } = useLanguage();
  const { logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyFamily, setBusyFamily] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api.get<{ sessions: Session[] }>('/api/auth/sessions');
      setSessions(data.sessions || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (session: Session) => {
    if (!confirm(t('sessions.revoke_confirm'))) return;
    setBusyFamily(session.familyId);
    try {
      const res = await api.delete<{ currentRevoked: boolean }>(
        `/api/auth/sessions/${encodeURIComponent(session.familyId)}`,
      );
      toast({ title: t('sessions.revoked') });
      if (res.currentRevoked) {
        await logout();
        return;
      }
      setSessions((prev) => prev.filter((s) => s.familyId !== session.familyId));
    } catch {
      toast({ variant: 'destructive', title: t('sessions.revoke_error') });
    } finally {
      setBusyFamily(null);
    }
  };

  const revokeAll = async () => {
    if (!confirm(t('sessions.revoke_confirm'))) return;
    setRevokingAll(true);
    try {
      await api.post('/api/auth/logout-all');
      toast({ title: t('sessions.revoke_all_done') });
      await logout();
    } catch {
      toast({ variant: 'destructive', title: t('sessions.revoke_error') });
      setRevokingAll(false);
    }
  };

  const others = sessions.filter((s) => !s.current);

  return (
    <div data-testid="sessions-section" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{t('sessions.title')}</p>
          <p className="text-xs text-muted-foreground">{t('sessions.desc')}</p>
        </div>
        {others.length > 0 && (
          <Button
            data-testid="sessions-revoke-all"
            variant="outline"
            size="sm"
            disabled={revokingAll}
            onClick={() => void revokeAll()}
          >
            {revokingAll ? <Loader2 size={14} className="mr-2 animate-spin" /> : <LogOut size={14} className="mr-2" />}
            {t('sessions.revoke_all')}
          </Button>
        )}
      </div>

      {loading && (
        <div className="space-y-2" data-testid="sessions-loading">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-destructive" data-testid="sessions-error">
          <ShieldAlert size={14} />
          <span>{t('sessions.error')}</span>
          <Button data-testid="sessions-retry" variant="ghost" size="sm" onClick={() => void load()}>
            {t('sessions.retry')}
          </Button>
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="sessions-empty">{t('sessions.empty')}</p>
      )}

      {!loading && !error && sessions.map((session) => {
        const kind = deviceKind(session.userAgent);
        const Icon = kind === 'mobile' ? Smartphone : kind === 'desktop' ? Monitor : Globe;
        return (
          <div
            key={session.familyId}
            data-testid="session-item"
            className="flex items-center justify-between gap-3 py-3 border-b border-border/50"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground shrink-0">
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold truncate" data-testid="session-device">
                  {describeDevice(session.userAgent, t)}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {session.ipAddress || '—'} · {t('sessions.last_used')}: {formatDate(session.lastUsedAt, language)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {session.current ? (
                <Badge data-testid="session-current" variant="outline" className="text-[10px] text-primary border-primary/20">
                  {t('sessions.current')}
                </Badge>
              ) : (
                <Button
                  data-testid="session-revoke"
                  variant="ghost"
                  size="sm"
                  disabled={busyFamily === session.familyId}
                  onClick={() => void revoke(session)}
                >
                  {busyFamily === session.familyId && <Loader2 size={14} className="mr-2 animate-spin" />}
                  {t('sessions.revoke')}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}