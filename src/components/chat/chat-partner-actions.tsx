import { useState } from "react";
import { Car, Clapperboard, UtensilsCrossed, Flower2, Hotel, Sparkles, Ticket, Gift, Camera, Wine, ExternalLink, Copy, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { useApi } from "@/hooks/useApi";
import { getToken } from "@/lib/token";
import { FlowerOrderDialog } from "./flower-order-dialog";
import { RestaurantBookingDialog } from "./restaurant-booking-dialog";
import { HotelBookingDialog } from "./hotel-booking-dialog";
import { SpaBookingDialog } from "./spa-booking-dialog";

const CATEGORY_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  taxi: Car,
  cinema: Clapperboard,
  restaurant: UtensilsCrossed,
  flowers: Flower2,
  hotel: Hotel,
  spa: Sparkles,
  event: Ticket,
  gift: Gift,
  photo: Camera,
  experience: Wine,
};

export interface PartnerOffer {
  id: number;
  partner_name: string;
  category: string;
  title: string;
  description?: string;
  price?: string | number;
}

export function ChatPartnerActions({ placement = "chat", chatId, onShared }: { placement?: string; chatId?: number; onShared?: () => void }) {
  const { t } = useLanguage();
  const { data: offers, loading } = useApi<PartnerOffer[]>(
    `/api/partners/offers?placement=${placement}`
  );
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [fallbackOffer, setFallbackOffer] = useState<PartnerOffer | null>(null);
  const [flowerOffer, setFlowerOffer] = useState<PartnerOffer | null>(null);
  const [restaurantOffer, setRestaurantOffer] = useState<PartnerOffer | null>(null);
  const [hotelOffer, setHotelOffer] = useState<PartnerOffer | null>(null);
  const [spaOffer, setSpaOffer] = useState<PartnerOffer | null>(null);

  const handleAction = async (offer: PartnerOffer) => {
    if (offer.category === "flowers" || offer.category === "gift") {
      setFlowerOffer(offer);
      return;
    }
    if (offer.category === "restaurant") {
      setRestaurantOffer(offer);
      return;
    }
    if (offer.category === "hotel") {
      setHotelOffer(offer);
      return;
    }
    if (offer.category === "spa" || offer.category === "experience") {
      setSpaOffer(offer);
      return;
    }
    setPendingId(offer.id);
    let coords: { lat?: number; lng?: number } = {};
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("no geo"));
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000 });
      });
      coords = { lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) };
    } catch { /* geolocation unavailable, track without coords */ }
    try {
      const token = getToken();
      const res = await fetch("/api/partners/track", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ offer_id: offer.id, ...coords }),
      });
      if (!res.ok) throw new Error("track failed");
      const { deeplink } = await res.json();
      if (/^https?:\/\//i.test(deeplink)) {
        window.open(deeplink, "_blank", "noopener");
      } else {
        let leftPage = false;
        const onBlur = () => { leftPage = true; };
        window.addEventListener("blur", onBlur);
        window.location.href = deeplink;
        window.setTimeout(() => {
          window.removeEventListener("blur", onBlur);
          if (!leftPage && !document.hidden) setFallbackOffer(offer);
        }, 1500);
      }
    } catch {
      // ignored
    } finally {
      setPendingId(null);
    }
  };

  const list = Array.isArray(offers) ? offers : [];
  if (!loading && list.length === 0) return null;

  return (
    <div data-testid="partner-actions" className="flex gap-1.5 overflow-x-auto pb-1 px-0.5">
      {loading &&
        [...Array(3)].map((_, i) => (
          <div key={i} className="h-7 w-24 shrink-0 rounded-full bg-muted animate-pulse" />
        ))}
      {!loading &&
        list.map((offer) => {
          const Icon = CATEGORY_ICONS[offer.category] ?? Sparkles;
          return (
            <button
              key={offer.id}
              type="button"
              data-testid={`partner-action-${offer.category}`}
              onClick={() => handleAction(offer)}
              disabled={pendingId === offer.id}
              aria-label={t(`partner.category.${offer.category}`)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary",
                pendingId === offer.id && "opacity-60"
              )}
            >
              {pendingId === offer.id ? <Loader2 size={12} className="animate-spin" /> : <Icon size={12} />}
              <span className="truncate max-w-[120px]">{t(`partner.category.${offer.category}`)}</span>
            </button>
          );
        })}

      <Dialog open={!!fallbackOffer} onOpenChange={(open) => !open && setFallbackOffer(null)}>
        <DialogContent className="max-w-xs rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <ExternalLink size={16} /> {fallbackOffer && t(`partner.category.${fallbackOffer.category}`)}
            </DialogTitle>
            <DialogDescription>{t("partner.fallback_desc")}</DialogDescription>
          </DialogHeader>
          {fallbackOffer?.description && (
            <p className="text-xs text-muted-foreground -mt-1">{fallbackOffer.description}</p>
          )}
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => {
              navigator.clipboard.writeText(fallbackOffer?.title ?? "").catch(() => {});
              setFallbackOffer(null);
            }}
          >
            <Copy size={14} className="mr-1" /> {t("partner.close")}
          </Button>
        </DialogContent>
      </Dialog>

      {flowerOffer && (
        <FlowerOrderDialog
          offer={flowerOffer}
          open={!!flowerOffer}
          onOpenChange={(open) => { if (!open) setFlowerOffer(null); }}
        />
      )}

      {restaurantOffer && (
        <RestaurantBookingDialog
          offer={restaurantOffer}
          chatId={chatId}
          open={!!restaurantOffer}
          onOpenChange={(open) => { if (!open) setRestaurantOffer(null); }}
          onShared={onShared}
        />
      )}

      {hotelOffer && (
        <HotelBookingDialog
          offer={hotelOffer}
          open={!!hotelOffer}
          onOpenChange={(open) => { if (!open) setHotelOffer(null); }}
        />
      )}

      {spaOffer && (
        <SpaBookingDialog
          offer={spaOffer}
          chatId={chatId}
          open={!!spaOffer}
          onOpenChange={(open) => { if (!open) setSpaOffer(null); }}
          onShared={onShared}
        />
      )}
    </div>
  );
}
