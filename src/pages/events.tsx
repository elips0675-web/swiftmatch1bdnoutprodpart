import { useEffect, useState } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";
import { formatEventDate } from "@/lib/hangouts";
import { CalendarDays, MapPin, Ticket, Loader2, Sparkles, Users, Clock, Search } from "lucide-react";

interface EventOffer {
  id: number;
  partner_id: number;
  category: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  price: string | number | null;
  city: string | null;
  location: string | null;
  event_start: string;
  event_end: string | null;
  event_url: string | null;
  capacity: number | null;
  tickets_sold: number;
  remaining: number;
  sold_out: boolean;
  partner_name: string;
  my_ticket?: { id: number; status: string } | null;
}

function formatHr(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return formatEventDate(value);
}

export default function EventsPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<EventOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [buyingId, setBuyingId] = useState<number | null>(null);

  const load = () => {
    const token = getToken();
    setLoading(true);
    fetch("/api/events", { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setItems(arr);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const buyTicket = async (ev: EventOffer) => {
    if (buyingId) return;
    const token = getToken();
    setBuyingId(ev.id);
    try {
      const res = await fetch(`/api/events/${ev.id}/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.code === "ALREADY_PURCHASED") {
        load();
        return;
      }
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      if (res.ok && data.mock) {
        load();
        return;
      }
    } catch {
      // ignore
    } finally {
      setBuyingId(null);
    }
  };

  const filtered = items.filter((ev) =>
    !search.trim() ||
    (ev.title || "").toLowerCase().includes(search.trim().toLowerCase()) ||
    (ev.city || "").toLowerCase().includes(search.trim().toLowerCase()) ||
    (ev.location || "").toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader title={t("events.title")} />
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto space-y-4">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-testid="events-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("events.search")}
            className="pl-9 rounded-full h-10"
            aria-label={t("events.search")}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16" data-testid="events-loading">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground" data-testid="events-empty">
            <Sparkles size={48} className="mb-4 opacity-30" />
            <p className="font-semibold">{t("events.empty")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((ev) => {
              const bought = ev.my_ticket?.status === "paid";
              return (
                <Card key={ev.id} data-testid={`event-card-${ev.id}`} className="overflow-hidden">
                  {ev.poster_url ? (
                    <img src={ev.poster_url} alt={ev.title} className="h-40 w-full object-cover" />
                  ) : (
                    <div className="h-28 w-full bg-gradient-to-br from-primary/15 via-muted to-primary/5 flex items-center justify-center">
                      <Sparkles size={36} className="text-primary/50" />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-center gap-2 flex-wrap mb-1" data-testid={`event-format-${ev.id}`}>
                      <Badge className="text-[10px]">{ev.partner_name}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{ev.category}</Badge>
                      {ev.sold_out && (
                        <Badge className="text-[10px] bg-destructive/10 text-destructive">{t("events.sold_out")}</Badge>
                      )}
                      {bought && (
                        <Badge data-testid={`event-bought-${ev.id}`} className="text-[10px] bg-emerald-500/10 text-emerald-600">{t("events.purchased")}</Badge>
                      )}
                    </div>
                    <h2 className="font-black font-headline text-lg leading-snug">{ev.title}</h2>
                    {ev.description && <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{ev.description}</p>}

                    <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                      <p className="flex items-center gap-1.5">
                        <CalendarDays size={12} />
                        <span data-testid={`event-date-${ev.id}`}>{formatHr(ev.event_start)}</span>
                        {ev.event_end && <span>— {formatHr(ev.event_end)}</span>}
                      </p>
                      {ev.location && (
                        <p className="flex items-center gap-1.5 truncate">
                          <MapPin size={12} />
                          {[ev.location, ev.city].filter(Boolean).join(", ")}
                        </p>
                      )}
                      {typeof ev.capacity === "number" && (
                        <p className="flex items-center gap-1.5">
                          <Users size={12} />
                          {t("events.remaining", { count: ev.remaining ?? 0, total: ev.capacity })}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="text-xl font-black font-headline text-primary">
                        {ev.price != null && Number(ev.price) > 0 ? `${Number(ev.price).toLocaleString("ru-RU")} ₽` : t("events.free")}
                      </div>
                      {bought ? (
                        <Button size="sm" variant="outline" disabled>{t("events.ticket_bought")}</Button>
                      ) : ev.sold_out ? (
                        <Button size="sm" variant="outline" disabled>{t("events.sold_out")}</Button>
                      ) : (
                        <Button
                          size="sm"
                          data-testid={`event-buy-${ev.id}`}
                          onClick={() => buyTicket(ev)}
                          disabled={buyingId === ev.id}
                          className="rounded-full font-bold"
                        >
                          <Ticket size={14} className="mr-1" />
                          {buyingId === ev.id ? t("events.buying") : t("events.buy")}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
