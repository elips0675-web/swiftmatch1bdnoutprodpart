import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/context/language-context'
import { getToken } from '@/lib/token'
import { toast } from 'sonner'
import { ShieldCheck, ShieldAlert, Loader2, Upload, Check, Clock, X } from 'lucide-react'

interface VerificationStatus {
  verified: boolean
  submissions: { id: number; photo_url: string; status: string; created_at: string; reviewed_at: string | null }[]
}

export function VerificationBadge({ verified, className }: { verified: boolean; className?: string }) {
  const { t } = useLanguage()
  if (!verified) return null
  return (
    <Badge className={`bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:bg-emerald-500/20 dark:text-emerald-400 dark:border-emerald-700 text-[10px] font-bold ${className || ''}`}>
      <ShieldCheck size={10} className="mr-0.5" />{t('verification.badge')}
    </Badge>
  )
}

export function VerificationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage()
  const [status, setStatus] = useState<VerificationStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [photoUrl, setPhotoUrl] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const token = getToken()
    fetch('/api/profile/verification', { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setStatus(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open])

  const refreshStatus = async (token: string | null) => {
    const res = await fetch('/api/profile/verification', { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null)
    const payload = res?.ok ? await res.json().catch(() => null) : null
    if (payload) setStatus(payload)
  }

  const submit = async () => {
    if (!photoUrl.trim()) { toast.error(t('verification.photo_required')); return }
    setSubmitting(true)
    try {
      const token = getToken()
      const res = await fetch('/api/profile/verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ photo_url: photoUrl.trim() }),
      })
      if (!res.ok) {
        if (res.status === 409) {
          toast.error(t('verification.already_pending'))
          await refreshStatus(token)
        } else {
          toast.error(t('verification.submit_error'))
        }
        return
      }
      toast.success(t('verification.submitted'))
      setPhotoUrl('')
      await refreshStatus(token)
    } catch {
      toast.error(t('verification.submit_error'))
    } finally { setSubmitting(false) }
  }

  const statusIcon = (s: string) => {
    if (s === 'verified') return <Check size={12} className="text-emerald-500" />
    if (s === 'rejected') return <X size={12} className="text-destructive" />
    return <Clock size={12} className="text-muted-foreground" />
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" />{t('verification.title')}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" size={24} /></div>
        ) : (
          <div className="space-y-4">
            {status?.verified ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-300 dark:border-emerald-700">
                <ShieldCheck size={24} className="text-emerald-500 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{t('verification.verified_title')}</p>
                  <p className="text-xs text-muted-foreground">{t('verification.verified_desc')}</p>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('verification.description')}</p>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-muted-foreground uppercase tracking-widest block">{t('verification.photo_label')}</label>
                  <input
                    className="w-full rounded-xl border border-border bg-input/30 px-3 py-2 text-sm"
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    placeholder={t('verification.photo_placeholder')}
                  />
                  <p className="text-[10px] text-muted-foreground">{t('verification.photo_hint')}</p>
                </div>
                <Button className="w-full" onClick={submit} disabled={submitting || !photoUrl.trim()}>
                  {submitting ? <Loader2 size={14} className="animate-spin mr-1" /> : <Upload size={14} className="mr-1" />}
                  {t('verification.submit')}
                </Button>
              </>
            )}
            {status && status.submissions.length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2">{t('verification.history')}</p>
                <div className="space-y-1.5">
                  {status.submissions.map((s) => (
                    <div key={s.id} className="flex items-center gap-2 text-xs">
                      {statusIcon(s.status)}
                      <Badge variant="secondary" className="text-[10px]">{t(`verification.status_${s.status}`)}</Badge>
                      <span className="text-muted-foreground">{new Date(s.created_at).toLocaleDateString('ru-RU')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
