import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getToken, clearToken } from '@/lib/token'

export function PartnerGuard({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState<boolean | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const checkPartner = async () => {
      const token = getToken()
      if (!token) { navigate('/login', { replace: true }); return }
      try {
        const res = await fetch('/api/partner/dashboard', { headers: { Authorization: `Bearer ${token}` } })
        if (res.status === 403) { navigate('/partner/register', { replace: true }); return }
        if (res.status === 401) { clearToken(); navigate('/login', { replace: true }); return }
        if (res.ok) { setAuthorized(true); return }
      } catch { /* fall through */ }
      setAuthorized(true)
    }
    checkPartner()
  }, [navigate])

  if (authorized === null) return null
  return <>{children}</>
}
