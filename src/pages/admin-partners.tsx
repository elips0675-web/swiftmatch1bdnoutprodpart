import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Handshake, Plus, Pause, CircleCheck, Loader2, Banknote, BarChart3, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/context/language-context";
import { getToken } from "@/lib/token";

interface AdminPartner {
  id: number;
  name: string;
  type: string;
  commission_rate: string | number;
  hmac_secret: string | null;
  status: 'active' | 'paused';
  offers_count: number;
  clicks_total: number;
  conversions_total: number;
  commission_pending: string | number;
}

interface AdminOffer {
  id: number;
  partner_id: number;
  partner_name: string;
  category: string;
  title: string;
  placement: string;
  status: 'active' | 'paused';
  pinned: number | boolean;
  clicks_total: number;
}

interface AdminConversion {
  id: number;
  partner_id: number;
  partner_name: string;
  offer_id: number | null;
  offer_title: string | null;
  user_id: number | null;
  user_email: string | null;
  conversion_type: string;
  external_order_id: string | null;
  amount: number | null;
  commission: number | null;
  status: string;
  created_at: string;
}

const OFFER_CATEGORIES = ['cinema', 'restaurant', 'flowers', 'taxi', 'hotel', 'spa', 'photo', 'gift', 'event', 'experience'];
const PLACEMENT_OPTIONS = ['chat', 'hangout', 'profile', 'passport'];

interface AdminPayout {
  id: number;
  partner_id: number;
  partner_name: string;
  amount: number;
  currency: string;
  method: string;
  details: string | null;
  status: string;
  admin_note: string | null;
  created_at: string;
  processed_at: string | null;
}

interface DailyStats {
  date: string;
  total: number;
  clicks: number;
  conversions: number;
  revenue: number;
  commission: number;
}

type Tab = "partners" | "offers" | "conversions" | "payouts" | "stats";

