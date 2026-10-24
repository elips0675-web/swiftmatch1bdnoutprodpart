import { useEffect, useState } from "react";
import { Hotel, CalendarDays, Users, Send, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";
import type { PartnerOffer } from "./chat-partner-actions";

interface Props {
  offer: PartnerOffer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HotelBookingDialog({ offer, open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [guests, setGuests] = useState("2");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleBook = async () => {
    if (!checkIn || !checkOut) {
      setError(t("partner.hotel.fill_required"));
      return;
    }
    if (checkOut <= checkIn) {
      setError(t("partner.hotel.checkout_after_checkin"));
      return;
    }
    const guestsCount = Number(guests);
    if (!Number.isInteger(guestsCount) || guestsCount < 1 || guestsCount > 10) {
      setError(t("partner.hotel.guests_range"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/partners/hotel/book", {
        method: "POST",
        headers,
        body: JSON.stringify({
          offer_id: offer.id,
          check_in: checkIn,
          check_out: checkOut,
          guests: guestsCount,
        }),
      });
      if (!res.ok) {
        setError(t("partner.hotel.error"));
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.deeplink) {
        window.open(data.deeplink, "_blank", "noopener");
      }
      onOpenChange(false);
    } catch {
      setError(t("partner.hotel.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hotel size={18} className="text-blue-500" />
            {t("partner.hotel.title")}
          </DialogTitle>
          <DialogDescription>{offer.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                <CalendarDays size={12} className="inline mr-1" />{t("partner.hotel.check_in")}
              </label>
              <Input
                data-testid="hotel-checkin"
                type="date"
                min={today}
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="rounded-xl"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                <CalendarDays size={12} className="inline mr-1" />{t("partner.hotel.check_out")}
              </label>
              <Input
                data-testid="hotel-checkout"
                type="date"
                min={checkIn || today}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="rounded-xl"
              />
            </div>
          </div>

          <div className="w-24">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              <Users size={12} className="inline mr-1" />{t("partner.hotel.guests")}
            </label>
            <Input
              data-testid="hotel-guests"
              type="number"
              min={1}
              max={10}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
              className="rounded-xl"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            data-testid="confirm-hotel-booking"
            className="w-full rounded-full"
            onClick={handleBook}
            disabled={loading}
          >
            {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Send size={14} className="mr-1" />}
            {t("partner.hotel.book")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
