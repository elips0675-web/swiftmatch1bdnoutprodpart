import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useLanguage } from '@/context/language-context'
import { getToken } from '@/lib/token'
import { toast } from 'sonner'
import { useRouter } from '@/shims/next-navigation'
import {
  LayoutDashboard, Package, ArrowRightLeft, CreditCard, Loader2, Plus, Trash2, Pause, Play,
  Handshake, BarChart3, Building2, TrendingUp, DollarSign, Star, Check, ExternalLink,
} from 'lucide-react'

const OFFER_CATEGORIES = ['cinema', 'restaurant', 'flowers', 'taxi', 'hotel', 'spa', 'photo', 'gift', 'event', 'experience']

interface PartnerDashboardData {
  partner: { id: number; name: string; type: string; status: string }
  stats: { offers_count: number; clicks_total: number; conversions_count: number; commission_total: number; paid_out: number; commission_pending: number }
  subscription: { tier: string; status: string; expires_at: string | null } | null
}

interface PartnerOffer {
  id: number; category: string; title: string; description: string | null; deeplink: string; price: number | null
  city: string | null; placement: string; status: string; created_at: string; clicks: number
}

interface PartnerConversion {
  id: number; conversion_type: string; amount: number; commission: number; status: string
  external_order_id: string | null; created_at: string; offer_title: string | null
}

type PartnerTab = 'dashboard' | 'offers' | 'conversions' | 'subscription'

function formatPrice(p: number) { return p.toLocaleString('ru-RU') + ' ₽' }

