import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { useLanguage } from "@/context/language-context";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { getToken } from "@/lib/token";
import { cn } from "@/lib/utils";

export type NotificationChannel = "inApp" | "push";
export type NotificationPrefs = Record<string, Record<string, boolean>>;

type Matrix = Record<string, boolean>;

type QuietSettings = { enabled: boolean; start: string; end: string; timezone: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

const FALLBACK_EVENTS: Array<{ key: string; channels: NotificationChannel[] }> = [
  { key: "like", channels: ["inApp", "push"] },
  { key: "invite", channels: ["inApp"] },
  { key: "hangout_response", channels: ["inApp", "push"] },
  { key: "hangout_accepted", channels: ["inApp", "push"] },
  { key: "hangout_declined", channels: ["inApp"] },
  { key: "hangout_cancelled", channels: ["inApp", "push"] },
  { key: "hangout_mutual_like", channels: ["inApp", "push"] },
  { key: "hangout_joined", channels: ["push"] },
  { key: "chat_message", channels: ["push"] },
];

function eventTitleKey(key: string) {
  return `notif.event.${key}`;
}

export function NotificationPreferencesSection() {
  const { t } = useLanguage();
  const { quietHoursEnabled } = useFeatureFlags();
  const [events, setEvents] = useState(FALLBACK_EVENTS);
  const [prefs, setPrefs] = useState<NotificationPrefs>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [quiet, setQuiet] = useState<QuietSettings>({
    enabled: false,
    start: "22:00",
    end: "08:00",
    timezone: BROWSER_TZ,
  });
  const [quietSaving, setQuietSaving] = useState(false);
  const savedQuietRef = useRef<QuietSettings>({
    enabled: false,
    start: "22:00",
    end: "08:00",
    timezone: BROWSER_TZ,
  });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/preferences", {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { prefs?: NotificationPrefs; events?: typeof FALLBACK_EVENTS }) => {
        if (cancelled) return;
        if (Array.isArray(data.events) && data.events.length > 0) setEvents(data.events);
        if (data.prefs) setPrefs(data.prefs);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setReady(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!quietHoursEnabled) return;
    let cancelled = false;
    fetch("/api/notifications/quiet-hours", {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { quiet?: QuietSettings }) => {
        if (cancelled || !data.quiet) return;
        const loaded: QuietSettings = {
          enabled: Boolean(data.quiet.enabled),
          start: data.quiet.start ?? "22:00",
          end: data.quiet.end ?? "08:00",
          timezone: data.quiet.timezone ?? BROWSER_TZ,
        };
        savedQuietRef.current = loaded;
        setQuiet(loaded);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [quietHoursEnabled]);

  const persist = useCallback(
    async (next: NotificationPrefs, key: string) => {
      setSavingKey(key);
      try {
        const res = await fetch("/api/notifications/preferences", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ prefs: next }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setPrefs(next);
        toast({ title: t('notif.saved') });
      } catch {
        toast({
          variant: "destructive",
          title: t('notif.save_failed'),
          description: t('notif.save_failed_desc'),
        });
      } finally {
        setSavingKey(null);
      }
    },
    [t]
  );

  const persistQuiet = useCallback(
    async (next: QuietSettings) => {
      if (!TIME_RE.test(next.start) || !TIME_RE.test(next.end)) {
        toast({ variant: "destructive", title: t("notif.quiet.invalid_time") });
        return;
      }
      const previous = savedQuietRef.current;
      setQuietSaving(true);
      try {
        const res = await fetch("/api/notifications/quiet-hours", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify({ quiet: next }),
        });
        if (!res.ok) throw new Error(String(res.status));
        savedQuietRef.current = next;
        setQuiet(next);
        toast({ title: t("notif.saved") });
      } catch {
        setQuiet(previous);
        toast({
          variant: "destructive",
          title: t("notif.save_failed"),
          description: t("notif.save_failed_desc"),
        });
      } finally {
        setQuietSaving(false);
      }
    },
    [t]
  );

  const commitQuietTime = () => {
    const next: QuietSettings = { ...quiet, timezone: BROWSER_TZ };
    const saved = savedQuietRef.current;
    if (next.enabled === saved.enabled && next.start === saved.start && next.end === saved.end) return;
    void persistQuiet(next);
  };

  const toggle = (event: string, channel: NotificationChannel, value: boolean) => {
    const next: NotificationPrefs = {
      ...prefs,
      [event]: { ...(prefs[event] ?? {}), [channel]: value },
    };
    void persist(next, `${event}.${channel}`);
  };

  const toggleColumn = (channel: NotificationChannel, value: boolean) => {
    const next: NotificationPrefs = { ...prefs };
    for (const event of events) {
      if (!event.channels.includes(channel)) continue;
      next[event.key] = { ...(next[event.key] ?? {}), [channel]: value };
    }
    void persist(next, `all.${channel}`);
  };

  const columnState = (channel: NotificationChannel): "on" | "off" | "mixed" => {
    const cells = events.filter((e) => e.channels.includes(channel));
    if (cells.length === 0) return "mixed";
    const values = cells.map((e) => prefs[e.key]?.[channel] !== false);
    if (values.every(Boolean)) return "on";
    if (values.every((v) => !v)) return "off";
    return "mixed";
  };

  if (!ready) {
    return (
      <div className="flex items-center gap-3 py-6 text-muted-foreground" data-testid="notif-prefs-loading">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">{t('notif.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="notif-prefs">
      <div className="flex items-center gap-3 py-3 border-b border-border/50">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
          <Bell size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold">{t('notif.title')}</p>
          <p className="text-xs text-muted-foreground">{t('notif.subtitle')}</p>
        </div>
      </div>

      <div className="hidden sm:grid grid-cols-[1fr_auto_auto] gap-4 py-2 border-b border-border/50">
        <span className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground">
          {t('notif.event_column')}
        </span>
        <span className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground w-16 text-center">
          {t('notif.channel_inapp')}
        </span>
        <span className="text-[10px] font-black uppercase tracking-[2px] text-muted-foreground w-16 text-center">
          {t('notif.channel_push')}
        </span>
      </div>

      {events.map((event) => (
        <div
          key={event.key}
          className="grid grid-cols-[1fr_auto_auto] gap-4 items-center py-3 border-b border-border/50"
        >
          <span className="text-sm truncate">{t(eventTitleKey(event.key))}</span>
          {event.channels.includes("inApp") ? (
            <div className="w-16 flex justify-center">
              <Switch
                data-testid={`notif-${event.key}-inApp`}
                checked={prefs[event.key]?.inApp !== false}
                disabled={savingKey !== null}
                onCheckedChange={(v) => toggle(event.key, "inApp", v)}
              />
            </div>
          ) : (
            <div className="w-16 flex justify-center">
              <span className="text-muted-foreground text-xs" aria-hidden>—</span>
            </div>
          )}
          {event.channels.includes("push") ? (
            <div className="w-16 flex justify-center">
              <Switch
                data-testid={`notif-${event.key}-push`}
                checked={prefs[event.key]?.push !== false}
                disabled={savingKey !== null}
                onCheckedChange={(v) => toggle(event.key, "push", v)}
              />
            </div>
          ) : (
            <div className="w-16 flex justify-center">
              <span className="text-muted-foreground text-xs" aria-hidden>—</span>
            </div>
          )}
        </div>
      ))}

      <div className="grid grid-cols-[1fr_auto_auto] gap-4 items-center py-3">
        <span className="text-sm font-bold">{t('notif.all')}</span>
        <div className="w-16 flex justify-center">
          <button
            type="button"
            data-testid="notif-all-inApp"
            disabled={savingKey !== null}
            onClick={() => toggleColumn("inApp", columnState("inApp") !== "on")}
            className={cn(
              "text-[10px] font-black uppercase tracking-wider",
              columnState("inApp") === "on" ? "text-primary" : "text-muted-foreground",
              savingKey !== null && "opacity-50"
            )}
          >
            {t('notif.all_on')}
          </button>
        </div>
        <div className="w-16 flex justify-center">
          <button
            type="button"
            data-testid="notif-all-push"
            disabled={savingKey !== null}
            onClick={() => toggleColumn("push", columnState("push") !== "on")}
            className={cn(
              "text-[10px] font-black uppercase tracking-wider",
              columnState("push") === "on" ? "text-primary" : "text-muted-foreground",
              savingKey !== null && "opacity-50"
            )}
          >
            {t('notif.all_on')}
          </button>
        </div>
      </div>

      {quietHoursEnabled && (
        <div className="mt-2 pt-2 border-t border-border/50" data-testid="quiet-hours">
          <div className="py-3">
            <p className="text-sm font-bold">{t("notif.quiet.title")}</p>
            <p className="text-xs text-muted-foreground">{t("notif.quiet.desc")}</p>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-border/50">
            <span className="text-sm">{t("notif.quiet.enable")}</span>
            <Switch
              data-testid="quiet-enabled"
              checked={quiet.enabled}
              disabled={quietSaving}
              onCheckedChange={(v) => void persistQuiet({ ...quiet, enabled: v, timezone: BROWSER_TZ })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 py-3">
            <label className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("notif.quiet.from")}</span>
              <input
                type="time"
                data-testid="quiet-start"
                value={quiet.start}
                disabled={quietSaving}
                onChange={(e) => setQuiet({ ...quiet, start: e.target.value })}
                onBlur={commitQuietTime}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("notif.quiet.until")}</span>
              <input
                type="time"
                data-testid="quiet-end"
                value={quiet.end}
                disabled={quietSaving}
                onChange={(e) => setQuiet({ ...quiet, end: e.target.value })}
                onBlur={commitQuietTime}
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              />
            </label>
            <span className="text-xs text-muted-foreground">
              {t("notif.quiet.timezone")}: {BROWSER_TZ}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export type { Matrix };
