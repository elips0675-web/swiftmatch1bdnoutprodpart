import { useState, useEffect } from "react";
import { UtensilsCrossed, Calendar, Clock, Users, Send, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";
import type { PartnerOffer } from "./chat-partner-actions";

interface Props {
  offer: PartnerOffer;
  chatId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShared?: () => void;
}

export function RestaurantBookingDialog({ offer, chatId, open, onOpenChange, onShared }: Props) {
  const { t } = useLanguage();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("19:00");
  const [guests, setGuests] = useState("2");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (open) {
      setError(null);
      setShared(false);
    }
  }, [open]);

  const handleBook = async () => {
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

      const bookRes = await fetch("/api/partners/booking", {
        method: "POST",
        headers,
        body: JSON.stringify({
          offer_id: offer.id,
          date,
          time,
          guests: Number(guests),
          message: message.trim() || undefined,
        }),
      });
      if (!bookRes.ok) {
        const data = await bookRes.json();
        throw new Error(data.message || "Booking failed");
      }
      const bookData = await bookRes.json();

      if (bookData.deeplink) {
        window.open(bookData.deeplink, "_blank", "noopener");
      }

      if (chatId) {
        const shareRes = await fetch("/api/partners/booking/share", {
          method: "POST",
          headers,
          body: JSON.stringify({
            chat_id: chatId,
            offer_id: offer.id,
            date,
            time,
            guests: Number(guests),
            message: message.trim() || undefined,
          }),
        });
        if (!shareRes.ok) {
          setError(t("partner.booking.share_error"));
          return;
        }
        setShared(true);
        onShared?.();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("partner.booking.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UtensilsCrossed size={18} className="text-orange-500" />
            {t("partner.booking.title")}
          </DialogTitle>
          <DialogDescription>{offer.title}</DialogDescription>
        </DialogHeader>

        {shared ? (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-muted-foreground">{t("partner.booking.shared")}</p>
            <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
              {t("partner.close")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  <Calendar size={12} className="inline mr-1" />{t("partner.booking.date")}
                </label>
                <Input
                  data-testid="booking-date"
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
                  data-testid="booking-time"
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
                  data-testid="booking-guests"
                  type="number"
                  min={1}
                  max={20}
                  value={guests}
                  onChange={(e) => setGuests(e.target.value)}
                  className="rounded-xl"
                />
              </div>
            </div>

            <Textarea
              data-testid="booking-message"
              placeholder={t("partner.booking.message")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="rounded-xl resize-none"
              rows={2}
            />

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              data-testid="confirm-booking"
              className="w-full rounded-full"
              onClick={handleBook}
              disabled={loading}
            >
              {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Send size={14} className="mr-1" />}
              {t("partner.booking.confirm")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
