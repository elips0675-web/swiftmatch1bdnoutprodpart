import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { getImpersonatedUser, isImpersonating, stopImpersonation } from '@/lib/impersonation'

export function ImpersonationBanner() {
  const { t } = useLanguage()
  if (!isImpersonating()) return null
  const user = getImpersonatedUser()
  const handleReturn = () => {
    if (stopImpersonation()) window.location.href = '/admin/users'
  }
  return (
    <div data-testid="impersonation-banner" className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-lg">
      <Eye size={14} />
      <span>{t('admin.impersonate.banner', { name: user?.name ?? String(user?.id ?? '') })}</span>
      <Button size="sm" variant="outline" data-testid="impersonation-return" className="h-6 rounded-lg border-white/40 bg-white/20 text-white hover:bg-white/30" onClick={handleReturn}>
        {t('admin.impersonate.return')}
      </Button>
    </div>
  )
}