export default function PartnerDashboard() {
  const { t } = useLanguage()
  const router = useRouter()
  const [tab, setTab] = useState<PartnerTab>('dashboard')
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PartnerDashboardData | null>(null)
  const [offers, setOffers] = useState<PartnerOffer[]>([])
  const [conversions, setConversions] = useState<PartnerConversion[]>([])
  const [showCreateOffer, setShowCreateOffer] = useState(false)
  const [newOffer, setNewOffer] = useState({ category: 'cinema', title: '', description: '', deeplink: '', price: '', city: '', placement: 'chat' })

  const api = useCallback(async <T,>(url: string): Promise<T | null> => {
    const token = getToken()
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) return null
    return res.json()
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const [dash, offs, convs] = await Promise.all([
          api<PartnerDashboardData>('/api/partner/dashboard'),
          api<PartnerOffer[]>('/api/partner/offers'),
          api<PartnerConversion[]>('/api/partner/conversions'),
        ])
        if (!dash) { router.replace('/'); return }
        setData(dash)
        if (offs) setOffers(offs)
        if (convs) setConversions(convs)
      } catch { router.replace('/') }
      finally { setLoading(false) }
    }
    load()
  }, [api, router])

  const createOffer = async () => {
    if (!newOffer.title.trim() || !newOffer.deeplink.trim()) { toast.error(t('partner.offer_required_fields')); return }
    const token = getToken()
    const res = await fetch('/api/partner/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ ...newOffer, price: newOffer.price ? Number(newOffer.price) : null }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: '' }))
      if (err.code === 'UPGRADE_REQUIRED') { toast.error(t('partner.upgrade_required')); return }
      toast.error(err.message || t('partner.offer_create_error')); return
    }
    toast.success(t('partner.offer_created'))
    setShowCreateOffer(false)
    setNewOffer({ category: 'cinema', title: '', description: '', deeplink: '', price: '', city: '', placement: 'chat' })
    const offs = await api<PartnerOffer[]>('/api/partner/offers')
    if (offs) setOffers(offs)
  }

  const deleteOffer = async (id: number) => {
    const token = getToken()
    const res = await fetch(`/api/partner/offers/${id}`, {
      method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) { toast.error(t('partner.offer_delete_error')); return }
    toast.success(t('partner.offer_deleted'))
    setOffers((prev) => prev.filter((o) => o.id !== id))
  }

  const toggleOfferStatus = async (offer: PartnerOffer) => {
    const token = getToken()
    const newStatus = offer.status === 'active' ? 'paused' : 'active'
    await fetch(`/api/partner/offers/${offer.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ status: newStatus }),
    })
    setOffers((prev) => prev.map((o) => o.id === offer.id ? { ...o, status: newStatus } : o))
  }

  const subscribeToPro = async () => {
    const token = getToken()
    const res = await fetch('/api/partner/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ tier: 'pro' }),
    })
    const d = await res.json()
    if (!res.ok) {
      toast.error(d.code === 'STRIPE_NOT_CONFIGURED' ? t('partner.stripe_unavailable') : t('partner.subscribe_error'))
      return
    }
    if (d.url) { window.location.href = d.url; return }
    if (d.mock) {
      toast.success(t('partner.pro_activated'))
      setData((prev) => prev ? { ...prev, subscription: { tier: 'pro', status: 'active', expires_at: null } } : prev)
    }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-primary" size={32} /></div>
  if (!data) return null

  const tabs = [
    { key: 'dashboard' as PartnerTab, label: t('partner.tab_dashboard'), icon: <LayoutDashboard size={14} /> },
    { key: 'offers' as PartnerTab, label: t('partner.tab_offers'), icon: <Package size={14} /> },
    { key: 'conversions' as PartnerTab, label: t('partner.tab_conversions'), icon: <ArrowRightLeft size={14} /> },
    { key: 'subscription' as PartnerTab, label: t('partner.tab_subscription'), icon: <CreditCard size={14} /> },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#FFF0F5] via-white to-[#F0F8FF] dark:from-[#1a1025] dark:via-[#0f0f1a] dark:to-[#0a1628]">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Handshake size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-black font-headline">{data.partner.name}</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">{data.partner.type}</Badge>
              {data.subscription?.tier === 'pro' && <Badge className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-300"><Star size={9} className="mr-0.5" fill="currentColor" />Pro</Badge>}
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as PartnerTab)}>
          <TabsList className="mb-6">
            {tabs.map((t2) => <TabsTrigger key={t2.key} value={t2.key} className="flex items-center gap-1 text-xs">{t2.icon}{t2.label}</TabsTrigger>)}
          </TabsList>

          {/* Dashboard */}
          <TabsContent value="dashboard">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
              {[
                { icon: <Package size={18} />, label: t('partner.stat_offers'), value: data.stats.offers_count },
                { icon: <ExternalLink size={18} />, label: t('partner.stat_clicks'), value: data.stats.clicks_total },
                { icon: <ArrowRightLeft size={18} />, label: t('partner.stat_conversions'), value: data.stats.conversions_count },
                { icon: <TrendingUp size={18} />, label: t('partner.stat_commission'), value: formatPrice(data.stats.commission_total) },
                { icon: <DollarSign size={18} />, label: t('partner.stat_paid'), value: formatPrice(data.stats.paid_out) },
                { icon: <BarChart3 size={18} />, label: t('partner.stat_pending'), value: formatPrice(data.stats.commission_pending) },
              ].map((s, i) => (
                <Card key={i}>
                  <CardContent className="p-4 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">{s.icon}</div>
                    <div><p className="text-2xl font-black font-headline">{s.value}</p><p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">{s.label}</p></div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Offers */}
          <TabsContent value="offers">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-black font-headline">{t('partner.tab_offers')}</h2>
              <Button size="sm" onClick={() => setShowCreateOffer(!showCreateOffer)}>
                <Plus size={14} className="mr-1" />{t('partner.offer_new')}
              </Button>
            </div>
            {showCreateOffer && (
              <Card className="mb-4">
                <CardContent className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 block">{t('partner.offer_category')}</label>
                      <Select value={newOffer.category} onValueChange={(v) => setNewOffer((p) => ({ ...p, category: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{OFFER_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`partner.category.${c}`)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1 block">{t('partner.offer_title')}</label>
                      <Input value={newOffer.title} onChange={(e) => setNewOffer((p) => ({ ...p, title: e.target.value }))} placeholder={t('partner.offer_title_placeholder')} />
                    </div>
                  </div>
                  <Textarea value={newOffer.description} onChange={(e) => setNewOffer((p) => ({ ...p, description: e.target.value }))} placeholder={t('partner.offer_description_placeholder')} rows={2} />
                  <div className="grid grid-cols-3 gap-3">
                    <Input value={newOffer.deeplink} onChange={(e) => setNewOffer((p) => ({ ...p, deeplink: e.target.value }))} placeholder="https://..." />
                    <Input value={newOffer.price} onChange={(e) => setNewOffer((p) => ({ ...p, price: e.target.value }))} placeholder={t('partner.offer_price')} type="number" />
                    <Input value={newOffer.city} onChange={(e) => setNewOffer((p) => ({ ...p, city: e.target.value }))} placeholder={t('partner.offer_city')} />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={createOffer}>{t('partner.offer_save')}</Button>
                    <Button variant="ghost" onClick={() => setShowCreateOffer(false)}>{t('partner.offer_cancel')}</Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {offers.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">{t('partner.offer_empty')}</CardContent></Card>
            ) : (
              <div className="space-y-2">
                {offers.map((o) => (
                  <Card key={o.id}>
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="secondary" className="text-[10px]">{t(`partner.category.${o.category}`)}</Badge>
                          {o.status === 'paused' && <Badge className="text-[10px] bg-orange-500/10 text-orange-600">{t('partner.status_paused')}</Badge>}
                        </div>
                        <p className="font-bold text-sm truncate">{o.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{o.deeplink}</p>
                        <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                          <span>{t('partner.offer_clicks')}: {o.clicks}</span>
                          {o.price != null && <span>{formatPrice(o.price)}</span>}
                          {o.city && <span>{o.city}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => toggleOfferStatus(o)}>
                          {o.status === 'active' ? <Pause size={14} /> : <Play size={14} />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteOffer(o.id)}>
                          <Trash2 size={14} className="text-destructive" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Conversions */}
          <TabsContent value="conversions">
            <h2 className="text-lg font-black font-headline mb-4">{t('partner.tab_conversions')}</h2>
            {conversions.length === 0 ? (
              <Card><CardContent className="p-8 text-center text-muted-foreground text-sm">{t('partner.conversion_empty')}</CardContent></Card>
            ) : (
              <div className="space-y-2">
                {conversions.map((c) => (
                  <Card key={c.id}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold">{c.offer_title || t('partner.conversion_unknown_offer')}</p>
                        <p className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString('ru-RU')}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-primary">{formatPrice(c.commission)}</p>
                        <Badge variant="secondary" className="text-[10px]">{c.conversion_type}</Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Subscription */}
          <TabsContent value="subscription">
            <h2 className="text-lg font-black font-headline mb-4">{t('partner.tab_subscription')}</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {/* Basic */}
              <Card className={data.subscription?.tier === 'basic' ? 'border-primary/50' : ''}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {t('partner.tier_basic')}
                    {data.subscription?.tier === 'basic' && <Badge className="text-[10px]">{t('partner.tier_current')}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-3xl font-black font-headline">0 ₽<span className="text-sm font-normal text-muted-foreground"> / {t('partner.tier_month')}</span></p>
                  <ul className="space-y-1.5 text-sm">
                    <li className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" />{t('partner.tier_basic_offers')}</li>
                    <li className="flex items-center gap-2"><Check size={14} className="text-primary shrink-0" />{t('partner.tier_basic_commission')}</li>
                  </ul>
                </CardContent>
              </Card>
              {/* Pro */}
              <Card className={data.subscription?.tier === 'pro' ? 'border-primary/50' : 'border-amber-300/50'}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Star size={16} className="text-amber-500" fill="currentColor" />{t('partner.tier_pro')}
                    {data.subscription?.tier === 'pro' && <Badge className="text-[10px] bg-amber-500/10 text-amber-600">{t('partner.tier_current')}</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-3xl font-black font-headline">2 990 ₽<span className="text-sm font-normal text-muted-foreground"> / {t('partner.tier_month')}</span></p>
                  <ul className="space-y-1.5 text-sm">
                    <li className="flex items-center gap-2"><Check size={14} className="text-amber-500 shrink-0" />{t('partner.tier_pro_offers')}</li>
                    <li className="flex items-center gap-2"><Check size={14} className="text-amber-500 shrink-0" />{t('partner.tier_pro_commission')}</li>
                    <li className="flex items-center gap-2"><Check size={14} className="text-amber-500 shrink-0" />{t('partner.tier_pro_priority')}</li>
                  </ul>
                  {data.subscription?.tier !== 'pro' && (
                    <Button className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white" onClick={subscribeToPro}>
                      <Star size={14} className="mr-1" fill="currentColor" />{t('partner.tier_upgrade')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
