import { useEffect, useState } from "react";
import { History, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";

interface ActivityEntry {
  id: number;
  table_name: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export function ActivityList() {
  const { t } = useLanguage();
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    fetch("/api/profile/activity", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => { if (Array.isArray(data)) setItems(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const actionLabel = (action: string) =>
    action === "delete"
      ? t("profile.activity.delete")
      : action === "delete_bulk"
        ? t("profile.activity.delete_bulk")
        : t("profile.activity.update");

  const changedCount = (entry: ActivityEntry) =>
    entry.new_values ? Object.keys(entry.new_values).length : 0;

  return (
    <div className="bg-white rounded-2xl p-6 app-shadow border border-border/40">
      <div className="flex items-center gap-2 mb-5">
        <History size={18} className="text-primary" />
        <h4 className="font-black text-[11px] uppercase tracking-widest text-muted-foreground">{t("profile.activity.title")}</h4>
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <p data-testid="activity-empty" className="text-xs text-muted-foreground text-center py-8 font-medium">{t("profile.activity.empty")}</p>
      ) : (
        <div className="space-y-2">
          {items.map((entry) => (
            <div key={entry.id} data-testid="activity-item" className="flex items-start justify-between gap-3 rounded-xl border border-border/20 bg-muted/30 p-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{actionLabel(entry.action)}</p>
                {changedCount(entry) > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t("profile.activity.changed", { count: changedCount(entry) })}</p>
                )}
              </div>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                {new Date(entry.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
