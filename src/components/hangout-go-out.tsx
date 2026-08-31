import { useState } from "react";
import { Utensils, MapPin, ExternalLink, Calendar, Clock, Users, Loader2, HandCoins } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getToken } from "@/lib/token";
import { useLanguage } from "@/context/language-context";
import { GO_OUT_ICONS, GO_OUT_COLORS } from "@/lib/go-out";

export type GoOutOffer = {
  id: number;
  category: string;
  title: string;
  description?: string;
  deeplink: string;
  price?: number | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  image_url?: string | null;
  partner_name?: string;
  commission_rate?: number | null;
};

// Подстановка плейсхолдеров {city}/{lat}/{lng} в аффилиат-deeplink (персонализация)
export function fillDeeplink(deeplink: string, city: string, offer: GoOutOffer): string {
  return deeplink
    .replace(/\{city\}/g, encodeURIComponent(city || offer.city || ""))
    .replace(/\{lat\}/g, offer.lat != null ? String(offer.lat) : "")
    .replace(/\{lng\}/g, offer.lng != null ? String(offer.lng) : "");
}

export function GoOutBookingDialog({
  offer,
  city,
  open,
  onOpenChange,
}: {
  offer: GoOutOffer | null;
  city: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [guests, setGuests] = useState("2");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!offer) return null;
  const Icon = GO_OUT_ICONS[offer.category] || MapPin;
  const color = GO_OUT_COLORS[offer.category] || "bg-slate-100 text-slate-600";
  const isRestaurant = offer.category === "restaurant";
  const today = new Date().toISOString().slice(0, 10);
  const link = fillDeeplink(offer.deeplink, city, offer);

  const handleBook = async () => {
    if (isRestaurant) {
      if (!date || !time) {
        setError(t("partner.booking.fill_required"));
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await fetch("/api/partners/booking", {
          method: "POST",
          headers,
          body: JSON.stringify({
            offer_id: offer.id,
            date,
            time,
            guests: Number(guests),
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message || t("partner.booking.error"));
        }
        const data = await res.json();
        if (data.deeplink) window.open(data.deeplink, "_blank", "noopener");
        onOpenChange(false);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : t("partner.booking.error"));
      } finally {
        setLoading(false);
      }
      return;
    }
    window.open(link, "_blank", "noopener");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full ${color}`}>
              <Icon size={16} />
            </span>
            {offer.title}
          </DialogTitle>
          <DialogDescription>
            {offer.partner_name}
            {offer.city ? ` — ${offer.city}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {offer.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{offer.description}</p>
          )}

          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {offer.price != null && (
              <span className="inline-flex items-center gap-1 rounded-full border border-muted px-2 py-1">
                {offer.price % 1 === 0 ? offer.price.toLocaleString("ru-RU") : offer.price} ₽
              </span>
            )}
            {typeof offer.commission_rate === "number" && offer.commission_rate > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-muted px-2 py-1 text-emerald-600 font-semibold">
                <HandCoins size={12} />
                {t("hangout.go_out.cashback", { pct: String(offer.commission_rate) })}
              </span>
            )}
          </div>

          {isRestaurant && (
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  <Calendar size={12} className="inline mr-1" />{t("partner.booking.date")}
                </label>
                <Input
                  data-testid="goout-booking-date"
                  type="date"
                  min={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-xl"
                />
              </div>
              <div className="w-24">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  <Clock size={12} className="inline mr-1" />{t("partner.booking.time")}
                </label>
                <Input
                  data-testid="goout-booking-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="rounded-xl"
                />
              </div>
              <div className="w-20">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  <Users size={12} className="inline mr-1" />{t("partner.booking.guests")}
                </label>
                <Input
                  data-testid="goout-booking-guests"
                  type="number"
                  min={1}
                  max={20}
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                  className="rounded-xl"
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            data-testid="goout-booking-confirm"
            className="w-full rounded-full"
            onClick={handleBook}
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <ExternalLink size={14} className="mr-1" />}
            {isRestaurant
              ? t("partner.booking.confirm")
              : t("hangout.go_out.book")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AffiliateMap({
  offers,
  city,
  open,
  onOpenChange,
}: {
  offers: GoOutOffer[];
  city: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const withCoords = offers.find((o) => o.lat != null && o.lng != null);
  const center = city || offers.find((o) => o.city)?.city || "";
  const mapSrc = withCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${
        Math.max(-180, (withCoords.lng as number) - 0.05)
      }%2C${Math.max(-90, (withCoords.lat as number) - 0.02)}%2C${Math.min(180, (withCoords.lng as number) + 0.05)}%2C${Math.min(90, (withCoords.lat as number) + 0.02)}&layer=mapnik&marker=${withCoords.lat}%2C${withCoords.lng}`
    : `https://www.openstreetmap.org/export/embed.html?bbox=&layer=mapnik&q=${encodeURIComponent(center)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin size={18} className="text-primary" />
            {t("hangout.go_out.map_title")}
          </DialogTitle>
          <DialogDescription>
            {center ? center : t("hangout.go_out.map_hint")}
          </DialogDescription>
        </DialogHeader>
        <iframe
          data-testid="affiliate-map-frame"
          title="Affiliate map"
          src={mapSrc}
          className="w-full h-52 rounded-2xl border border-muted"
          loading="lazy"
        />
        <div className="max-h-40 overflow-y-auto space-y-1">
          {offers.map((o) => (
            <a
              key={o.id}
              href={fillDeeplink(o.deeplink, city, o)}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`affiliate-map-item-${o.id}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-muted px-3 py-2 text-sm hover:bg-muted/40 transition-colors"
            >
              <span className="truncate">{o.title}</span>
              <ExternalLink size={14} className="shrink-0 text-muted-foreground" />
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
