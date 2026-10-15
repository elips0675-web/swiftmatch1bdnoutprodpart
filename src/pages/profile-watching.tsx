import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/context/language-context";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { getToken } from "@/lib/token";
import type { WatchedUser } from "@/lib/hangouts";
import { toast } from "sonner";
import { EyeOff, ArrowLeft, Loader2 } from "lucide-react";

export default function ProfileWatchingPage() {
  const { t } = useLanguage();
  const { userWatchesEnabled } = useFeatureFlags();
  const navigate = useNavigate();
  const [users, setUsers] = useState<WatchedUser[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) { navigate("/login"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/users/watching", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t("watching.error"));
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => { if (userWatchesEnabled) load(); }, [load, userWatchesEnabled]);

  const unwatch = async (id: number) => {
    const token = getToken();
    if (!token) return;
    try {
      const res = await fetch(`/api/users/${id}/watch`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("failed");
      setUsers((prev) => prev.filter((u) => u.id !== id));
      toast.success(t("watching.unwatched"));
    } catch {
      toast.error(t("user.watch.error"));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader />
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full -ml-2"
          data-testid="watching-back"
          onClick={() => navigate("/profile")}
        >
          <ArrowLeft size={16} className="mr-1" /> {t("hangout.action.back")}
        </Button>

        <div>
          <h1 className="text-lg font-black">{t("watching.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("watching.subtitle")}</p>
        </div>

        {!userWatchesEnabled ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">{t("hangout.disabled_desc")}</Card>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : users.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="watching-empty">
            {t("watching.empty")}
          </Card>
        ) : (
          <div className="space-y-2" data-testid="watching-list">
            {users.map((u) => (
              <Card key={u.id} className="p-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-sm font-bold">{(u.display_name || "?").slice(0, 1)}</span>
                  )}
                </div>
                <Link to={`/user?id=${u.id}`} className="font-semibold text-sm hover:underline truncate">
                  {u.display_name}
                </Link>
                <Button
                  data-testid={`unwatch-${u.id}`}
                  variant="outline"
                  size="sm"
                  className="ml-auto rounded-full shrink-0"
                  onClick={() => unwatch(u.id)}
                >
                  <EyeOff size={14} className="mr-1" /> {t("watching.unwatch")}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
