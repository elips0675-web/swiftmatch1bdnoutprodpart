import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
import { usePremium } from "@/hooks/use-premium";
import { getToken } from "@/lib/token";
import type { Hangout } from "@/lib/hangouts";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";

const COMPANION_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const COMPANION_OPTIONS_PREMIUM = [...COMPANION_OPTIONS, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function HangoutEditPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { isPremium } = usePremium();
  const companionOptions = isPremium ? COMPANION_OPTIONS_PREMIUM : COMPANION_OPTIONS;
  const [loading, setLoading] = useState(true);
  const [notEditable, setNotEditable] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [placeAddress, setPlaceAddress] = useState("");
  const [city, setCity] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [maxCompanions, setMaxCompanions] = useState(1);
  const [price, setPrice] = useState("");
  const [capacity, setCapacity] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const token = getToken();
        if (!token) {
          navigate("/login");
          return;
        }
        const res = await fetch(`/api/hangouts/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("failed");
        const data: Hangout = await res.json();
        if (cancelled) return;
        if (!data.is_author || data.status !== "active") {
          setNotEditable(true);
          return;
        }
        setTitle(data.title || "");
        setDescription(data.description || "");
        setPlaceName(data.place_name || "");
        setPlaceAddress(data.place_address || "");
        setCity(data.city || "");
        setEventDate(toLocalInput(data.event_date));
        setMaxCompanions(Number(data.max_companions) || 1);
        setPrice(data.price !== null && data.price !== undefined ? String(data.price) : "");
        setCapacity(data.capacity !== null && data.capacity !== undefined ? String(data.capacity) : "");
      } catch {
        if (!cancelled) setNotEditable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const submit = async () => {
    if (!title.trim() || !eventDate) {
      toast.error(t("hangout.form.required"));
      return;
    }
    setSubmitting(true);
    try {
      const token = getToken();
      if (!token) {
        navigate("/login");
        return;
      }
      const res = await fetch(`/api/hangouts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          place_name: placeName.trim() || undefined,
          place_address: placeAddress.trim() || undefined,
          city: city.trim() || undefined,
          event_date: new Date(eventDate).toISOString(),
          max_companions: maxCompanions,
          price: price ? Number(price) : null,
          capacity: capacity ? Number(capacity) : null,
        }),
      });
      if (!res.ok) throw new Error("failed");
      toast.success(t("hangout.toast.updated"));
      navigate(`/hangouts/${id}`);
    } catch {
      toast.error(t("hangout.error.load"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <AppHeader title={t("hangout.action.edit")} />
      <main className="px-4 pb-24 pt-4 max-w-2xl mx-auto">
        {loading && <Loader2 size={24} data-testid="edit-loading" className="mx-auto animate-spin text-muted-foreground" />}
        {!loading && notEditable && (
          <Card className="p-6 text-center space-y-4" data-testid="edit-forbidden">
            <p className="text-sm text-muted-foreground">{t("hangout.edit.only_author")}</p>
            <Button variant="outline" className="rounded-full" asChild>
              <Link to="/hangouts/my">{t("hangout.action.back")}</Link>
            </Button>
          </Card>
        )}
        {!loading && !notEditable && (
          <Card className="p-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="hangout-title">{t("hangout.form.title")}</Label>
              <Input
                id="hangout-title"
                data-testid="hangout-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("hangout.form.title_placeholder")}
                maxLength={255}
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <Button
              data-testid="submit-hangout-edit"
              onClick={submit}
              disabled={submitting}
              className="w-full rounded-full font-bold h-11"
            >
              {submitting && <Loader2 size={16} className="mr-2 animate-spin" />}
              {t("button.save")}
            </Button>
          </Card>
        )}
      </main>
      <BottomNav />
    </div>
  );
}
