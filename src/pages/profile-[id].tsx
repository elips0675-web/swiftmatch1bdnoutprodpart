import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function ProfileById() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (id) {
      navigate(`/user?id=${encodeURIComponent(id)}`, { replace: true })
    }
  }, [id, navigate])

  return null
}
