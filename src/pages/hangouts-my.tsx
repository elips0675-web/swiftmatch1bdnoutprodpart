import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/context/language-context";
import { useWebSocket } from "@/hooks/use-websocket";
import { usePremium } from "@/hooks/use-premium";
import { getToken } from "@/lib/token";
import { formatEventDate, type Hangout, type MyHangoutResponse } from "@/lib/hangouts";
import { categoryIcon } from "./hangouts";
import { CalendarDays, MapPin, Users, PlusCircle, MessageCircle, Trash2, Compass, Zap, Crown } from "lucide-react";
import { toast } from "sonner";

const RESPONSE_STATUS_KEYS: Record<string, string> = {
  pending: "hangout.response.pending",
  accepted: "hangout.response.accepted",
  declined: "hangout.response.declined",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-transparent",
  cancelled: "bg-gray-100 text-gray-500 border-transparent",
  completed: "bg-blue-100 text-blue-800 border-transparent",
  blocked: "bg-red-100 text-red-800 border-transparent",
};

function ListingRow({ hangout, onCancel, onBoost, boosingId }: { hangout: Hangout; onCancel: (id: number) => void; onBoost: (id: number) => void; boosingId: number | null }) {
  const { t } = useLanguage();
  const { isPremium } = usePremium();
  const Icon = categoryIcon(hangout.category);
  const isBoosted = Number(hangout.boosted) === 1;
  const busy = boosingId === hangout.id;

  return (
    <Card className="p-4" data-testid={`my-hangout-${hangout.id}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Icon size={18} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={STATUS_COLORS[hangout.status]}>{t(`hangout.status.${hangout.status}`)}</Badge>
            <span className="text-[11px] text-muted-foreground">{t(`hangout.category.${hangout.category}`)}</span>
          </div>
          <Link to={`/hangouts/${hangout.id}`} className="font-semibold text-sm mt-1 block hover:underline line-clamp-2">
            {hangout.title}
          </Link>
          <div className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5"><CalendarDays size={12} />{formatEventDate(hangout.event_date)}</p>
            {(hangout.place_name || hangout.city) && (
              <p className="flex items-center gap-1.5 truncate"><MapPin size={12} />{[hangout.place_name, hangout.city].filter(Boolean).join(", ")}</p>
            )}
            <p className="flex items-center gap-1.5">
              <Users size={12} />
              {t("hangout.label.companions_count", { count: hangout.accepted_count ?? 0, max: hangout.max_companions })}
            </p>
          </div>
          <div className="flex gap-2 mt-2.5 flex-wrap">
            <Link to={`/hangouts/${hangout.id}`}>
              <Button size="sm" variant="outline" className="rounded-full h-8 px-4">{t("hangout.action.details")}</Button>
            </Link>
            {hangout.chat_id && (
              <Link to={`/chats/${hangout.chat_id}`}>
                <Button size="sm" variant="outline" className="rounded-full h-8 px-4">
                  <MessageCircle size={13} className="mr-1" /> {t("hangout.action.open_chat")}
                </Button>
              </Link>
            )}
            {hangout.status === "active" && (
              <>
                {isBoosted ? (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`unboost-hangout-${hangout.id}`}
                    className="rounded-full h-8 px-4 text-violet-700 border-violet-200 bg-violet-50 hover:bg-violet-100"
                    onClick={() => onBoost(hangout.id)}
                    disabled={busy}
                  >
                    <Zap size={13} className="mr-1" /> {t("hangout.boost.promoted")}
                  </Button>
                ) : isPremium ? (
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`boost-hangout-${hangout.id}`}
                    className="rounded-full h-8 px-4 text-violet-700 border-violet-200 hover:bg-violet-50"
                    onClick={() => onBoost(hangout.id)}
                    disabled={busy}
                  >
                    <Zap size={13} className="mr-1" /> {t("hangout.boost.promote")}
                  </Button>
                ) : (
                  <Link to="/premium">
                    <Button size="sm" variant="outline" data-testid={`boost-upgrade-${hangout.id}`} className="rounded-full h-8 px-4">
                      <Crown size={13} className="mr-1 text-amber-500" /> {t("hangout.boost.promote")}
                    </Button>
                  </Link>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid={`cancel-hangout-${hangout.id}`}
                  className="rounded-full h-8 px-4 text-destructive hover:text-destructive"
                  onClick={() => onCancel(hangout.id)}
                >
                  <Trash2 size={13} className="mr-1" /> {t("hangout.action.cancel")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function HangoutsMyPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [listings, setListings] = useState<Hangout[]>([]);
  const [responses, setResponses] = useState<MyHangoutResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [boosingId, setBoosingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      if (!token) { navigate("/login"); return; }
      const headers = { Authorization: `Bearer ${token}` };
      const [lRes, rRes] = await Promise.all([
        fetch("/api/hangouts/my", { headers }),
        fetch("/api/hangouts/responses/my", { headers }),
      ]);
      const lData = lRes.ok ? await lRes.json() : [];
      const rData = rRes.ok ? await rRes.json() : [];
      setListings(Array.isArray(lData) ? lData : []);
      setResponses(Array.isArray(rData) ? rData : []);
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setLoading(false);
    }
  }, [navigate, t]);

  useEffect(() => { load(); }, [load]);

  const { socket } = useWebSocket();
  useEffect(() => {
    if (!socket) return;
    const refetch = () => { load(); };
    socket.on("hangout:new_response", refetch);
    socket.on("hangout:response_accepted", refetch);
    socket.on("hangout:cancelled", refetch);
    return () => {
      socket.off("hangout:new_response", refetch);
      socket.off("hangout:response_accepted", refetch);
      socket.off("hangout:cancelled", refetch);
    };
  }, [socket, load]);

  const cancelHangout = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${cancelTarget}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("failed");
      toast.info(t("hangout.toast.cancelled"));
      setCancelTarget(null);
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setCancelling(false);
    }
  };

  const toggleBoost = async (id: number) => {
    const target = listings.find((h) => h.id === id);
    const isBoosted = Number(target?.boosted) === 1;
    setBoosingId(id);
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}/${isBoosted ? "unboost" : "boost"}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 403 && data?.code === "PREMIUM_REQUIRED") {
          toast.error(t("hangout.boost.premium_required"));
        } else if (res.status === 409 && data?.code === "BOOST_LIMIT") {
          toast.error(t("hangout.boost.limit"));
        } else {
          toast.error(data?.message || t("hangout.error.load"));
        }
        return;
      }
      toast.success(isBoosted ? t("hangout.boost.toast.unboosted") : t("hangout.boost.toast.boosted"));
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setBoosingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader title={t("nav.hangouts")} />
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto space-y-4">
        <Button data-testid="create-hangout-my" onClick={() => navigate("/hangouts/create")} className="w-full rounded-full font-bold">
          <PlusCircle size={16} className="mr-2" /> {t("hangout.action.create")}
        </Button>

        <Tabs defaultValue="listings">
          <TabsList className="grid w-full grid-cols-2 rounded-xl">
            <TabsTrigger value="listings" className="rounded-lg font-bold text-xs" data-testid="tab-listings">
              {t("hangout.my_listings")}
            </TabsTrigger>
            <TabsTrigger value="responses" className="rounded-lg font-bold text-xs" data-testid="tab-responses">
              {t("hangout.my_responses")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="listings" className="mt-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-14">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : listings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Compass size={44} className="mb-3 opacity-30" />
                <p>{t("hangout.empty_my_listings")}</p>
              </div>
            ) : (
              listings.map((h) => (
                <ListingRow key={h.id} hangout={h} onCancel={(id) => setCancelTarget(id)} onBoost={(id) => toggleBoost(id)} boosingId={boosingId} />
              ))
            )}
          </TabsContent>

          <TabsContent value="responses" className="mt-4 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-14">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : responses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Compass size={44} className="mb-3 opacity-30" />
                <p>{t("hangout.empty_my_responses")}</p>
              </div>
            ) : (
              responses.map((r) => (
                <Card key={r.id} className="p-4" data-testid={`my-response-${r.id}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold">{(r.display_name || "?").slice(0, 1)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          className={
                            r.response_status === "accepted"
                              ? "bg-green-100 text-green-800 border-transparent"
                              : r.response_status === "declined"
                                ? "bg-gray-100 text-gray-500 border-transparent"
                                : "bg-yellow-100 text-yellow-800 border-transparent"
                          }
                        >
                          {t(RESPONSE_STATUS_KEYS[r.response_status] || "")}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{t(`hangout.category.${r.category}`)}</Badge>
                        {r.hangout_status !== "active" && (
                          <Badge variant="outline" className="text-[10px]">{t(`hangout.status.${r.hangout_status}`)}</Badge>
                        )}
                      </div>
                      <Link to={`/hangouts/${r.hangout_id}`} className="font-semibold text-sm mt-1 block hover:underline line-clamp-2">
                        {r.title}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <CalendarDays size={12} />{formatEventDate(r.event_date)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t("hangout.label.author")}: {r.display_name}</p>
                      {r.message && <p className="text-xs text-muted-foreground mt-1 bg-muted/40 p-2 rounded">{r.message}</p>}
                    </div>
                  </div>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={cancelTarget !== null} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("hangout.action.cancel")}</DialogTitle>
            <DialogDescription>{t("hangout.toast.cancelled")}?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setCancelTarget(null)}>
              {t("button.close")}
            </Button>
            <Button data-testid="confirm-cancel-hangout" variant="destructive" className="rounded-full" disabled={cancelling} onClick={cancelHangout}>
              {t("hangout.action.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
