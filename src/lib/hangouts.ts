export const HANGOUT_CATEGORIES = [
  'cinema',
  'theater',
  'exhibition',
  'cafe',
  'concert',
  'sport',
  'other',
] as const

export const HANGOUT_TYPES = ['date', 'company'] as const

export type HangoutCategory = (typeof HANGOUT_CATEGORIES)[number]
export type HangoutType = (typeof HANGOUT_TYPES)[number]

export type HangoutStatus = 'active' | 'cancelled' | 'completed' | 'blocked'
export type HangoutResponseStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

export interface HangoutAuthor {
  display_name: string
  avatar_url: string | null
  age?: number
  online?: number | boolean
}

export interface HangoutResponse {
  id: number
  user_id: number
  status: HangoutResponseStatus
  message: string | null
  created_at: string
  display_name: string
  avatar_url: string | null
  age?: number
  city?: string | null
}

export interface HangoutParticipant {
  id: number
  user_id: number
  role: 'organizer' | 'member'
  status: 'joined' | 'left' | 'removed'
  joined_at: string
  display_name: string
  avatar_url: string | null
  age?: number
}

export interface Hangout {
  id: number
  author_id: number
  category: HangoutCategory
  hangout_type: HangoutType
  title: string
  description: string | null
  place_name: string | null
  place_address: string | null
  city: string | null
  lat: string | number | null
  lng: string | number | null
  event_date: string
  max_companions: number
  status: HangoutStatus
  created_at: string
  display_name?: string
  avatar_url?: string | null
  age?: number
  online?: number | boolean
  accepted_count?: number
  participant_count?: number
  like_count?: number
  my_like_status?: 'like' | 'skip' | null
  my_participant_status?: 'joined' | 'left' | 'removed' | null
  pending_count?: number
  distance_km?: number | null
  is_author?: boolean
  my_response_status?: HangoutResponseStatus | null
  chat_id?: number | null
  responses?: HangoutResponse[]
  participants?: HangoutParticipant[]
  offer_id?: number | null
  offer_title?: string | null
  offer_price?: string | number | null
  offer_image_url?: string | null
  offer_deeplink?: string | null
offer_category?: string | null
  offer_valid_to?: string | null
  price?: string | number | null
  capacity?: number | null
  sold_tickets?: number
  my_ticket_status?: 'pending' | 'paid' | 'refunded' | null
}

export interface MyHangoutResponse {
  id: number
  hangout_id: number
  response_status: HangoutResponseStatus
  message: string | null
  created_at: string
  category: HangoutCategory
  title: string
  description: string | null
  place_name: string | null
  city: string | null
  lat: string | number | null
  lng: string | number | null
  event_date: string
  max_companions: number
  hangout_status: HangoutStatus
  display_name: string
  avatar_url: string | null
}

export function formatEventDate(value: string): string {
  const d = new Date(value)
  if (isNaN(d.getTime())) return value
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
