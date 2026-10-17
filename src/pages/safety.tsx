import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '@/context/language-context'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Clock, Plus, Trash2, ShieldCheck, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface EmergencyContact {
  id: number
  name: string
  phone: string | null
  email: string | null
  relation: string | null
}

interface CheckIn {
  id: number
  checkin_at: string
  message: string | null
  status: string
  contact_name: string | null
  contact_phone: string | null
}

export default function SafetyPage() {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [checkins, setCheckins] = useState<CheckIn[]>([])
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [relation, setRelation] = useState('')
  const [checkinMinutes, setCheckinMinutes] = useState(60)
  const [contactId, setContactId] = useState<number | null>(null)
  const [message, setMessage] = useState('')

  const loadData = useCallback(async () => {
    try {
      const [cRes, chRes] = await Promise.all([
        fetch('/api/checkin/contacts'),
        fetch('/api/checkin/active')
      ])
      if (cRes.ok) setContacts(await cRes.json())
      if (chRes.ok) setCheckins(await chRes.json())
    } catch { /* ignored */ }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const addContact = async () => {
    if (!name || name.trim().length < 2) return
    const res = await fetch('/api/checkin/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), phone, email, relation })
    })
    if (res.ok) {
      setName(''); setPhone(''); setEmail(''); setRelation('')
      setShowForm(false)
      loadData()
    }
  }

  const deleteContact = async (id: number) => {
    const res = await fetch(`/api/checkin/contacts/${id}`, { method: 'DELETE' })
    if (res.ok) loadData()
  }

  const startCheckin = async () => {
    if (!contactId) return
    const res = await fetch('/api/checkin/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: contactId, checkin_minutes: checkinMinutes, message })
    })
    if (res.ok) {
      setMessage('')
      loadData()
    }
  }

  const confirmCheckin = async (id: number) => {
    const res = await fetch(`/api/checkin/${id}/checkin`, { method: 'POST' })
    if (res.ok) loadData()
  }

  const cancelCheckin = async (id: number) => {
    const res = await fetch(`/api/checkin/${id}/cancel`, { method: 'POST' })
    if (res.ok) loadData()
  }

  const statusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      active: 'default',
      checked_in: 'secondary',
      missed: 'destructive',
      cancelled: 'outline'
    }
    return <Badge variant={variants[status] || 'outline'}>{t(`safety.status.${status}`)}</Badge>
  }

  const timeLeft = (checkinAt: string) => {
    const diff = new Date(checkinAt).getTime() - Date.now()
    if (diff <= 0) return t('safety.expired')
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return `${h}ч ${m}м`
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-8 h-8 text-primary" />
        <h1 className="text-2xl font-bold">{t('safety.title')}</h1>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('safety.emergency_contacts')}</CardTitle>
          <Button size="sm" onClick={() => setShowForm(!showForm)} data-testid="add-contact-button">
            <Plus className="w-4 h-4 mr-1" /> {t('safety.add_contact')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {showForm && (
            <div className="space-y-2 p-3 border rounded-lg">
              <Input placeholder={t('safety.contact_name')} value={name} onChange={e => setName(e.target.value)} />
              <Input placeholder={t('safety.contact_phone')} value={phone} onChange={e => setPhone(e.target.value)} />
              <Input placeholder={t('safety.contact_email')} value={email} onChange={e => setEmail(e.target.value)} />
              <Input placeholder={t('safety.contact_relation')} value={relation} onChange={e => setRelation(e.target.value)} />
              <Button onClick={addContact} disabled={name.trim().length < 2} data-testid="save-contact-button">{t('safety.save_contact')}</Button>
            </div>
          )}
          {contacts.length === 0 && <p className="text-muted-foreground text-sm">{t('safety.no_contacts')}</p>}
          {contacts.map(c => (
            <div key={c.id} className="flex items-center justify-between p-2 border rounded">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-muted-foreground">{c.phone || c.email || c.relation}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => deleteContact(c.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('safety.start_checkin')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            aria-label={t('safety.select_contact')}
            value={contactId || ''}
            onChange={e => setContactId(Number(e.target.value))}
          >
            <option value="">{t('safety.select_contact')}</option>
            {contacts.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            {[15, 30, 60, 120, 240].map(m => (
              <Button
                key={m}
                variant={checkinMinutes === m ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCheckinMinutes(m)}
              >
                {m >= 60 ? `${m / 60}ч` : `${m}м`}
              </Button>
            ))}
          </div>
          <Input
            placeholder={t('safety.checkin_message')}
            value={message}
            onChange={e => setMessage(e.target.value)}
          />
          <Button onClick={startCheckin} disabled={!contactId} data-testid="start-checkin-button">
            <Clock className="w-4 h-4 mr-1" /> {t('safety.start_checkin_btn')}
          </Button>
        </CardContent>
      </Card>

      {checkins.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('safety.active_checkins')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {checkins.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {statusBadge(c.status)}
                    <span className="text-sm text-muted-foreground">
                      <Clock className="w-3 h-3 inline mr-1" />
                      {c.status === 'active' ? timeLeft(c.checkin_at) : new Date(c.checkin_at).toLocaleString()}
                    </span>
                  </div>
                  {c.contact_name && <p className="text-sm">{c.contact_name}</p>}
                </div>
                <div className="flex gap-2">
                  {c.status === 'active' && (
                    <>
                      <Button size="sm" variant="default" onClick={() => confirmCheckin(c.id)} data-testid="checkin-now-button">
                        <CheckCircle2 className="w-4 h-4 mr-1" /> {t('safety.checkin_now')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => cancelCheckin(c.id)}>
                        {t('safety.cancel')}
                      </Button>
                    </>
                  )}
                  {c.status === 'missed' && <AlertTriangle className="w-5 h-5 text-destructive" />}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
