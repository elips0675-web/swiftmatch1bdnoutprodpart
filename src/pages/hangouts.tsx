import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/context/language-context";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { usePremium } from "@/hooks/use-premium";
import { useWebSocket } from "@/hooks/use-websocket";
import { getToken } from "@/lib/token";
import { useToast } from "@/components/ui/use-toast";
import { HangoutSkeletonCard } from "@/components/hangout-skeleton-card";
import { HANGOUT_CATEGORIES, formatEventDate, type Hangout, type HangoutType } from "@/lib/hangouts";
import { Clapperboard, Theater, Palette, Coffee, Music, Dumbbell, Sparkles, CalendarDays, MapPin, Users, PlusCircle, Compass, Heart, UserPlus, Search, X, Ticket, Zap, Utensils, BedDouble, Flower2, Car, Gift, ShoppingBag, HandCoins, Share, Star, Loader2, ChevronDown, Navigation } from "lucide-react";
import { cn } from "@/lib/utils";

export const categoryIcon = (category: string) => {
  const map: Record<string, React.ElementType> = {
    cinema: Clapperboard,
    theater: Theater,
    exhibition: Palette,
    cafe: Coffee,
    concert: Music,
    sport: Dumbbell,
    other: Sparkles,
  };
  return map[category] || Sparkles;
};

const CATEGORY_COLORS: Record<string, string> = {
  cinema: "bg-purple-100 text-purple-700",
  theater: "bg-rose-100 text-rose-700",
  exhibition: "bg-amber-100 text-amber-700",
  cafe: "bg-orange-100 text-orange-700",
  concert: "bg-indigo-100 text-indigo-700",
  sport: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-600",
};

type GoOutOffer = {
  id: number;
  category: string;
  title: string;
  description?: string;
  deeplink: string;
  price?: number | null;
  city?: string | null;
  partner_name?: string;
  commission_rate?: number | null;
};

const GO_OUT_ICONS: Record<string, React.ElementType> = {
  restaurant: Utensils,
  cafe: Utensils,
  hotel: BedDouble,
  flowers: Flower2,
  taxi: Car,
  gift: ShoppingBag,
};

const GO_OUT_COLORS: Record<string, string> = {
  restaurant: "bg-orange-100 text-orange-700",
  cafe: "bg-orange-100 text-orange-700",
  hotel: "bg-indigo-100 text-indigo-700",
  flowers: "bg-pink-100 text-pink-700",
  taxi: "bg-sky-100 text-sky-700",
  gift: "bg-amber-100 text-amber-700",
};

export type HangoutDateFilter = "all" | "today" | "tomorrow" | "weekend";

export type HangoutSort = "date" | "popularity" | "price";

export type HangoutPriceFilter = "all" | "free" | "paid";

export const PRICE_RANGE_PRESETS: Array<{ key: string; max: number | null }> = [
  { key: "all", max: null },
  { key: "u500", max: 500 },
  { key: "u1500", max: 1500 },
  { key: "u5000", max: 5000 },
];

function hangoutDateKey(value: string): string {
  const d = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return d.toISOString().slice(0, 10);
}

