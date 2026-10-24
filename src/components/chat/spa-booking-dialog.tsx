import { useEffect, useState } from "react";
import { Sparkles, Calendar, Clock, Send, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";
import type { PartnerOffer } from "./chat-partner-actions";

interface Props {
  offer: PartnerOffer;
  chatId?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SpaBookingDialog({ offer, chatId, open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("12:00");
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
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;

      const bookRes = await fetch("/api/partners/spa/book", {
        method: "POST",
        headers,
        body: JSON.stringify({ offer_id: offer.id, date, time }),
      });
      if (!bookRes.ok) {
        setError(t("partner.spa.error"));
        return;
      }
      const bookData = await bookRes.json().catch(() => ({}));

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
            message: `${offer.title} — ${date} ${time}`,
          }),
        });
        if (!shareRes.ok) {
          setError(t("partner.spa.share_error"));
          return;
        }
        setShared(true);
      }
    } catch {
      setError(t("partner.spa.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-500" />
            {t("partner.spa.title")}
          </DialogTitle>
          <DialogDescription>{offer.title}</DialogDescription>
        </DialogHeader>

        {shared ? (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-muted-foreground">{t("partner.spa.shared")}</p>
            <Button variant="outline" className="rounded-full" onClick={() => onOpenChange(false)}>
              {t("partner.spa.close")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <p className="text-sm text-destructive" data-testid="spa-error">{error}</p>
            )}

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Calendar size={14} /> {t("partner.spa.date")}
              </label>
              <Input
                type="date"
                min={today}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                data-testid="spa-date"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium flex items-center gap-1.5">
                <Clock size={14} /> {t("partner.spa.time")}
              </label>
              <Input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                data-testid="spa-time"
              />
            </div>

            {offer.price != null && (
              <p className="text-sm text-muted-foreground">
                {t("partner.spa.price")}: {Number(offer.price).toLocaleString("ru-RU")} ₽
              </p>
            )}

            <Button
              className={cn("w-full rounded-full gradient-bg text-white")}
              onClick={handleBook}
              disabled={loading || !date || !time}
              data-testid="spa-book"
            >
              {loading ? <Loader2 className="animate-spin mr-2" size={16} /> : <Send size={14} className="mr-2" />}
              {t("partner.spa.book")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
