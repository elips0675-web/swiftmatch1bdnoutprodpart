import { useState } from "react";
import { Flower2, Send, Loader2, ArrowLeft } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";
import { toast } from "@/hooks/use-toast";
import type { PartnerOffer } from "./chat-partner-actions";

interface Props {
  offer: PartnerOffer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FlowerOrderDialog({ offer, open, onOpenChange }: Props) {
  const { t } = useLanguage();
  const [step, setStep] = useState<"details" | "confirm">("details");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOrder = async () => {
    if (!recipientName.trim() || !recipientAddress.trim()) {
      setError(t("partner.order.fill_required"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = getToken();
      const res = await fetch("/api/partners/order", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          offer_id: offer.id,
          recipient_name: recipientName.trim(),
          recipient_address: recipientAddress.trim(),
          gift_message: giftMessage.trim() || undefined,
        }),
      });
      if (!res.ok) {
        setError(t("partner.order.error"));
        return;
      }
      const data = await res.json() as { url?: string; deeplink?: string };
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      if (data.deeplink) {
        window.open(data.deeplink, "_blank", "noopener");
      }
      toast({ title: t("partner.order.success_title"), description: t("partner.order.success_desc") });
      onOpenChange(false);
    } catch {
      setError(t("partner.order.error"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flower2 size={18} className="text-pink-500" />
            {step === "details" ? t("partner.order.title") : t("partner.order.confirm")}
          </DialogTitle>
          <DialogDescription>{offer.title}</DialogDescription>
        </DialogHeader>

        {step === "details" ? (
          <div className="space-y-3">
            {offer.price && (
              <Badge variant="secondary" className="text-sm font-semibold">
                {Number(offer.price).toLocaleString("ru-RU")} ₽
              </Badge>
            )}

            <Input
              data-testid="recipient-name"
              placeholder={t("partner.order.recipient_name")}
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="rounded-xl"
            />
            <Textarea
              data-testid="recipient-address"
              placeholder={t("partner.order.recipient_address")}
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              className="rounded-xl resize-none"
              rows={2}
            />
            <Textarea
              data-testid="gift-message"
              placeholder={t("partner.order.gift_message")}
              value={giftMessage}
              onChange={(e) => setGiftMessage(e.target.value)}
              className="rounded-xl resize-none"
              rows={2}
            />

            {error && <p className="text-xs text-destructive">{error}</p>}

            <Button
              data-testid="proceed-to-confirm"
              className="w-full rounded-full"
              onClick={() => {
                if (!recipientName.trim() || !recipientAddress.trim()) {
                  setError(t("partner.order.fill_required"));
                  return;
                }
                setError(null);
                setStep("confirm");
              }}
            >
              {t("partner.order.next")}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-xl border p-3 space-y-2 text-sm">
              <p><span className="font-medium">{t("partner.order.recipient_name")}:</span> {recipientName}</p>
              <p className="text-muted-foreground">{recipientAddress}</p>
              {giftMessage && <p className="italic text-muted-foreground">"{giftMessage}"</p>}
              {offer.price && (
                <p className="font-semibold text-base">{Number(offer.price).toLocaleString("ru-RU")} ₽</p>
              )}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="rounded-full flex-1"
                onClick={() => setStep("details")}
                disabled={loading}
              >
                <ArrowLeft size={14} className="mr-1" /> {t("partner.order.back")}
              </Button>
              <Button
                data-testid="confirm-order"
                className="rounded-full flex-1"
                onClick={handleOrder}
                disabled={loading}
              >
                {loading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Send size={14} className="mr-1" />}
                {t("partner.order.pay")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