function hangoutGroupLabel(key: string, t: (k: string) => string): string {
  if (key === "today") return t("hangout.group.today");
  if (key === "tomorrow") return t("hangout.group.tomorrow");
  const d = new Date(key);
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function groupHangoutsByDate(hangouts: Hangout[]): Array<[string, Hangout[]]> {
  const map = new Map<string, Hangout[]>();
  for (const h of hangouts) {
    const key = hangoutDateKey(h.event_date);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(h);
  }
  return Array.from(map.entries()).sort((a, b) => {
    const w = { today: 0, tomorrow: 1 } as Record<string, number>;
    const va = w[a[0]] !== undefined ? w[a[0]] : 2;
    const vb = w[b[0]] !== undefined ? w[b[0]] : 2;
    if (va !== vb) return va - vb;
    return a[0].localeCompare(b[0]);
  });
}

const PAGE_LIMIT = 20;

function dateRange(filter: HangoutDateFilter): { from?: string; to?: string } {
  if (filter === "all") return {};
  const now = new Date();
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  if (filter === "today") {
    return { from: now.toISOString(), to: endOfDay(now).toISOString() };
  }
  if (filter === "tomorrow") {
    const tmr = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return { from: tmr.toISOString(), to: endOfDay(tmr).toISOString() };
  }
  // Ближайшие выходные: суббота и воскресенье (включая текущие)
  const day = now.getDay();
  const daysToSat = day === 0 ? -1 : (6 - day) % 7;
  const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysToSat);
  return { from: sat.toISOString(), to: endOfDay(new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1)).toISOString() };
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatHumanDate(value: string, t: (key: string) => string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isSameDay(d, now)) return `${t("hangout.filter.today")} ${time}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return `${t("hangout.filter.tomorrow")} ${time}`;
  return formatEventDate(value);
}

function HangoutCard({ hangout }: { hangout: Hangout }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [buying, setBuying] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const Icon = categoryIcon(hangout.category);
  const isDate = hangout.hangout_type === 'date';

  const navigateProfile = (h: Hangout) => {
    if (h.author_id) navigate(`/profile/${h.author_id}`);
  };

  const doAction = async (kind: "respond" | "join" | "like") => {
    if (actionLoading) return;
    setActionLoading(true);
    const token = getToken();
    try {
      const res = await fetch(`/api/hangouts/${hangout.id}/${kind}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok || res.status === 201) {
        const msg =
          kind === "like"
            ? t("hangout.action.liked")
            : kind === "respond"
              ? t("hangout.action.responded")
              : t("hangout.action.joined");
        toast({ title: msg });
      } else if (res.status === 409) {
        toast({ title: t("hangout.action.already"), variant: "destructive" });
      } else if (res.status === 402) {
        toast({ title: t("hangout.action.payment_required"), variant: "destructive" });
      } else if (res.status === 401) {
        toast({ title: t("hangout.action.auth_required"), variant: "destructive" });
      } else {
        toast({ title: data?.error || t("hangout.action.error"), variant: "destructive" });
      }
    } catch {
      toast({ title: t("hangout.action.error"), variant: "destructive" });
    } finally {
      setActionLoading(false);
    }
  };

  const shareHangout = async () => {
    const url = `${location.origin}/hangouts/${hangout.id}`;
    const title = hangout.title;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t("hangout.action.link_copied") });
      }
    } catch {
      /* пользователь отменил нативный share */
    }
  };

  const buyTicket = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!hangout.offer_id || buying) return;
    const token = getToken();
    setBuying(true);
    try {
      const res = await fetch("/api/partners/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ offer_id: hangout.offer_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setBuying(false);
      }
    } catch {
      setBuying(false);
    }
  };

  const replyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    doAction(hangout.hangout_type === 'date' ? "respond" : "join");
  };

  const likeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    doAction("like");
  };

  const isFull = typeof hangout.capacity === "number" && (hangout.sold_tickets ?? 0) >= hangout.capacity;
  const remaining = Number(hangout.capacity ?? 0) - Number(hangout.sold_tickets ?? 0);
  const showScarcity = typeof hangout.capacity === "number" && Number(hangout.capacity) > 0;
  const showRating = Number(hangout.rating) > 0;
  const isAuthorCard = Boolean(hangout.is_author) || hangout.my_participant_status === "joined" || hangout.my_response_status === "accepted";
  const [showMap, setShowMap] = useState(false);

  const lat = Number(hangout.lat);
  const lng = Number(hangout.lng);
  const hasCoords = !isNaN(lat) && !isNaN(lng) && hangout.lat != null && hangout.lng != null;
  const placeLabel = [hangout.place_name, hangout.place_address, hangout.city].filter(Boolean).join(", ") || hangout.title;

  const mapEmbedSrc = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.004}%2C${lat - 0.004}%2C${lng + 0.004}%2C${lat + 0.004}&layer=mapnik&marker=${lat}%2C${lng}`
    : `https://www.openstreetmap.org/export/embed.html?bbox=&layer=mapnik&q=${encodeURIComponent(placeLabel)}`;

  const openRoute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dest = hasCoords ? `${lat},${lng}` : encodeURIComponent(placeLabel);
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${dest}`, "_blank", "noopener");
  };

  const openMap = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMap(true);
  };

  return (
    <Link to={`/hangouts/${hangout.id}`} className="block">
      <Card data-testid={`hangout-card-${hangout.id}`} className="p-4 hover:bg-muted/30 transition-colors">
        {Number(hangout.boosted) === 1 && (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-violet-50 border border-violet-200 px-2 py-1 w-fit" data-testid={`hangout-boosted-${hangout.id}`}>
            <Zap size={12} className="text-violet-600" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-violet-700">{t("hangout.boosted")}</span>
          </div>
        )}
        {Number(hangout.offer_pinned) === 1 && (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-2 py-1 w-fit" data-testid={`hangout-sponsored-${hangout.id}`}>
            <Sparkles size={12} className="text-amber-600" />
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{t("hangout.sponsored")}</span>
          </div>
        )}
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden cursor-pointer"
            role="link"
            aria-label={hangout.display_name}
            data-testid={`hangout-author-${hangout.author_id}`}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigateProfile(hangout); }}
          >
            {hangout.avatar_url ? (
              <img src={hangout.avatar_url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
            ) : (
              <Icon size={20} className="text-primary" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn("text-[10px] font-bold border-transparent", CATEGORY_COLORS[hangout.category])}>
                {t(`hangout.category.${hangout.category}`)}
              </Badge>
              <Badge className={cn("text-[10px] font-bold border-transparent", isDate ? "bg-pink-100 text-pink-700" : "bg-blue-100 text-blue-700")}>
                {isDate ? <Heart size={10} className="mr-0.5" /> : <UserPlus size={10} className="mr-0.5" />}
                {t(`hangout.type.${hangout.hangout_type}`)}
              </Badge>
              <span
                className="text-[11px] text-muted-foreground truncate flex items-center gap-1 hover:text-primary hover:underline cursor-pointer"
                role="link"
                aria-label={hangout.display_name}
                data-testid={`hangout-author-name-${hangout.author_id}`}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigateProfile(hangout); }}
              >
                {hangout.display_name}
                {typeof hangout.age === "number" && <span>· {hangout.age}</span>}
                {Boolean(hangout.online) && (
                  <span title={t("chats.online")} className="inline-block w-2 h-2 rounded-full bg-[#2ecc71] shrink-0" />
                )}
              </span>
            </div>
            <p className="font-semibold text-sm mt-1.5 leading-snug line-clamp-2">{hangout.title}</p>
            {hangout.description && (
              <p className="text-xs text-muted-foreground mt-1 leading-snug line-clamp-2">{hangout.description}</p>
            )}
            {hangout.price && Number(hangout.price) > 0 && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-2.5 py-1.5">
                <span className="text-xs font-bold text-primary flex items-center gap-1">
                  <Ticket size={13} className="text-primary" />
                  {t("hangout.ticket.price", { price: Number(hangout.price) })}
                </span>
                {typeof hangout.capacity === "number" && (
                  <span className="ml-auto text-[10px] font-semibold text-muted-foreground">
                    {hangout.sold_tickets ?? 0}/{hangout.capacity}
                  </span>
                )}
              </div>
            )}
            {hangout.offer_id && hangout.offer_price ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg bg-primary/5 border border-primary/20 px-2.5 py-1.5">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <Ticket size={13} className="text-primary" />
                  {t("hangout.offer.buy_ticket", { price: String(hangout.offer_price) })}
                </span>
                <button
                  type="button"
                  data-testid={`hangout-offer-buy-${hangout.id}`}
                  onClick={buyTicket}
                  disabled={buying}
                  className="shrink-0 text-xs font-bold rounded-full bg-primary text-primary-foreground px-2.5 py-1 hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {buying ? t("hangout.offer.buying") : t("hangout.offer.buy")}
                </button>
              </div>
            ) : hangout.offer_id && hangout.offer_title && (
              <p className="mt-2 text-xs font-semibold text-primary">
                <Ticket size={12} className="inline mr-1 -mt-0.5" />
                {hangout.offer_title}
              </p>
            )}
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <CalendarDays size={12} />
                {formatHumanDate(hangout.event_date, t)}
              </p>
              {(hangout.place_name || hangout.city) && (
                <p className="flex items-center gap-1.5 truncate">
                  <MapPin size={12} />
                  {[hangout.place_name, hangout.city].filter(Boolean).join(", ")}
                </p>
              )}
              <p className="flex items-center gap-1.5">
                {isDate ? <Heart size={12} /> : <Users size={12} />}
                {isDate
                  ? t("hangout.label.likes_count", { count: hangout.like_count ?? 0 })
                  : t("hangout.label.participants_count", { count: hangout.participant_count ?? 0, max: hangout.max_companions })
                }
                {typeof hangout.distance_km === "number" && (
                  <span className="ml-1">· {t("hangout.label.distance", { km: hangout.distance_km })}</span>
                )}
              </p>
              {(showRating || showScarcity) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {showRating && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600" data-testid={`hangout-rating-${hangout.id}`}>
                      <Star size={11} className="fill-amber-400 text-amber-400" />
                      {Number(hangout.rating).toFixed(1)}
                    </span>
                  )}
                  {showScarcity && (
                    <span
                      data-testid={`hangout-remaining-${hangout.id}`}
                      className={cn(
                        "inline-flex items-center gap-1 text-[11px] font-bold",
                        isFull ? "text-red-600" : remaining <= 3 ? "text-orange-600" : "text-muted-foreground",
                      )}
                    >
                      {isFull
                        ? t("hangout.label.sold_out")
                        : t("hangout.label.remaining", { count: remaining })}
                    </span>
                  )}
                </div>
              )}
              {hangout.attendees && hangout.attendees.length > 0 && (
                <div className="flex items-center -space-x-2 mt-1" data-testid={`hangout-attendees-${hangout.id}`}>
                  {hangout.attendees.slice(0, 3).map((a) => (
                    a.avatar_url ? (
                      <img
                        key={a.user_id}
                        src={a.avatar_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-6 w-6 rounded-full border-2 border-background object-cover"
                      />
                    ) : (
                      <span key={a.user_id} className="h-6 w-6 rounded-full border-2 border-background bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary">
                        {a.display_name?.slice(0, 1) || "?"}
                      </span>
                    )
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            data-testid={`hangout-share-${hangout.id}`}
            onClick={shareHangout}
            aria-label={t("hangout.action.share")}
            className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <Share size={14} />
          </button>
        </div>
        <div className="mt-3 flex gap-2 flex-wrap">
          {!isAuthorCard && (
            <button
              type="button"
              data-testid={`hangout-${hangout.hangout_type === 'date' ? 'respond' : 'join'}-${hangout.id}`}
              onClick={replyClick}
              disabled={actionLoading || isFull}
              aria-label={isDate ? t("hangout.action.respond") : t("hangout.action.join")}
              className="flex-1 shrink-0 text-xs font-bold rounded-full bg-primary text-primary-foreground px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {actionLoading ? (
                <Loader2 size={12} className="inline animate-spin mr-1" />
              ) : (
                <>{isDate ? <Heart size={12} className="inline mr-1" /> : <UserPlus size={12} className="inline mr-1" />}</>
              )}
              {isFull ? t("hangout.action.attend_full") : isDate ? t("hangout.action.respond") : t("hangout.action.join")}
            </button>
          )}
          <button
            type="button"
            data-testid={`hangout-quicklike-${hangout.id}`}
            onClick={likeClick}
            disabled={actionLoading}
            aria-label={t("hangout.action.like")}
            className={cn(
              "shrink-0 text-xs font-bold rounded-full px-3 py-1.5 border transition-colors disabled:opacity-50",
              hangout.my_like_status === "like"
                ? "bg-pink-100 text-pink-700 border-pink-200"
                : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
            )}
          >
            <Heart size={12} className={cn("inline mr-1", hangout.my_like_status === "like" && "fill-pink-500 text-pink-500")} />
            {t("hangout.action.like")}
          </button>
        </div>
        {(hasCoords || hangout.place_name || hangout.city) && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              data-testid={`hangout-route-${hangout.id}`}
              onClick={openRoute}
              aria-label={t("hangout.map.route")}
              className="flex-1 shrink-0 text-xs font-semibold rounded-full border border-muted bg-background text-muted-foreground px-3 py-1.5 hover:bg-muted/40 transition-colors inline-flex items-center justify-center gap-1"
            >
              <Navigation size={12} />
              {t("hangout.map.route")}
            </button>
            <button
              type="button"
              data-testid={`hangout-map-${hangout.id}`}
              onClick={openMap}
              aria-label={t("hangout.map.view")}
              className="flex-1 shrink-0 text-xs font-semibold rounded-full border border-muted bg-background text-muted-foreground px-3 py-1.5 hover:bg-muted/40 transition-colors inline-flex items-center justify-center gap-1"
            >
              <MapPin size={12} />
              {t("hangout.map.view")}
            </button>
          </div>
        )}
        <Dialog open={showMap} onOpenChange={setShowMap}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-base">
                <MapPin size={14} className="inline mr-1 -mt-0.5 text-primary" />
                {placeLabel}
              </DialogTitle>
            </DialogHeader>
            <div className="overflow-hidden rounded-xl border border-muted aspect-[4/3] bg-muted/30">
              <iframe
                title={placeLabel}
                src={mapEmbedSrc}
                loading="lazy"
                className="h-full w-full border-0"
              />
            </div>
            <div className="flex justify-center">
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid={`hangout-route-modal-${hangout.id}`}
                onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${hasCoords ? `${lat},${lng}` : encodeURIComponent(placeLabel)}`, "_blank", "noopener")}
                className="rounded-full"
              >
                <Navigation size={12} className="mr-1" />
                {t("hangout.map.route")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </Card>
    </Link>
  );
}

