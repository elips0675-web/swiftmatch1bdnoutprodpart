import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { getToken } from "@/lib/token";
import { toast } from "sonner";

type WatchButtonProps = {
  userId: number;
  initialWatching?: boolean;
  onChange?: (watching: boolean) => void;
};

export function WatchButton({ userId, initialWatching = false, onChange }: WatchButtonProps) {
  const { t } = useLanguage();
  const { userWatchesEnabled } = useFeatureFlags();
  const [watching, setWatching] = useState(initialWatching);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!userWatchesEnabled) return;
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/users/watching", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setWatching(data.some((u: { id: number }) => Number(u.id) === userId));
        }
      } catch {
        /* начальное состояние — не критично */
      }
    })();
    return () => { cancelled = true; };
  }, [userId, userWatchesEnabled]);

  if (!userWatchesEnabled) return null;

  const toggle = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${userId}/watch`, {
        method: watching ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      const next = Boolean(data.watching);
      setWatching(next);
      onChange?.(next);
      toast.success(next ? t("user.watch.toast_subscribed") : t("user.watch.toast_unsubscribed"));
    } catch {
      toast.error(t("user.watch.error"));
    } finally {
      setBusy(false);
    }
  };

  const label = watching ? t("user.watch.following") : t("user.watch.follow");

  return (
    <Button
      data-testid="user-watch-button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={toggle}
      className="rounded-full bg-white/40 backdrop-blur-md border border-white/40 shadow-sm transition-all hover:bg-white/60"
    >
      {watching ? <EyeOff size={20} /> : <Eye size={20} />}
    </Button>
  );
}
