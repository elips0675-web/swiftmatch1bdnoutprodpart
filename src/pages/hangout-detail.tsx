import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { useWebSocket } from "@/hooks/use-websocket";
import { getToken } from "@/lib/token";
import { formatEventDate, type Hangout } from "@/lib/hangouts";
import { categoryIcon } from "./hangouts";
import { CalendarDays, MapPin, Users, Check, X, MessageCircle, ArrowLeft, Compass, Pencil, Heart, UserPlus, UserMinus, MessageSquareText, Navigation, Loader2 } from "lucide-react";
import { toast } from "sonner";

const RESPONSE_STATUS_KEYS: Record<string, string> = {
  pending: "hangout.response.pending",
  accepted: "hangout.response.accepted",
  declined: "hangout.response.declined",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-gray-100 text-gray-500",
};

export default function HangoutDetailPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [hangout, setHangout] = useState<Hangout | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [respondOpen, setRespondOpen] = useState(false);
  const [respondMessage, setRespondMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [purchasing, setPurchasing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) throw new Error("failed");
      const data: Hangout = await res.json();
      setHangout(data);
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

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

  const respond = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ message: respondMessage || undefined }),
      });
      if (res.status === 401) { navigate("/login"); return; }
      if (!res.ok) throw new Error("failed");
      setRespondOpen(false);
      setRespondMessage("");
      const data = await res.json().catch(() => ({}));
      toast.success(t("hangout.toast.response_sent"));
      // H3: после отклика открываем чат с организатором (до подтверждения)
      if (data?.chat_id) {
        navigate(`/chats/${data.chat_id}`);
      } else {
        load();
      }
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setSubmitting(false);
    }
  };

  const cancelResponse = async () => {
    if (!id) return;
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}/respond`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("failed");
      toast.info(t("hangout.toast.response_cancelled"));
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    }
  };

  const decideResponse = async (responseId: number, status: "accepted" | "declined") => {
    if (!id) return;
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}/responses/${responseId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(t(status === "accepted" ? "hangout.toast.accepted" : "hangout.toast.declined"));
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    }
  };

  const likeHangout = async () => {
    if (!id) return;
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.status === 401) { navigate("/login"); return; }
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      if (data.mutual) {
        toast.success(t("hangout.toast.mutual_like"));
      } else {
        toast.success(t("hangout.toast.liked"));
      }
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    }
  };

  const skipHangout = async () => {
    if (!id) return;
    try {
      const token = getToken();
      await fetch(`/api/hangouts/${id}/skip`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    }
  };

  const joinHangout = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (res.status === 401) { navigate("/login"); return; }
      if (!res.ok) throw new Error("failed");
      toast.success(t("hangout.toast.joined"));
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setSubmitting(false);
    }
  };

  const leaveHangout = async () => {
    if (!id) return;
    try {
      const token = getToken();
      await fetch(`/api/hangouts/${id}/join`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      toast.info(t("hangout.toast.left"));
      load();
    } catch {
      toast.error(t("hangout.error.load"));
    }
  };

  const checkIn = async () => {
    if (!id) return;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
      });
      const token = getToken();
      const res = await fetch(`/api/hangouts/${id}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.message || t("hangout.error.load"));
        return;
      }
      toast.success(t("hangout.toast.checked_in"));
      load();
    } catch {
      toast.error(t("hangout.error.checkin_failed"));
    }
  };

  const buyTicket = async () => {
    if (!id) return;
    setPurchasing(true);
    try {
      const token = getToken();
      if (!token) { navigate("/login"); return; }
      const res = await fetch(`/api/hangouts/${id}/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.message === "CAPACITY_FULL") toast.error(t("hangout.ticket.full"));
        else toast.error(err.message || t("hangout.error.load"));
        return;
      }
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.paid) {
        toast.success(t("hangout.ticket.purchased"));
        load();
      }
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setPurchasing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
        <AppHeader title={t("hangout.title")} />
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (notFound || !hangout) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
        <AppHeader title={t("hangout.title")} />
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <Compass size={48} className="mb-4 opacity-30" />
          <p>{t("hangout.empty")}</p>
          <Button variant="outline" className="mt-4 rounded-full" data-testid="hangout-detail-back" onClick={() => navigate("/hangouts")}>
            <ArrowLeft size={16} className="mr-2" /> {t("hangout.action.back")}
          </Button>
        </div>
      </div>
    );
  }

  const Icon = categoryIcon(hangout.category);
  const myStatus = hangout.my_response_status;
  const acceptedCount = hangout.accepted_count ?? 0;
  const isDate = hangout.hangout_type === 'date';
  const isCompany = hangout.hangout_type === 'company';
  const isPaid = Number(hangout.price) > 0;
  const hasTicket = hangout.my_ticket_status === 'paid';
  const needsTicket = isPaid && !hangout.is_author && !hasTicket;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader title={t("hangout.title")} />
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto space-y-4">
        <Button variant="ghost" size="sm" className="rounded-full -ml-2" data-testid="hangout-detail-back" onClick={() => navigate("/hangouts")}>
          <ArrowLeft size={16} className="mr-1" /> {t("hangout.action.back")}
        </Button>

        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0">
              {hangout.avatar_url ? (
                <img src={hangout.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <Icon size={22} className="text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm">{hangout.display_name}</p>
              <p className="text-xs text-muted-foreground">{t("hangout.label.author")}</p>
            </div>
            <div className="ml-auto flex gap-1.5">
              <Badge className="border-transparent bg-primary/10 text-primary font-bold">
                {t(`hangout.category.${hangout.category}`)}
              </Badge>
              <Badge className={cn("border-transparent font-bold", isDate ? "bg-pink-100 text-pink-700" : "bg-blue-100 text-blue-700")}>
                {isDate ? <Heart size={10} className="mr-0.5" /> : <UserPlus size={10} className="mr-0.5" />}
                {t(`hangout.type.${hangout.hangout_type}`)}
              </Badge>
            </div>
          </div>

          <h1 className="text-lg font-black mt-4 leading-snug">{hangout.title}</h1>
          {hangout.description && (
            <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{hangout.description}</p>
          )}

          <div className="mt-4 space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <CalendarDays size={15} className="text-primary shrink-0" />
              <span className="text-muted-foreground mr-1">{t("hangout.label.when")}:</span>
              {formatEventDate(hangout.event_date)}
            </p>
            {(hangout.place_name || hangout.place_address || hangout.city) && (
              <p className="flex items-center gap-2">
                <MapPin size={15} className="text-primary shrink-0" />
                <span className="text-muted-foreground mr-1">{t("hangout.label.where")}:</span>
                {[hangout.place_name, hangout.place_address, hangout.city].filter(Boolean).join(", ")}
              </p>
            )}
            {isDate ? (
              <p className="flex items-center gap-2">
                <Heart size={15} className="text-primary shrink-0" />
                <span className="text-muted-foreground mr-1">{t("hangout.label.likes")}:</span>
                {hangout.like_count ?? 0}
              </p>
            ) : (
              <p className="flex items-center gap-2">
                <Users size={15} className="text-primary shrink-0" />
                <span className="text-muted-foreground mr-1">{t("hangout.label.companions")}:</span>
                {hangout.participant_count ?? 0} / {hangout.max_companions}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <Badge
              className={
                hangout.status === "active"
                  ? "bg-green-100 text-green-800 border-transparent"
                  : hangout.status === "blocked"
                    ? "bg-red-100 text-red-800 border-transparent"
                    : "bg-gray-100 text-gray-600 border-transparent"
              }
            >
              {t(`hangout.status.${hangout.status}`)}
            </Badge>
            {typeof hangout.distance_km === "number" && (
              <span className="text-xs text-muted-foreground">{t("hangout.label.distance", { km: hangout.distance_km })}</span>
            )}
          </div>
        </Card>

        {needsTicket && (
          <Card className="p-4 border-primary/30">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-primary font-black text-sm">₽</span>
              </div>
              <div className="min-w-0">
                <p className="font-bold text-sm">{t("hangout.ticket.title")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("hangout.ticket.price", { price: Number(hangout.price) })}
                  {hangout.capacity ? ` · ${hangout.sold_tickets ?? 0}/${hangout.capacity}` : ""}
                </p>
              </div>
              <Button
                data-testid="buy-hangout-ticket"
                className="ml-auto rounded-full font-bold shrink-0"
                disabled={purchasing}
                onClick={buyTicket}
              >
                {purchasing && <Loader2 size={15} className="mr-1 animate-spin" />}
                {t("hangout.ticket.buy")}
              </Button>
            </div>
          </Card>
        )}
        {isPaid && hasTicket && (
          <Badge className="bg-green-100 text-green-800 border-transparent" data-testid="hangout-ticket-paid">
            ✓ {t("hangout.ticket.have")}
          </Badge>
        )}

        {hangout.is_author && hangout.status === "active" && (
          <Link to={`/hangouts/${hangout.id}/edit`}>
            <Button data-testid="edit-hangout" variant="outline" className="w-full rounded-full mt-3">
              <Pencil size={15} className="mr-2" /> {t("hangout.action.edit")}
            </Button>
          </Link>
        )}

        {/* ─── DATE TYPE: Like / Skip ─── */}
        {!hangout.is_author && isDate && (
          <Card className="p-4">
            {hangout.my_like_status === 'like' ? (
              <div className="space-y-3">
                <Badge className="bg-pink-100 text-pink-700 border-transparent">
                  <Heart size={12} className="mr-1" /> {t("hangout.label.you_liked")}
                </Badge>
                {hangout.chat_id && (
                  <Link to={`/chats/${hangout.chat_id}`}>
                    <Button variant="outline" className="w-full rounded-full" data-testid="open-chat">
                      <MessageCircle size={15} className="mr-2" /> {t("hangout.action.open_chat")}
                    </Button>
                  </Link>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-3">
                  <Button
                    data-testid="skip-hangout"
                    variant="outline"
                    className="flex-1 rounded-full font-bold"
                    disabled={hangout.status !== "active"}
                    onClick={() => { const token = getToken(); if (!token) { navigate("/login"); return; } skipHangout(); }}
                  >
                    <X size={16} className="mr-1" /> {t("hangout.action.skip")}
                  </Button>
                  <Button
                    data-testid="like-hangout"
                    className="flex-1 rounded-full font-bold bg-pink-500 hover:bg-pink-600"
                    disabled={hangout.status !== "active"}
                    onClick={() => { const token = getToken(); if (!token) { navigate("/login"); return; } likeHangout(); }}
                  >
                    <Heart size={16} className="mr-1" /> {t("hangout.action.like")}
                  </Button>
                </div>
                {!hangout.my_response_status && (
                  <Button
                    data-testid="respond-hangout"
                    variant="outline"
                    className="w-full rounded-full font-bold"
                    disabled={hangout.status !== "active"}
                    onClick={() => { const token = getToken(); if (!token) { navigate("/login"); return; } setRespondOpen(true); }}
                  >
                    <MessageSquareText size={15} className="mr-2" /> {t("hangout.action.respond")}
                  </Button>
                )}
                {hangout.my_response_status === "pending" && (
                  <p className="text-xs text-muted-foreground text-center pt-2" data-testid="response-pending-note">
                    {t("hangout.response.pending_note")}
                  </p>
                )}
                {hangout.my_response_status === "pending" && hangout.chat_id && (
                  <Link to={`/chats/${hangout.chat_id}`}>
                    <Button data-testid="message-organizer" className="w-full rounded-full font-bold mt-2">
                      <MessageCircle size={15} className="mr-2" /> {t("hangout.action.message_organizer")}
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </Card>
        )}

        {/* ─── DATE TYPE: Author manages responses ─── */}
        {hangout.is_author && isDate && (
          <Card className="p-4">
            <p className="font-bold text-sm mb-3">{t("hangout.label.responses")}</p>
            {!hangout.responses || hangout.responses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t("hangout.label.no_responses_yet")}</p>
            ) : (
              <div className="space-y-3">
                {hangout.responses.map((r) => (
                  <div key={r.id} className="flex items-start gap-3 p-3 rounded-xl border bg-background">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {r.avatar_url ? (
                        <img src={r.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold">{(r.display_name || "?").slice(0, 1)}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link to={`/profile/${r.user_id}`} className="text-sm font-semibold hover:underline truncate">
                          {r.display_name}
                        </Link>
                        <Badge className={`text-[10px] border-transparent ${STATUS_COLORS[r.status]}`}>
                          {t(RESPONSE_STATUS_KEYS[r.status] || "")}
                        </Badge>
                      </div>
                      {r.message && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.message}</p>}
                      {r.status === "pending" && (
                        <div className="flex gap-2 mt-2">
                          <Button
                            data-testid={`accept-response-${r.id}`}
                            size="sm"
                            className="rounded-full h-8 px-4"
                            onClick={() => decideResponse(r.id, "accepted")}
                          >
                            <Check size={14} className="mr-1" /> {t("hangout.action.accept")}
                          </Button>
                          <Button
                            data-testid={`decline-response-${r.id}`}
                            size="sm"
                            variant="outline"
                            className="rounded-full h-8 px-4"
                            onClick={() => decideResponse(r.id, "declined")}
                          >
                            <X size={14} className="mr-1" /> {t("hangout.action.decline")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hangout.chat_id && (
              <Link to={`/chats/${hangout.chat_id}`}>
                <Button variant="outline" className="w-full rounded-full mt-3">
                  <MessageCircle size={15} className="mr-2" /> {t("hangout.action.open_chat")}
                </Button>
              </Link>
            )}
          </Card>
        )}

        {/* ─── COMPANY TYPE: Join / Leave + Participants ─── */}
        {isCompany && (
          <Card className="p-4">
            <p className="font-bold text-sm mb-3">{t("hangout.label.participants")}</p>

            {hangout.participants && hangout.participants.length > 0 ? (
              <div className="space-y-2">
                {hangout.participants.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
                      {p.avatar_url ? (
                        <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs font-bold">{(p.display_name || "?").slice(0, 1)}</span>
                      )}
                    </div>
                    <Link to={`/profile/${p.user_id}`} className="text-sm font-semibold hover:underline">
                      {p.display_name}
                    </Link>
                    {p.role === 'organizer' && (
                      <Badge className="text-[10px] border-transparent bg-primary/10 text-primary ml-auto">{t("hangout.label.organizer")}</Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-4 text-center">{t("hangout.label.no_participants")}</p>
            )}

            <div className="mt-4 space-y-2">
              {!hangout.is_author && hangout.my_participant_status !== 'joined' && hangout.status === 'active' && (
                <Button
                  data-testid="join-hangout"
                  className="w-full rounded-full font-bold"
                  disabled={submitting}
                  onClick={() => { const token = getToken(); if (!token) { navigate("/login"); return; } joinHangout(); }}
                >
                  <UserPlus size={16} className="mr-2" /> {t("hangout.action.join")}
                </Button>
              )}
              {!hangout.is_author && hangout.my_participant_status === 'joined' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button
                      data-testid="checkin-hangout"
                      variant="outline"
                      className="flex-1 rounded-full"
                      onClick={checkIn}
                    >
                      <Navigation size={15} className="mr-1" /> {t("hangout.action.checkin")}
                    </Button>
                    <Button
                      data-testid="leave-hangout"
                      variant="outline"
                      className="flex-1 rounded-full text-destructive"
                      onClick={leaveHangout}
                    >
                      <UserMinus size={15} className="mr-1" /> {t("hangout.action.leave")}
                    </Button>
                  </div>
                  {hangout.chat_id && (
                    <Link to={`/chats/${hangout.chat_id}`}>
                      <Button variant="outline" className="w-full rounded-full">
                        <MessageCircle size={15} className="mr-2" /> {t("hangout.action.open_chat")}
                      </Button>
                    </Link>
                  )}
                </div>
              )}
              {hangout.is_author && hangout.chat_id && (
                <Link to={`/chats/${hangout.chat_id}`}>
                  <Button variant="outline" className="w-full rounded-full">
                    <MessageCircle size={15} className="mr-2" /> {t("hangout.action.open_chat")}
                  </Button>
                </Link>
              )}
            </div>
          </Card>
        )}
      </main>

      <Dialog open={respondOpen} onOpenChange={setRespondOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("hangout.detail.want_join")}</DialogTitle>
            <DialogDescription>{hangout.title}</DialogDescription>
          </DialogHeader>
          <Textarea
            data-testid="response-message"
            value={respondMessage}
            onChange={(e) => setRespondMessage(e.target.value)}
            placeholder={t("hangout.message_placeholder")}
            rows={3}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setRespondOpen(false)}>
              {t("hangout.action.cancel")}
            </Button>
            <Button data-testid="submit-response" className="rounded-full font-bold" disabled={submitting} onClick={respond}>
              {t("hangout.action.respond")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BottomNav />
    </div>
  );
}