export default function HangoutsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hangoutsEnabled } = useFeatureFlags();
  const [items, setItems] = useState<Hangout[]>([]);
  const [loading, setLoading] = useState(true);
  const [hangoutType, setHangoutType] = useState<HangoutType | "all">("all");
  const [category, setCategory] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<HangoutDateFilter>("all");
  const [sortBy, setSortBy] = useState<HangoutSort>("date");
  const [priceFilter, setPriceFilter] = useState<HangoutPriceFilter>("all");
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"pending" | "ok" | "denied">("pending");
  const [geoAsked, setGeoAsked] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [goOutOffers, setGoOutOffers] = useState<GoOutOffer[] | null>(null);
  const { isPremium } = usePremium();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestIdeas, setSuggestIdeas] = useState<Array<{ title: string; category: string; place?: string; description?: string }>>([]);
  const [suggestLang, setSuggestLang] = useState<"ru" | "en">("ru");
  const [suggestError, setSuggestError] = useState(false);
  const [pendingNew, setPendingNew] = useState<Array<{ hangoutId: number; title: string }>>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const pageToast = useToast();
  const pageSocket = useWebSocket();

  // Реал-тайм: новые встречи в ленте (этап 98) — join комнаты ленты + подписка на hangout:new
  useEffect(() => {
    const socket = pageSocket.socket;
    if (!socket || !hangoutsEnabled) return;
    socket.emit("hangout:join_feed");
    const onNew = (payload: { hangoutId?: number; title?: string }) => {
      const hid = Number(payload?.hangoutId);
      if (!hid) return;
      setPendingNew((prev) => {
        if (prev.some((n) => n.hangoutId === hid)) return prev;
        if (prev.length === 0) {
          pageToast.toast({
            title: t("hangout.new.title"),
            description: payload?.title || t("hangout.new.desc"),
          });
        }
        return [{ hangoutId: hid, title: payload?.title || "" }, ...prev];
      });
    };
    socket.on("hangout:new", onNew);
    return () => {
      socket.off("hangout:new", onNew);
      socket.emit("hangout:leave_feed");
    };
  }, [pageSocket.socket, hangoutsEnabled, t, pageToast]);

  const refreshFeed = useCallback(() => {
    setPendingNew([]);
    setPage(1);
    setRefreshKey((k) => k + 1);
  }, [setPage]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  const askGeo = () => {
    if (!navigator.geolocation) { setGeoStatus("denied"); return; }
    setGeoStatus("pending");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGeoStatus("ok"); },
      () => { setGeoStatus("denied"); setCoords(null); },
      { timeout: 5000 },
    );
  };

  useEffect(() => {
    if (!geoAsked && navigator.geolocation) {
      setGeoAsked(true);
      askGeo();
    }
  }, [geoAsked]);

  // Чтение фильтров из URL при монтировании (делиться ссылкой / не терять при перезагрузке)
  useEffect(() => {
    const q = searchParams.get("q");
    const cat = searchParams.get("category");
    const date = searchParams.get("date") as HangoutDateFilter | null;
    const type = searchParams.get("type") as HangoutType | "all" | null;
    const sort = searchParams.get("sort") as HangoutSort | null;
    const price = searchParams.get("price") as HangoutPriceFilter | null;
    const maxPriceRaw = searchParams.get("max_price");
    if (q != null) setSearch(q);
    if (cat != null) setCategory(cat);
    if (date && ["all", "today", "tomorrow", "weekend"].includes(date)) setDateFilter(date);
    if (type && ["all", "date", "company"].includes(type)) setHangoutType(type);
    if (sort && ["date", "popularity", "price"].includes(sort)) setSortBy(sort);
    if (price && ["all", "free", "paid"].includes(price)) setPriceFilter(price);
    if (maxPriceRaw != null) {
      const mp = Number(maxPriceRaw);
      if (!isNaN(mp) && mp > 0) setPriceMax(mp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Запись фильтров в URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    if (category) params.set("category", category);
    if (dateFilter !== "all") params.set("date", dateFilter);
    if (hangoutType !== "all") params.set("type", hangoutType);
    if (sortBy !== "date") params.set("sort", sortBy);
    if (priceFilter !== "all") params.set("price", priceFilter);
    if (priceFilter === "paid" && priceMax != null) params.set("max_price", String(priceMax));
    setSearchParams(params, { replace: true });
  }, [debouncedSearch, category, dateFilter, hangoutType, sortBy, priceFilter, priceMax, setSearchParams]);

  useEffect(() => {
    if (!hangoutsEnabled) return;
    let cancelled = false;
    const token = getToken();
    fetch("/api/affiliate/offers?limit=4", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled) setGoOutOffers((data?.offers as GoOutOffer[]) || []); })
      .catch(() => { if (!cancelled) setGoOutOffers([]); });
    return () => { cancelled = true; };
  }, [hangoutsEnabled]);

  useEffect(() => {
    if (!hangoutsEnabled) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set("q", debouncedSearch.trim());
    if (category) params.set("category", category);
    if (hangoutType !== "all") params.set("type", hangoutType);
    const range = dateRange(dateFilter);
    if (range.from) params.set("date_from", range.from);
    if (range.to) params.set("date_to", range.to);
    if (sortBy !== "date") params.set("sort", sortBy);
    if (priceFilter !== "all") params.set("price", priceFilter);
    if (priceFilter === "paid" && priceMax != null) params.set("max_price", String(priceMax));
    params.set("page", String(page));
    params.set("limit", String(PAGE_LIMIT));
    if (coords) {
      params.set("lat", String(coords.lat));
      params.set("lng", String(coords.lng));
      params.set("radius", String(radiusKm));
    }
    const token = getToken();
    fetch(`/api/hangouts?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        setItems((prev) => {
          const combined = page > 1 ? [...prev, ...arr] : arr;
          if (sortBy === "popularity" || sortBy === "price") {
            combined.sort((a, b) => {
              if (sortBy === "popularity") {
                const pa = Number(a.participant_count ?? 0) + Number(a.like_count ?? 0) + Number(a.accepted_count ?? 0);
                const pb = Number(b.participant_count ?? 0) + Number(b.like_count ?? 0) + Number(b.accepted_count ?? 0);
                return pb - pa;
              }
              const va = Number(a.price ?? 0);
              const vb = Number(b.price ?? 0);
              return va - vb;
            });
          }
          return combined;
        });
        setHasMore(arr.length >= PAGE_LIMIT);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, hangoutType, dateFilter, page, coords, radiusKm, hangoutsEnabled, debouncedSearch, sortBy, refreshKey, priceFilter, priceMax]);

  // Бесконечный скролл: авто-подгрузка следующей страницы при достижении sentinel
  useEffect(() => {
    if (!hangoutsEnabled || !hasMore || loading || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "250px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hangoutsEnabled, hasMore, loading, page, setPage]);

  const chips = useMemo(
    () => [{ key: null, label: t("hangout.filter.all_categories") }, ...HANGOUT_CATEGORIES.map((c) => ({ key: c as string, label: t(`hangout.category.${c}`) }))],
    [t],
  );

  const loadSuggest = async () => {
    if (!isPremium) return;
    setSuggestLoading(true);
    setSuggestError(false);
    try {
      const token = getToken();
      const res = await fetch("/api/hangouts/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ language: suggestLang }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.suggestions)) {
        setSuggestIdeas(data.suggestions);
      } else if (res.status === 403) {
        setSuggestError(true);
      } else {
        setSuggestError(true);
      }
    } catch {
      setSuggestError(true);
    } finally {
      setSuggestLoading(false);
    }
  };

  const handleSuggest = () => {
    if (!isPremium) return;
    setSuggestOpen(true);
    if (suggestIdeas.length === 0 && !suggestLoading && !suggestError) loadSuggest();
  };

  const changeSuggestLang = (lang: "ru" | "en") => {
    setSuggestLang(lang);
    if (suggestOpen) setSuggestIdeas([]);
  };


  const dateChips = useMemo(
    () => [
      { key: "all" as HangoutDateFilter, label: t("hangout.filter.all_dates") },
      { key: "today" as HangoutDateFilter, label: t("hangout.filter.today") },
      { key: "tomorrow" as HangoutDateFilter, label: t("hangout.filter.tomorrow") },
      { key: "weekend" as HangoutDateFilter, label: t("hangout.filter.weekend") },
    ],
    [t],
  );

  const applyCategory = (key: string | null) => {
    setPage(1);
    setCategory(key);
  };

  const applyDateFilter = (key: HangoutDateFilter) => {
    setPage(1);
    setDateFilter(key);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader title={t("hangout.title")} />
      <main className="px-4 pb-24 pt-3 max-w-2xl mx-auto space-y-3">
        {!hangoutsEnabled ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" data-testid="hangouts-disabled">
            <Compass size={48} className="mb-4 opacity-30" />
            <p className="font-semibold">{t("hangout.disabled")}</p>
            <p className="text-sm mt-1">{t("hangout.disabled_desc")}</p>
          </div>
        ) : (
          <>
            <Button
              data-testid="create-hangout"
              onClick={() => navigate("/hangouts/create")}
              className="w-full rounded-full font-bold"
            >
              <PlusCircle size={18} className="mr-2" />
              {t("hangout.action.create")}
            </Button>

            <Link
              to="/hangouts/my"
              data-testid="hangout-my-link"
              className="block text-center text-sm font-semibold text-primary hover:underline py-0.5"
            >
              {t("hangout.my_listings")} →
            </Link>

            <Link
              to="/events"
              data-testid="events-link"
              className="flex items-center justify-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-bold text-primary hover:bg-primary/10 transition-colors"
            >
              <Sparkles size={16} />
              {t("events.from_hangouts")}
            </Link>

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="hangout-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("hangout.filter.search")}
                className="pl-9 pr-9 rounded-full h-9"
                aria-label={t("hangout.filter.search")}
              />
              {search && (
                <button
                  type="button"
                  data-testid="hangout-search-clear"
                  onClick={() => setSearch("")}
                  aria-label={t("hangout.filter.clear_search")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground rounded-full p-0.5"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" data-testid="hangout-type-chips">
              {(["all", "date", "company"] as const).map((typ) => (
                <button
                  key={typ}
                  type="button"
                  aria-pressed={hangoutType === typ}
                  data-testid={`hangout-type-${typ}`}
                  onClick={() => { setPage(1); setHangoutType(typ); }}
                  className={cn(
                    "shrink-0 px-3 py-1 rounded-full text-xs font-bold border transition-colors",
                    hangoutType === typ
                      ? "gradient-bg border-0 text-white shadow-md"
                      : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {typ === "all" ? t("hangout.filter.all_types") : t(`hangout.type.${typ}`)}
                </button>
              ))}
            </div>

            <div className="flex gap-2 flex-wrap -mx-1 px-1" data-testid="hangout-category-chips">
              {chips.map((chip) => (
                <button
                  key={chip.key ?? "all"}
                  type="button"
                  aria-pressed={category === chip.key}
                  data-testid={chip.key ? `hangout-category-${chip.key}` : "hangout-category-all"}
                  onClick={() => applyCategory(chip.key)}
                  className={cn(
                    "shrink-0 px-3 py-1 rounded-full text-xs font-bold border transition-colors",
                    category === chip.key
                      ? "gradient-bg border-0 text-white shadow-md"
                      : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" data-testid="hangout-date-chips">
              {dateChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={dateFilter === chip.key}
                  data-testid={`hangout-date-${chip.key}`}
                  onClick={() => applyDateFilter(chip.key)}
                  className={cn(
                    "shrink-0 px-3 py-1 rounded-full text-xs font-bold border transition-colors",
                    dateFilter === chip.key
                      ? "gradient-bg border-0 text-white shadow-md"
                      : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="px-1 flex items-center gap-2" data-testid="hangout-sort">
              <label className="text-xs font-semibold text-muted-foreground">
                {t("hangout.filter.sort")}
              </label>
              <div className="relative">
                <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                <select
                  data-testid="hangout-sort-select"
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value as HangoutSort); setPage(1); }}
                  aria-label={t("hangout.filter.sort")}
                  className="appearance-none rounded-full border border-muted bg-background text-xs font-bold text-muted-foreground pl-3 pr-7 py-1 hover:bg-muted/40 transition-colors"
                >
                  <option value="date">{t("hangout.sort.date")}</option>
                  <option value="popularity">{t("hangout.sort.popularity")}</option>
                  <option value="price">{t("hangout.sort.price")}</option>
                </select>
              </div>
            </div>

            <div className="px-1" data-testid="hangout-price-filter">
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-xs font-semibold text-muted-foreground">
                  {t("hangout.filter.price")}
                </label>
                <div className="flex gap-1.5">
                  {(["all", "free", "paid"] as HangoutPriceFilter[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      aria-pressed={priceFilter === v}
                      data-testid={`hangout-price-${v}`}
                      onClick={() => { setPriceFilter(v); setPage(1); }}
                      className={cn(
                        "shrink-0 px-3 py-1 rounded-full text-xs font-bold border transition-colors",
                        priceFilter === v
                          ? "gradient-bg border-0 text-white shadow-md"
                          : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {v === "all" ? t("hangout.price.all") : v === "free" ? t("hangout.price.free") : t("hangout.price.paid")}
                    </button>
                  ))}
                </div>
              </div>
              {priceFilter === "paid" && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  <button
                    type="button"
                    aria-pressed={priceMax == null}
                    data-testid="hangout-price-max-any"
                    onClick={() => { setPriceMax(null); setPage(1); }}
                    className={cn(
                      "shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors",
                      priceMax == null
                        ? "bg-primary text-primary-foreground border-0"
                        : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {t("hangout.price.any")}
                  </button>
                  {PRICE_RANGE_PRESETS.filter((p) => p.key !== "all").map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={priceMax === p.max}
                      data-testid={`hangout-price-max-${p.key}`}
                      onClick={() => { setPriceMax(p.max); setPage(1); }}
                      className={cn(
                        "shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold border transition-colors",
                        priceMax === p.max
                          ? "bg-primary text-primary-foreground border-0"
                          : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {t("hangout.price.max", { amount: p.max })}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-1" data-testid="hangout-radius">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                  <MapPin size={12} />
                  {t("hangout.filter.radius", { km: radiusKm })}
                </label>
                {geoStatus === "denied" && (
                  <button
                    type="button"
                    data-testid="hangout-geo-retry"
                    onClick={askGeo}
                    className="text-xs text-primary underline underline-offset-2"
                  >
                    {t("hangout.filter.geo_retry")}
                  </button>
                )}
              </div>
              <Slider
                value={[radiusKm]}
                min={1}
                max={50}
                step={1}
                onValueChange={(v) => setRadiusKm(v[0])}
                aria-label={t("hangout.filter.radius", { km: radiusKm })}
                disabled={geoStatus === "denied"}
              />
              {geoStatus === "denied" && (
                <p className="text-xs text-amber-600 mt-1.5 flex items-center gap-1">
                  <MapPin size={12} />
                  {t("hangout.filter.geo_denied")}
                </p>
              )}
            </div>

            {goOutOffers && goOutOffers.length > 0 && (
              <div data-testid="hangout-go-out" className="px-1">
                <div className="flex items-center gap-1 mb-2">
                  <Compass size={14} className="text-primary" />
                  <h3 className="text-sm font-bold">{t("hangout.go_out.title")}</h3>
                </div>
                <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1">
                  {goOutOffers.map((offer) => {
                    const Icon = GO_OUT_ICONS[offer.category] || MapPin;
                    const color = GO_OUT_COLORS[offer.category] || "bg-slate-100 text-slate-600";
                    return (
                      <a
                        key={offer.id}
                        href={offer.deeplink}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`hangout-go-out-${offer.id}`}
                        className="shrink-0 snap-start w-[82%] rounded-2xl border border-muted bg-card p-3 hover:shadow-md transition-shadow"
                      >
                        <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full ${color} mb-2`}>
                          <Icon size={16} />
                        </span>
                        <p className="text-sm font-bold leading-tight line-clamp-2">{offer.title}</p>
                        {offer.price != null && (
                          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                            <Ticket size={12} />
                            {offer.price % 1 === 0 ? offer.price.toLocaleString("ru-RU") : offer.price} ₽
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                          {offer.city && (
                            <span className="flex items-center gap-0.5">
                              <MapPin size={10} />
                              {offer.city}
                            </span>
                          )}
                          {typeof offer.commission_rate === "number" && offer.commission_rate > 0 && (
                            <span className="flex items-center gap-0.5 text-emerald-600 font-semibold">
                              <HandCoins size={10} />
                              {t("hangout.go_out.cashback", { pct: String(offer.commission_rate) })}
                            </span>
                          )}
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="px-1" data-testid="hangout-suggest">
              {!isPremium ? (
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
                  <div className="flex items-center gap-1 mb-1">
                    <Sparkles size={16} className="text-primary" />
                    <h3 className="text-sm font-bold">{t("hangout.suggest.upsell_title")}</h3>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{t("hangout.suggest.upsell_desc")}</p>
                  <Button
                    type="button"
                    data-testid="hangout-suggest-upsell"
                    onClick={() => navigate("/premium")}
                    className="w-full rounded-full font-bold"
                    size="sm"
                  >
                    {t("hangout.suggest.go_premium")}
                  </Button>
                </div>
              ) : (
                <div className="rounded-2xl border border-muted bg-card p-3">
                  <div className="flex items-center gap-1 mb-2">
                    <Sparkles size={16} className="text-primary" />
                    <h3 className="text-sm font-bold flex-1">{t("hangout.suggest.title")}</h3>
                    <button
                      type="button"
                      data-testid="hangout-suggest-lang-en"
                      onClick={() => changeSuggestLang("en")}
                      aria-pressed={suggestLang === "en"}
                      className={`text-xs font-bold px-2 py-0.5 rounded-full border ${suggestLang === "en" ? "bg-primary text-white border-primary" : "border-muted text-muted-foreground"}`}
                    >
                      EN
                    </button>
                    <button
                      type="button"
                      data-testid="hangout-suggest-lang-ru"
                      onClick={() => changeSuggestLang("ru")}
                      aria-pressed={suggestLang === "ru"}
                      className={`text-xs font-bold px-2 py-0.5 rounded-full border ${suggestLang === "ru" ? "bg-primary text-white border-primary" : "border-muted text-muted-foreground"}`}
                    >
                      RU
                    </button>
                  </div>

                  {suggestOpen && suggestIdeas.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {suggestIdeas.map((idea, i) => {
                        const Icon = categoryIcon(idea.category);
                        return (
                          <div key={i} data-testid={`hangout-suggest-idea-${i}`} className="rounded-xl border border-muted p-2.5 bg-background/40">
                            <div className="flex items-start gap-2">
                              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary shrink-0">
                                <Icon size={16} />
                              </span>
                              <div className="min-w-0">
                                <p className="text-sm font-bold leading-tight">{idea.title}</p>
                                {idea.place && (
                                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                    <MapPin size={10} />
                                    {idea.place}
                                  </p>
                                )}
                                {idea.description && (
                                  <p className="text-xs text-muted-foreground mt-1">{idea.description}</p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <Button
                        type="button"
                        data-testid="hangout-suggest-create"
                        onClick={() => navigate("/hangouts/create")}
                        variant="outline"
                        className="mt-1 rounded-full font-bold"
                        size="sm"
                      >
                        <PlusCircle size={14} className="mr-1.5" />
                        {t("hangout.suggest.create")}
                      </Button>
                    </div>
                  )}

                  {suggestOpen && suggestLoading && (
                    <div className="flex items-center justify-center py-6">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                    </div>
                  )}

                  {suggestOpen && suggestError && !suggestLoading && (
                    <p className="text-xs text-amber-600" data-testid="hangout-suggest-error">
                      {t("hangout.suggest.error")}
                    </p>
                  )}

                  {!suggestOpen && (
                    <Button
                      type="button"
                      data-testid="hangout-suggest-open"
                      onClick={handleSuggest}
                      className="w-full rounded-full font-bold"
                      size="sm"
                    >
                      <Sparkles size={14} className="mr-1.5" />
                      {t("hangout.suggest.open")}
                    </Button>
                  )}
                  {suggestOpen && (
                    <Button
                      type="button"
                      data-testid="hangout-suggest-close"
                      onClick={() => setSuggestOpen(false)}
                      variant="ghost"
                      className="w-full rounded-full font-bold mt-2 text-muted-foreground text-xs"
                      size="sm"
                    >
                      {t("hangout.suggest.close")}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {loading ? (
              <div className="space-y-3" data-testid="hangout-skeletons" aria-hidden="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <HangoutSkeletonCard key={`sk-${i}`} />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground" data-testid="hangouts-empty">
                <CalendarDays size={48} className="mb-4 opacity-30" />
                <p className="text-sm">{t("hangout.empty")}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("hangout.empty_desc")}</p>
                <Button
                  data-testid="hangouts-empty-reset"
                  onClick={() => {
                    setSearch("");
                    setCategory(null);
                    setHangoutType("all");
                    setDateFilter("all");
                    setSortBy("date");
                    setPage(1);
                    setDebouncedSearch("");
                  }}
                  variant="outline"
                  className="mt-3 rounded-full font-bold text-xs"
                >
                  {t("hangout.empty_reset")}
                </Button>
                {goOutOffers && goOutOffers.length > 0 && (
                  <Button
                    data-testid="hangouts-empty-goout"
                    onClick={() => document.getElementById("hangout-go-out")?.scrollIntoView({ behavior: "smooth" })}
                    variant="ghost"
                    className="mt-2 rounded-full font-bold text-xs"
                  >
                    {t("hangout.empty_goout")}
                  </Button>
                )}
                <Button
                  data-testid="hangouts-empty-create"
                  onClick={() => navigate("/hangouts/create")}
                  className="mt-2 rounded-full font-bold"
                >
                  <PlusCircle size={16} className="mr-1.5" />
                  {t("hangout.action.create")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingNew.length > 0 && (
                  <div className="flex justify-center">
                    <Button
                      data-testid="hangouts-new-badge"
                      onClick={refreshFeed}
                      size="sm"
                      className="rounded-full shadow-md font-bold"
                    >
                      <Sparkles size={14} className="mr-1.5" />
                      {t("hangout.new.show", { count: pendingNew.length })}
                    </Button>
                  </div>
                )}
                <div className="space-y-6" role="list" aria-label={t("hangout.title")}>
                {groupHangoutsByDate(items).map(([key, group]) => (
                  <section key={key} role="listitem">
                    <h3 className="sticky top-[64px] z-10 bg-background/95 backdrop-blur-sm py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {hangoutGroupLabel(key, t)}
                    </h3>
                    <div className="space-y-3 mt-1.5">
                      {group.map((h) => (
                        <HangoutCard key={h.id} hangout={h} />
                      ))}
                    </div>
                  </section>
                ))}
                {hasMore && (
                  <div ref={sentinelRef} className="h-12 flex items-center justify-center" data-testid="hangout-sentinel">
                    {loading && <Loader2 size={18} className="animate-spin text-muted-foreground" />}
                  </div>
                )}
                </div>
              </div>
            )}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