export default function AdminPartnersPage() {
  const { t } = useLanguage();
  const [partners, setPartners] = useState<AdminPartner[]>([]);
  const [offers, setOffers] = useState<AdminOffer[]>([]);
  const [conversions, setConversions] = useState<AdminConversion[]>([]);
  const [payouts, setPayouts] = useState<AdminPayout[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [tab, setTab] = useState<Tab>("partners");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("deeplink");
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerForm, setOfferForm] = useState({ partner_id: "", category: "taxi", title: "", deeplink: "", placement: "chat" });
  const [busy, setBusy] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutForm, setPayoutForm] = useState({ partner_id: "", amount: "", method: "bank", details: "" });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const [pRes, oRes, cRes, ptRes, dsRes] = await Promise.all([
        fetch('/api/admin/partners', { headers }),
        fetch('/api/admin/offers', { headers }),
        fetch('/api/admin/conversions', { headers }),
        fetch('/api/admin/partners/payouts', { headers }),
        fetch('/api/admin/partners/stats/daily', { headers }),
      ]);
      const pData = pRes.ok ? await pRes.json() : [];
      const oData = oRes.ok ? await oRes.json() : [];
      const cData = cRes.ok ? await cRes.json() : [];
      const ptData = ptRes.ok ? await ptRes.json() : [];
      const dsData = dsRes.ok ? await dsRes.json() : [];
      setPartners(Array.isArray(pData) ? pData : []);
      setOffers(Array.isArray(oData) ? oData : []);
      setConversions(Array.isArray(cData) ? cData : []);
      setPayouts(Array.isArray(ptData) ? ptData : []);
      setDailyStats(Array.isArray(dsData) ? dsData : []);
    } catch {
      toast.error(t('error.generic_title'));
      setPartners([]);
      setOffers([]);
      setConversions([]);
      setPayouts([]);
      setDailyStats([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const togglePartner = async (p: AdminPartner) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/partners/${p.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status: p.status === 'active' ? 'paused' : 'active' }),
      });
      if (!res.ok) throw new Error('failed');
      fetchData();
    } catch {
      toast.error(t('error.generic_title'));
    }
  };

  const createPartner = async () => {
    if (newName.trim().length < 2) return;
    setBusy(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ name: newName.trim(), type: newType }),
      });
      if (!res.ok) throw new Error('failed');
      setNewName("");
      setCreateOpen(false);
      toast.success(t('admin.features.saved'));
      fetchData();
    } catch {
      toast.error(t('error.generic_title'));
    } finally {
      setBusy(false);
    }
  };

  const createOffer = async () => {
    if (!offerForm.partner_id || offerForm.title.trim().length < 3 || !offerForm.deeplink.trim()) return;
    setBusy(true);
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/partners/${offerForm.partner_id}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          category: offerForm.category,
          title: offerForm.title.trim(),
          deeplink: offerForm.deeplink.trim(),
          placement: offerForm.placement,
        }),
      });
      if (!res.ok) throw new Error('failed');
      setOfferForm({ partner_id: "", category: "taxi", title: "", deeplink: "", placement: "chat" });
      setOfferOpen(false);
      toast.success(t('admin.features.saved'));
      fetchData();
    } catch {
      toast.error(t('error.generic_title'));
    } finally {
      setBusy(false);
    }
  };

  const toggleOffer = async (o: AdminOffer) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/offers/${o.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status: o.status === 'active' ? 'paused' : 'active' }),
      });
      if (!res.ok) throw new Error('failed');
      fetchData();
    } catch {
      toast.error(t('error.generic_title'));
    }
  };

  const togglePin = async (o: AdminOffer) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/offers/${o.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ pinned: !o.pinned }),
      });
      if (!res.ok) throw new Error('failed');
      fetchData();
    } catch {
      toast.error(t('error.generic_title'));
    }
  };

  const createPayout = async () => {
    if (!payoutForm.partner_id || !Number(payoutForm.amount)) return;
    setBusy(true);
    try {
      const token = getToken();
      const res = await fetch('/api/admin/partners/payouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          partner_id: Number(payoutForm.partner_id),
          amount: Number(payoutForm.amount),
          method: payoutForm.method,
          details: payoutForm.details || undefined,
        }),
      });
      if (!res.ok) throw new Error('failed');
      setPayoutOpen(false);
      setPayoutForm({ partner_id: "", amount: "", method: "bank", details: "" });
      toast.success(t('admin.features.saved'));
      fetchData();
    } catch {
      toast.error(t('error.generic_title'));
    } finally {
      setBusy(false);
    }
  };

  const updatePayout = async (id: number, status: string) => {
    try {
      const token = getToken();
      const res = await fetch(`/api/admin/partners/payouts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('failed');
      toast.success(t('admin.features.saved'));
      fetchData();
    } catch {
      toast.error(t('error.generic_title'));
    }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "partners", label: t('admin.partners'), icon: <Handshake size={14} /> },
    { key: "offers", label: t('admin.partners.offers_list'), icon: <Plus size={14} /> },
    { key: "conversions", label: t('admin.partners.conversions'), icon: <CircleCheck size={14} /> },
    { key: "payouts", label: t('admin.partners.payouts'), icon: <Banknote size={14} /> },
    { key: "stats", label: t('admin.partners.stats'), icon: <BarChart3 size={14} /> },
  ];

  const totalCommission = conversions.reduce((s, c) => s + (Number(c.commission) || 0), 0);
  const pendingPayouts = payouts.filter((p) => p.status === 'pending').length;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
        <CardTitle className="text-lg font-black flex items-center gap-2">
          <Handshake className="h-5 w-5 text-primary" />
          {t('admin.partners')}
          {pendingPayouts > 0 && <Badge variant="destructive" className="text-[10px] ml-1">{pendingPayouts}</Badge>}
        </CardTitle>
        <div className="flex gap-2">
          {tab === "partners" && (
            <>
              <Button size="sm" variant="outline" data-testid="add-offer-button" onClick={() => setOfferOpen(true)} className="rounded-full h-9 px-4 text-xs font-bold">
                <Plus size={13} className="mr-1" /> {t('admin.partners.add_offer')}
              </Button>
              <Button size="sm" data-testid="add-partner-button" onClick={() => setCreateOpen(true)} className="rounded-full h-9 px-4 text-xs font-bold">
                <Plus size={13} className="mr-1" /> {t('admin.partners.add')}
              </Button>
            </>
          )}
          {tab === "payouts" && (
            <Button size="sm" data-testid="add-payout-button" onClick={() => setPayoutOpen(true)} className="rounded-full h-9 px-4 text-xs font-bold">
              <Plus size={13} className="mr-1" /> {t('admin.partners.add_payout')}
            </Button>
          )}
        </div>
      </CardHeader>

      <div className="flex gap-1 px-6 overflow-x-auto">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full whitespace-nowrap transition-colors ${tab === tb.key ? "bg-primary text-white" : "text-muted-foreground hover:bg-muted"}`}
          >
            {tb.icon} {tb.label}
          </button>
        ))}
      </div>

      <CardContent className="space-y-8">
        {loading ? (
          <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (
          <>
            {tab === "partners" && (
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">ID</TableHead>
                  <TableHead>{t('admin.partners.name')}</TableHead>
                  <TableHead className="w-24">{t('admin.partners.type')}</TableHead>
                  <TableHead className="w-20">{t('admin.partners.rate')}</TableHead>
                  <TableHead className="w-28">HMAC Secret</TableHead>
                  <TableHead className="w-20">{t('admin.partners.offers')}</TableHead>
                  <TableHead className="w-20">{t('admin.partners.clicks')}</TableHead>
                  <TableHead className="w-24">{t('admin.partners.conversions')}</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">—</TableCell></TableRow>
                ) : partners.map((p) => (
                  <TableRow key={p.id} data-testid={`admin-partner-${p.id}`}>
                    <TableCell className="font-mono text-xs">{p.id}</TableCell>
                    <TableCell className="text-sm font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{p.type}</Badge></TableCell>
                    <TableCell className="text-xs">{Number(p.commission_rate).toFixed(1)}%</TableCell>
                    <TableCell className="font-mono text-[10px] text-muted-foreground truncate max-w-[120px]" title={p.hmac_secret ?? '—'}>{p.hmac_secret ? `${p.hmac_secret.slice(0, 8)}…` : '—'}</TableCell>
                    <TableCell className="text-sm">{p.offers_count}</TableCell>
                    <TableCell className="text-sm font-bold">{p.clicks_total}</TableCell>
                    <TableCell className="text-sm">{p.conversions_total}</TableCell>
                    <TableCell>
                      {p.status === 'active' ? (
                        <Button size="sm" variant="outline" data-testid={`pause-partner-${p.id}`} onClick={() => togglePartner(p)} className="rounded-full h-8 px-3 text-xs">
                          <Pause size={12} className="mr-1" /> {t('admin.partners.pause')}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" data-testid={`activate-partner-${p.id}`} onClick={() => togglePartner(p)} className="rounded-full h-8 px-3 text-xs text-green-700 hover:text-green-700">
                          <CircleCheck size={12} className="mr-1" /> {t('admin.partners.activate')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            )}

            {tab === "offers" && (
              <div>
              <h3 className="text-sm font-black uppercase tracking-tight mb-2">{t('admin.partners.offers_list')}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">ID</TableHead>
                    <TableHead>{t('hangout.form.title')}</TableHead>
                    <TableHead>{t('admin.partners.name')}</TableHead>
                    <TableHead className="w-28">{t('hangout.form.category')}</TableHead>
                    <TableHead className="w-36">Placement</TableHead>
                    <TableHead className="w-20">{t('admin.partners.clicks')}</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">—</TableCell></TableRow>
                  ) : offers.map((o) => (
                    <TableRow key={o.id} data-testid={`admin-offer-${o.id}`}>
                      <TableCell className="font-mono text-xs">{o.id}</TableCell>
                      <TableCell className="text-sm font-medium truncate max-w-[220px]">{o.title}</TableCell>
                      <TableCell className="text-sm truncate max-w-[140px]">{o.partner_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{t(`partner.category.${o.category}`)}</Badge></TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{o.placement}</TableCell>
                      <TableCell className="text-sm font-bold">{o.clicks_total}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button size="sm" variant={o.pinned ? "default" : "outline"} data-testid={`pin-offer-${o.id}`} onClick={() => togglePin(o)}
                            className={"rounded-full h-8 px-3 text-xs " + (o.pinned ? "bg-amber-500 hover:bg-amber-500 text-white" : "text-amber-700 hover:text-amber-700")}>
                            <Sparkles size={12} className="mr-1" /> {o.pinned ? t('admin.partners.sponsored_on') : t('admin.partners.sponsored')}
                          </Button>
                          {o.status === 'active' ? (
                            <Button size="sm" variant="outline" data-testid={`pause-offer-${o.id}`} onClick={() => toggleOffer(o)} className="rounded-full h-8 px-3 text-xs">
                              <Pause size={12} className="mr-1" /> {t('admin.partners.pause')}
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" data-testid={`activate-offer-${o.id}`} onClick={() => toggleOffer(o)} className="rounded-full h-8 px-3 text-xs text-green-700 hover:text-green-700">
                              <CircleCheck size={12} className="mr-1" /> {t('admin.partners.activate')}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}

            {tab === "conversions" && (
            <div>
              <h3 className="text-sm font-black uppercase tracking-tight mb-2">{t('admin.partners.conversions_list')}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">ID</TableHead>
                    <TableHead>{t('admin.partners.name')}</TableHead>
                    <TableHead>{t('hangout.form.title')}</TableHead>
                    <TableHead className="w-24">Type</TableHead>
                    <TableHead className="w-28">External ID</TableHead>
                    <TableHead className="w-20">Amount</TableHead>
                    <TableHead className="w-20">Commission</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="w-36">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {conversions.length === 0 ? (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">—</TableCell></TableRow>
                  ) : conversions.map((c) => (
                    <TableRow key={c.id} data-testid={`admin-conversion-${c.id}`}>
                      <TableCell className="font-mono text-xs">{c.id}</TableCell>
                      <TableCell className="text-sm truncate max-w-[120px]">{c.partner_name}</TableCell>
                      <TableCell className="text-sm truncate max-w-[180px]">{c.offer_title ?? '—'}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{c.conversion_type}</Badge></TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground truncate max-w-[140px]">{c.external_order_id ?? '—'}</TableCell>
                      <TableCell className="text-sm font-medium">{c.amount != null ? `$${Number(c.amount).toFixed(2)}` : '—'}</TableCell>
                      <TableCell className="text-sm font-bold text-green-700">{c.commission != null ? `$${Number(c.commission).toFixed(2)}` : '—'}</TableCell>
                      <TableCell><Badge variant={c.status === 'approved' ? 'default' : 'secondary'} className="text-[10px]">{c.status}</Badge></TableCell>
                      <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(c.created_at).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}

            {tab === "payouts" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-black uppercase tracking-tight">{t('admin.partners.payouts_list')}</h3>
                <span className="text-xs text-muted-foreground">{t('admin.partners.total_commission')}: ${totalCommission.toFixed(2)}</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">ID</TableHead>
                    <TableHead>{t('admin.partners.name')}</TableHead>
                    <TableHead className="w-20">Amount</TableHead>
                    <TableHead className="w-24">Method</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="w-28">Admin Note</TableHead>
                    <TableHead className="w-36">Date</TableHead>
                    <TableHead className="w-36"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payouts.length === 0 ? (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">—</TableCell></TableRow>
                  ) : payouts.map((p) => (
                    <TableRow key={p.id} data-testid={`admin-payout-${p.id}`}>
                      <TableCell className="font-mono text-xs">{p.id}</TableCell>
                      <TableCell className="text-sm truncate max-w-[120px]">{p.partner_name}</TableCell>
                      <TableCell className="text-sm font-medium">{Number(p.amount).toLocaleString()} ₽</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{p.method}</Badge></TableCell>
                      <TableCell><Badge variant={p.status === 'completed' ? 'default' : p.status === 'rejected' ? 'destructive' : 'secondary'} className="text-[10px]">{p.status}</Badge></TableCell>
                      <TableCell className="text-[10px] text-muted-foreground truncate max-w-[140px]">{p.admin_note ?? '—'}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</TableCell>
                      <TableCell>
                        {p.status === 'pending' && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => updatePayout(p.id, 'completed')} className="rounded-full h-7 px-2 text-[10px] text-green-700">
                              <CircleCheck size={10} className="mr-1" /> {t('admin.partners.approve')}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => updatePayout(p.id, 'rejected')} className="rounded-full h-7 px-2 text-[10px] text-destructive">
                              {t('admin.partners.reject')}
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}

            {tab === "stats" && (
            <div>
              <h3 className="text-sm font-black uppercase tracking-tight mb-2">{t('admin.partners.daily_stats')}</h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Date</TableHead>
                    <TableHead className="w-20">Clicks</TableHead>
                    <TableHead className="w-20">Conversions</TableHead>
                    <TableHead className="w-20">Total</TableHead>
                    <TableHead className="w-24">Revenue</TableHead>
                    <TableHead className="w-24">Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyStats.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">—</TableCell></TableRow>
                  ) : dailyStats.map((s) => (
                    <TableRow key={s.date}>
                      <TableCell className="text-sm">{s.date}</TableCell>
                      <TableCell className="text-sm font-bold">{s.clicks}</TableCell>
                      <TableCell className="text-sm">{s.conversions}</TableCell>
                      <TableCell className="text-sm font-bold">{s.total}</TableCell>
                      <TableCell className="text-sm font-medium">{Number(s.revenue).toLocaleString()} ₽</TableCell>
                      <TableCell className="text-sm font-bold text-green-700">{Number(s.commission).toLocaleString()} ₽</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('admin.partners.add')}</DialogTitle>
            <DialogDescription>{t('admin.partners.add')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="partner-name">{t('admin.partners.name')}</Label>
              <Input id="partner-name" data-testid="partner-name" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.partners.type')}</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger data-testid="partner-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="deeplink">deeplink</SelectItem>
                  <SelectItem value="api">api</SelectItem>
                  <SelectItem value="saas">saas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="submit-create-partner" onClick={createPartner} disabled={busy || newName.trim().length < 2} className="w-full rounded-full font-bold">
              {busy && <Loader2 size={14} className="mr-2 animate-spin" />} {t('admin.features.save_btn')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={offerOpen} onOpenChange={setOfferOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('admin.partners.add_offer')}</DialogTitle>
            <DialogDescription>{t('admin.partners.add_offer')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('admin.partners.name')}</Label>
              <Select value={offerForm.partner_id} onValueChange={(v) => setOfferForm((f) => ({ ...f, partner_id: v }))}>
                <SelectTrigger data-testid="offer-partner"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('hangout.form.category')}</Label>
              <Select value={offerForm.category} onValueChange={(v) => setOfferForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger data-testid="offer-category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {OFFER_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{t(`partner.category.${c}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-title">{t('hangout.form.title')}</Label>
              <Input id="offer-title" data-testid="offer-title" value={offerForm.title} onChange={(e) => setOfferForm((f) => ({ ...f, title: e.target.value }))} maxLength={255} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-deeplink">Deeplink / URL</Label>
              <Input id="offer-deeplink" data-testid="offer-deeplink" value={offerForm.deeplink} onChange={(e) => setOfferForm((f) => ({ ...f, deeplink: e.target.value }))} maxLength={500} />
            </div>
            <div className="space-y-1.5">
              <Label>Placement</Label>
              <Select value={offerForm.placement} onValueChange={(v) => setOfferForm((f) => ({ ...f, placement: v }))}>
                <SelectTrigger data-testid="offer-placement"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLACEMENT_OPTIONS.map((pl) => (
                    <SelectItem key={pl} value={pl}>{pl}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="submit-create-offer" onClick={createOffer} disabled={busy || !offerForm.partner_id || offerForm.title.trim().length < 3 || !offerForm.deeplink.trim()} className="w-full rounded-full font-bold">
              {busy && <Loader2 size={14} className="mr-2 animate-spin" />} {t('admin.features.save_btn')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={payoutOpen} onOpenChange={setPayoutOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle>{t('admin.partners.add_payout')}</DialogTitle>
            <DialogDescription>{t('admin.partners.add_payout')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t('admin.partners.name')}</Label>
              <Select value={payoutForm.partner_id} onValueChange={(v) => setPayoutForm((f) => ({ ...f, partner_id: v }))}>
                <SelectTrigger data-testid="payout-partner"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="payout-amount">{t('admin.partners.amount')}</Label>
              <Input id="payout-amount" data-testid="payout-amount" type="number" min={1} value={payoutForm.amount} onChange={(e) => setPayoutForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Method</Label>
              <Select value={payoutForm.method} onValueChange={(v) => setPayoutForm((f) => ({ ...f, method: v }))}>
                <SelectTrigger data-testid="payout-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="crypto">Crypto</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('admin.partners.details')}</Label>
              <Textarea data-testid="payout-details" value={payoutForm.details} onChange={(e) => setPayoutForm((f) => ({ ...f, details: e.target.value }))} className="rounded-xl resize-none" rows={2} />
            </div>
            <Button data-testid="submit-create-payout" onClick={createPayout} disabled={busy || !payoutForm.partner_id || !Number(payoutForm.amount)} className="w-full rounded-full font-bold">
              {busy && <Loader2 size={14} className="mr-2 animate-spin" />} {t('admin.features.save_btn')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
