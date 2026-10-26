import { useEffect, useRef } from 'react'
import { getToken } from '@/lib/token'
import { refreshAuthToken } from '@/lib/auth-refresh'

const UPDATE_INTERVAL_MS = 5 * 60 * 1000
const MIN_DISPLACEMENT_M = 100
const EARTH_RADIUS_M = 6371000

type Coords = { latitude: number; longitude: number }

type CapacitorGlobal = { isNativePlatform?: () => boolean }

function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
  return capacitor?.isNativePlatform?.() === true
}

function distanceMeters(from: Coords, to: Coords): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180
  const deltaLat = toRadians(to.latitude - from.latitude)
  const deltaLng = toRadians(to.longitude - from.longitude)
  const startLat = toRadians(from.latitude)
  const endLat = toRadians(to.latitude)
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(deltaLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function putLocation(coords: Coords, token: string): Promise<Response> {
  return fetch('/api/location', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
  })
}

async function sendLocation(coords: Coords): Promise<boolean> {
  const token = getToken()
  if (!token) return false

  try {
    let response = await putLocation(coords, token)

    if (response.status === 401) {
      const refreshed = await refreshAuthToken()
      if (!refreshed) return false
      response = await putLocation(coords, refreshed)
    }

    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.log('[GPS] Update rejected:', response.status)
      }
      return false
    }

    if (import.meta.env.DEV) {
      console.log('[GPS] Location updated')
    }
    return true
  } catch {
    if (import.meta.env.DEV) {
      console.log('[GPS] Update failed')
    }
    return false
  }
}

export function useBackgroundGeolocation() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastSentRef = useRef<Coords | null>(null)

  useEffect(() => {
    const nativePlatform = isNativePlatform()
    let cancelled = false

    function stopPolling() {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    async function report(coords: Coords) {
      if (cancelled) return

      const lastSent = lastSentRef.current
      if (lastSent && distanceMeters(lastSent, coords) < MIN_DISPLACEMENT_M) return

      const sent = await sendLocation(coords)
      if (sent && !cancelled) {
        lastSentRef.current = coords
      }
    }

    async function readNativePosition() {
      try {
        const { Geolocation } = await import('@capacitor/geolocation')
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 10000,
        })
        if (cancelled || !position?.coords) return
        await report({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      } catch {
        if (import.meta.env.DEV) {
          console.log('[GPS] Update failed')
        }
      }
    }

    function readWebPosition(highAccuracy: boolean) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          void report({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          })
        },
        (error) => {
          if (error?.code === 1) {
            stopPolling()
          }
          if (import.meta.env.DEV) {
            console.log('[GPS] Update failed')
          }
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: highAccuracy ? 10000 : 15000,
          maximumAge: 300000,
        },
      )
    }

    if (nativePlatform) {
      intervalRef.current = setInterval(() => {
        void readNativePosition()
      }, UPDATE_INTERVAL_MS)
      void readNativePosition()
    } else if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      intervalRef.current = setInterval(() => {
        readWebPosition(false)
      }, UPDATE_INTERVAL_MS)
      readWebPosition(true)
    }

    return () => {
      cancelled = true
      stopPolling()
    }
  }, [])
}
