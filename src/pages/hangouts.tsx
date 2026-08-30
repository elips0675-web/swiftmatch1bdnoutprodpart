import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/context/language-context";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { getToken } from "@/lib/token";
import { HANGOUT_CATEGORIES, formatEventDate, type Hangout, type HangoutType } from "@/lib/hangouts";
import { Clapperboard, Theater, Palette, Coffee, Music, Dumbbell, Sparkles, CalendarDays, MapPin, Users, PlusCircle, Compass, Heart, UserPlus, Search, X, Ticket, Zap } from "lucide-react";
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

export type HangoutDateFilter = "all" | "today" | "tomorrow" | "weekend";

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
  const [buying, setBuying] = useState(false);
  const Icon = categoryIcon(hangout.category);
  const isDate = hangout.hangout_type === 'date';

  const navigateProfile = (h: Hangout) => {
    if (h.author_id) navigate(`/profile/${h.author_id}`);
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
              <img src={hangout.avatar_url} alt="" className="w-full h-full object-cover" />
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
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function HangoutsPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { hangoutsEnabled } = useFeatureFlags();
  const [items, setItems] = useState<Hangout[]>([]);
  const [loading, setLoading] = useState(true);
  const [hangoutType, setHangoutType] = useState<HangoutType | "all">("all");
  const [category, setCategory] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<HangoutDateFilter>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [radiusKm, setRadiusKm] = useState(10);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoStatus, setGeoStatus] = useState<"pending" | "ok" | "denied">("pending");
  const [geoAsked, setGeoAsked] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setItems((prev) => (page > 1 ? [...prev, ...arr] : arr));
        setHasMore(arr.length >= PAGE_LIMIT);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [category, hangoutType, dateFilter, page, coords, radiusKm, hangoutsEnabled, debouncedSearch]);

  const chips = useMemo(
    () => [{ key: null, label: t("hangout.filter.all_categories") }, ...HANGOUT_CATEGORIES.map((c) => ({ key: c as string, label: t(`hangout.category.${c}`) }))],
    [t],
  );

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
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto space-y-4">
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
              size="lg"
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
                className="pl-9 pr-9 rounded-full h-10"
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
                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
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
                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
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
                    "shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors",
                    dateFilter === chip.key
                      ? "gradient-bg border-0 text-white shadow-md"
                      : "bg-background border-muted text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {chip.label}
                </button>
              ))}
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

            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" data-testid="hangouts-empty">
                <CalendarDays size={48} className="mb-4 opacity-30" />
                <p>{t("hangout.empty")}</p>
                <Button
                  data-testid="hangouts-empty-create"
                  onClick={() => navigate("/hangouts/create")}
                  variant="outline"
                  className="mt-4 rounded-full font-bold"
                >
                  <PlusCircle size={16} className="mr-1.5" />
                  {t("hangout.action.create")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((h) => (
                  <HangoutCard key={h.id} hangout={h} />
                ))}
                {hasMore && (
                  <Button
                    data-testid="hangouts-load-more"
                    variant="outline"
                    className="w-full rounded-full font-bold"
                    disabled={loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t("hangout.filter.load_more")}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
