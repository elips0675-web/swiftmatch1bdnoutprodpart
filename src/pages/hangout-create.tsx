import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader } from "@/components/layout/app-header";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/context/language-context";
import { useFeatureFlags } from "@/context/feature-flags-context";
import { usePremium } from "@/hooks/use-premium";
import { getToken } from "@/lib/token";
import { cn } from "@/lib/utils";
import { HANGOUT_CATEGORIES, HANGOUT_TYPES, type HangoutCategory, type HangoutType } from "@/lib/hangouts";
import { toast } from "sonner";
import { Loader2, Ticket, Heart, Users, Crown, Lock, ChevronLeft, ChevronRight, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const COMPANION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COMPANION_OPTIONS_PREMIUM = [...COMPANION_OPTIONS, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

const PARTNER_TO_HANGOUT_CATEGORY: Record<string, HangoutCategory> = {
  cinema: "cinema",
  restaurant: "cafe",
  event: "other",
};

function defaultDateTime(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function HangoutCreatePage() {
  const { t } = useLanguage();
  const { partnerOffersEnabled } = useFeatureFlags();
  const { isPremium } = usePremium();
  const navigate = useNavigate();
  const companionOptions = isPremium ? COMPANION_OPTIONS_PREMIUM : COMPANION_OPTIONS;
  const [category, setCategory] = useState<HangoutCategory>("cinema");
  const [hangoutType, setHangoutType] = useState<HangoutType>("date");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [city, setCity] = useState("");
  const [eventDate, setEventDate] = useState(defaultDateTime());
  const [maxCompanions, setMaxCompanions] = useState(1);
  const [price, setPrice] = useState("");
  const [capacity, setCapacity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [listingsOpen, setListingsOpen] = useState(false);
  const [listings, setListings] = useState<Array<{ id: number; category: string; title: string; description?: string; partner_name: string }>>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);
  const [dailyLimitHit, setDailyLimitHit] = useState(false);

  const STEPS = [
    { key: "what", label: t("hangout.form.step_what") },
    { key: "where", label: t("hangout.form.step_where") },
    { key: "when", label: t("hangout.form.step_when") },
    { key: "tickets", label: t("hangout.form.step_tickets") },
  ];
  const TOTAL_STEPS = STEPS.length;
  const [step, setStep] = useState(0);

  // Предзаполнение города из профиля пользователя
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (!token || city) return;
      try {
        const res = await fetch("/api/profile/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const me = await res.json();
        if (!cancelled && me?.city && !city) setCity(me.city);
      } catch { /* профиль недоступен — оставляем пусто */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canProceed = (s: number) => {
    if (s === 0) return title.trim().length > 0;
    if (s === 2) return Boolean(eventDate) && eventDate >= defaultDateTime().slice(0, 16);
    return true;
  };

  const next = () => {
    if (!canProceed(step)) {
      toast.error(t(step === 0 ? "hangout.form.required" : "hangout.form.date_invalid"));
      return;
    }
    if (step < TOTAL_STEPS) setStep((s) => s + 1);
  };

  const prev = () => setStep((s) => Math.max(0, s - 1));

  const isLastStep = step === TOTAL_STEPS - 1;

  const openListings = async () => {
    setListingsOpen(true);
    setListingsLoading(true);
    try {
      const token = getToken();
      const res = await fetch("/api/partners/offers?placement=hangout", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setListings(res.ok ? await res.json() : []);
    } catch {
      setListings([]);
    } finally {
      setListingsLoading(false);
    }
  };

  const applyListing = async (offer: { id: number; category: string; title: string; description?: string; partner_name: string }) => {
    setCategory(PARTNER_TO_HANGOUT_CATEGORY[offer.category] ?? "other");
    setTitle(offer.title);
    if (offer.description) setDescription(offer.description);
    setPlaceName((prev) => prev || offer.partner_name);
    setListingsOpen(false);
    try {
      const token = getToken();
      await fetch("/api/partners/track", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ offer_id: offer.id, conversion_type: "lead" }),
      });
    } catch { /* трекинг не критичен */ }
    toast.success(t("partner.select_offer"));
  };

  const submit = async () => {
    if (!title.trim() || !eventDate) {
      toast.error(t("hangout.form.required"));
      return;
    }
    if (price && (Number(price) <= 0 || Number.isNaN(Number(price)))) {
      toast.error(t("hangout.form.price_invalid"));
      return;
    }
    setSubmitting(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      try {
        if (navigator.geolocation) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          lat = Number(pos.coords.latitude.toFixed(8));
          lng = Number(pos.coords.longitude.toFixed(8));
        }
      } catch { /* геолокация недоступна */ }

      const token = getToken();
      if (!token) { navigate("/login"); return; }
      const res = await fetch("/api/hangouts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          category,
          hangout_type: hangoutType,
          title: title.trim(),
          description: description.trim() || undefined,
          place_name: placeName.trim() || undefined,
          place_address: placeAddress.trim() || undefined,
          city: city.trim() || undefined,
          lat,
          lng,
          event_date: new Date(eventDate).toISOString(),
          max_companions: maxCompanions,
          price: price ? Number(price) : undefined,
          capacity: capacity ? Number(capacity) : undefined,
          partner_offer_id: selectedOfferId ?? undefined,
        }),
      });
      if (!res.ok) {
        // Достаём код ошибки (например HANGOUT_DAILY_LIMIT), если сервер вернул JSON
        let errorCode = "";
        try {
          const err = await res.json();
          errorCode = err?.code || "";
        } catch { /* тело не JSON — игнорируем */ }
        if (errorCode === "HANGOUT_DAILY_LIMIT") {
          setDailyLimitHit(true);
          toast.error(t("hangout.toast.daily_limit"));
          return;
        }
        throw new Error("failed");
      }
      toast.success(t("hangout.toast.created"));
      navigate("/hangouts/my");
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader title={t("hangout.action.create")} />
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto">
        {dailyLimitHit && (
          <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4" data-testid="hangout-daily-limit">
            <div className="flex items-start gap-3">
              <Crown size={20} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-bold text-sm text-amber-800">{t("hangout.upsell.title")}</p>
                <p className="text-xs text-amber-700 mt-1">{t("hangout.upsell.subtitle")}</p>
                <div className="flex gap-2 mt-3">
                  <Button
                    data-testid="hangout-upsell-go"
                    className="rounded-full font-bold h-9"
                    onClick={() => navigate("/premium")}
                  >
                    <Crown size={14} className="mr-1.5" /> {t("hangout.upsell.cta")}
                  </Button>
                  <Button
                    data-testid="hangout-upsell-dismiss"
                    variant="ghost"
                    className="rounded-full h-9 text-muted-foreground"
                    onClick={() => setDailyLimitHit(false)}
                  >
                    {t("hangout.action.cancel")}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-1.5" data-testid="hangout-create-steps">
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <button
                  key={s.key}
                  type="button"
                  data-testid={`hangout-step-pill-${s.key}`}
                  onClick={() => { if (i <= step) setStep(i); }}
                  aria-current={active ? "step" : undefined}
                  className={cn(
                    "flex-1 rounded-full text-[10px] font-bold uppercase tracking-wide py-1.5 transition-colors flex items-center justify-center gap-1",
                    active ? "bg-primary text-primary-foreground" : done ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {done ? <Check size={11} /> : <span>{i + 1}</span>}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
              );
            })}
          </div>
          {step === 0 && (
            <div className="space-y-4" data-testid="hangout-step-what">
              <div className="space-y-1.5">
                <Label>{t("hangout.form.type")}</Label>
                <div className="flex gap-2">
                  {HANGOUT_TYPES.map((typ) => (
                    <button
                      key={typ}
                      type="button"
                      data-testid={`hangout-type-${typ}`}
                      onClick={() => setHangoutType(typ)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold border transition-colors",
                        hangoutType === typ
                          ? typ === "date"
                            ? "border-pink-400 bg-pink-50 text-pink-700"
                            : "border-blue-400 bg-blue-50 text-blue-700"
                          : "border-muted bg-background text-muted-foreground hover:bg-muted/40",
                      )}
                    >
                      {typ === "date" ? <Heart size={16} /> : <Users size={16} />}
                      {t(`hangout.type.${typ}`)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {hangoutType === "date"
                    ? t("hangout.form.type_date_desc")
                    : t("hangout.form.type_company_desc")
                  }
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="hangout-category">{t("hangout.form.category")}</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as HangoutCategory)}>
                  <SelectTrigger id="hangout-category" data-testid="hangout-category" aria-label={t("hangout.form.category")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HANGOUT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{t(`hangout.category.${c}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="hangout-title">{t("hangout.form.title")}</Label>
                  {partnerOffersEnabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid="pick-from-listings"
                      onClick={openListings}
                      className="h-7 rounded-full text-xs font-bold text-primary px-3"
                    >
                      <Ticket size={13} className="mr-1" />
                      {t("partner.select_offer")}
                    </Button>
                  )}
                </div>
                <Input
                  id="hangout-title"
                  data-testid="hangout-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("hangout.form.title_placeholder")}
                  maxLength={255}
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4" data-testid="hangout-step-where">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="hangout-place">{t("hangout.form.place_name")}</Label>
                  <Input
                    id="hangout-place"
                    data-testid="hangout-place"
                    value={placeName}
                    onChange={(e) => setPlaceName(e.target.value)}
                    placeholder={t("hangout.form.place_name_placeholder")}
                    maxLength={255}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="hangout-address">{t("hangout.form.place_address")}</Label>
                  <Input
                    id="hangout-address"
                    data-testid="hangout-address"
                    value={placeAddress}
                    onChange={(e) => setPlaceAddress(e.target.value)}
                    maxLength={255}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hangout-city">{t("hangout.form.city")}</Label>
                <Input
                  id="hangout-city"
                  data-testid="hangout-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  maxLength={100}
                />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4" data-testid="hangout-step-when">
              <div className="space-y-1.5">
                <Label htmlFor="hangout-date">{t("hangout.form.date")}</Label>
                <Input
                  id="hangout-date"
                  data-testid="hangout-date"
                  type="datetime-local"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("hangout.form.max_companions")}</Label>
                <Select
                  value={String(maxCompanions)}
                  onValueChange={(v) => setMaxCompanions(Number(v))}
                >
                  <SelectTrigger data-testid="hangout-max-companions" aria-label={t("hangout.form.max_companions")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {companionOptions.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isPremium && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock size={12} className="shrink-0" />
                    {t("hangout.form.companions_premium_hint")}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4" data-testid="hangout-step-tickets">
              <div className="space-y-1.5">
                <Label htmlFor="hangout-price">{t("hangout.form.ticket_price")}</Label>
                <Input
                  id="hangout-price"
                  data-testid="hangout-price"
                  type="number"
                  min="0"
                  step="1"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder={t("hangout.form.ticket_price_placeholder")}
                />
                <p className="text-xs text-muted-foreground">{t("hangout.form.ticket_price_hint")}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="hangout-capacity">{t("hangout.form.ticket_capacity")}</Label>
                <Input
                  id="hangout-capacity"
                  data-testid="hangout-capacity"
                  type="number"
                  min="1"
                  step="1"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  placeholder={t("hangout.form.ticket_capacity_placeholder")}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="hangout-description">{t("hangout.form.description")}</Label>
                <Textarea
                  id="hangout-description"
                  data-testid="hangout-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("hangout.form.description_placeholder")}
                  rows={3}
                  maxLength={2000}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1" data-testid="hangout-create-nav">
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                data-testid="hangout-wizard-prev"
                onClick={prev}
                disabled={submitting}
                className="rounded-full font-bold h-11 px-4"
              >
                <ChevronLeft size={16} className="mr-1" />
                {t("hangout.form.back")}
              </Button>
            )}
            {!isLastStep ? (
              <Button
                type="button"
                data-testid="hangout-wizard-next"
                onClick={next}
                className="flex-1 rounded-full font-bold h-11"
              >
                {t("hangout.form.next")}
                <ChevronRight size={16} className="ml-1" />
              </Button>
            ) : (
              <Button
                data-testid="submit-hangout"
                onClick={submit}
                disabled={submitting}
                className="flex-1 rounded-full font-bold h-11"
              >
                {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
                {t("hangout.form.submit")}
              </Button>
            )}
          </div>
        </Card>
      </main>
      <Dialog open={listingsOpen} onOpenChange={setListingsOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t("partner.select_offer")}</DialogTitle>
            <DialogDescription>{t("partner.select_offer_desc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-2">
            {listingsLoading && <Loader2 size={20} className="mx-auto animate-spin text-muted-foreground" />}
            {!listingsLoading && listings.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("error.generic_title")}</p>
            )}
            {listings.map((offer) => (
              <button
                key={offer.id}
                type="button"
                data-testid={`listing-offer-${offer.category}`}
                onClick={() => applyListing(offer)}
                className="w-full text-left rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sm">{offer.title}</span>
                  <span className="shrink-0 text-[10px] uppercase font-bold text-muted-foreground">{t(`partner.category.${offer.category}`)}</span>
                </div>
                {offer.description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{offer.description}</p>}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <BottomNav />
    </div>
  );
}
