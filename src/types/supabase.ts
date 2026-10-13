export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: ProfileInsert
        Update: ProfileUpdate
        Relationships: []
      }
      matches: {
        Row: MatchRow
        Insert: MatchInsert
        Update: Record<string, never>
        Relationships: []
      }
      chats: {
        Row: ChatRow
        Insert: ChatInsert
        Update: Record<string, never>
        Relationships: []
      }
      chat_participants: {
        Row: ChatParticipantRow
        Insert: ChatParticipantInsert
        Update: Record<string, never>
        Relationships: []
      }
      messages: {
        Row: MessageRow
        Insert: MessageInsert
        Update: Record<string, never>
        Relationships: []
      }
      notifications: {
        Row: NotificationRow
        Insert: NotificationInsert
        Update: Record<string, never>
        Relationships: []
      }
      interests: {
        Row: InterestRow
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
      profile_interests: {
        Row: ProfileInterestRow
        Insert: ProfileInterestInsert
        Update: Record<string, never>
        Relationships: []
      }
      likes: {
        Row: LikeRow
        Insert: LikeInsert
        Update: Record<string, never>
        Relationships: []
      }
      reports: {
        Row: ReportRow
        Insert: ReportInsert
        Update: Record<string, never>
        Relationships: []
      }
      feature_flags: {
        Row: FeatureFlagRow
        Insert: Record<string, never>
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: {
      user_search: {
        Row: UserSearchRow
        Relationships: []
      }
    }
    Functions: {
      calculate_match_score: {
        Args: { profile_id: number; target_id: number }
        Returns: number
      }
      get_nearby_users: {
        Args: { lat: number; lng: number; radius_km: number }
        Returns: ProfileRow[]
      }
    }
  }
}

export type ProfileRow = {
  id: string
  created_at: string
  updated_at: string
  name: string
  age: number
  bio: string | null
  avatar_url: string | null
  photos: string[]
  gender: string | null
  looking_for: string | null
  goal: string | null
  role: string | null
  height: number | null
  city: string | null
  lat: number | null
  lng: number | null
  zodiac: string | null
  circadian: string | null
  attachment_style: string | null
  super_likes: number
  boost_until: string | null
  online: boolean
  last_seen: string
}

export type ProfileInsert = {
  id: string
  name: string
  age: number | null
  bio?: string
  avatar_url?: string
  photos?: string[]
  gender?: string
  looking_for?: string
  goal?: string
  height?: number | null
  city?: string
  lat?: number
  lng?: number
  zodiac?: string
  circadian?: string
  attachment_style?: string
  super_likes?: number
  boost_until?: string
}

export type ProfileUpdate = {
  name?: string
  age?: number
  bio?: string
  avatar_url?: string
  photos?: string[]
  gender?: string
  looking_for?: string
  goal?: string
  role?: string
  height?: number
  city?: string
  lat?: number
  lng?: number
  zodiac?: string
  circadian?: string
  attachment_style?: string
  super_likes?: number
  boost_until?: string
  online?: boolean
  last_seen?: string
}

export type MatchRow = {
  id: string
  created_at: string
  user1_id: string
  user2_id: string
  matched: boolean
}

export type MatchInsert = {
  user1_id: string
  user2_id: string
  matched?: boolean
}

export type ChatRow = {
  id: string
  created_at: string
  updated_at: string
  last_message: string | null
  last_sender_id: string | null
}

export type ChatInsert = {
  id?: string
}

export type ChatParticipantRow = {
  chat_id: string
  profile_id: string
  joined_at: string
}

export type ChatParticipantInsert = {
  chat_id: string
  profile_id: string
}

export type MessageRow = {
  id: string
  created_at: string
  chat_id: string
  sender_id: string
  text: string
  reply_to: string | null
}

export type MessageInsert = {
  chat_id: string
  sender_id: string
  text: string
  reply_to?: string | null
}

export type NotificationRow = {
  id: string
  created_at: string
  profile_id: string
  type: string
  payload: Record<string, unknown>
  read: boolean
}

export type NotificationInsert = {
  profile_id: string
  type: string
  payload?: Record<string, unknown>
  read?: boolean
}

export type InterestRow = {
  id: number
  name_ru: string
  name_en: string
  category: string
}

export type ProfileInterestRow = {
  profile_id: string
  interest_id: number
}

export type ProfileInterestInsert = {
  profile_id: string
  interest_id: number
}

export type LikeRow = {
  id: string
  created_at: string
  from_profile_id: string
  to_profile_id: string
  type: 'like' | 'super_like'
}

export type LikeInsert = {
  from_profile_id: string
  to_profile_id: string
  type: 'like' | 'super_like'
}

export type ReportRow = {
  id: string
  created_at: string
  reporter_id: string
  reported_id: string
  reason: string
  description: string | null
  status: 'pending' | 'resolved' | 'dismissed'
}

export type ReportInsert = {
  reporter_id: string
  reported_id: string
  reason: string
  description?: string
}

export type FeatureFlagRow = {
  id: number
  video_calls_enabled: boolean
  ai_icebreakers_enabled: boolean
  ai_compatibility_enabled: boolean
  groups_page_enabled: boolean
  contest_enabled: boolean
  show_ads: boolean
  autosearch_enabled: boolean
  hangouts_enabled: boolean
  partner_offers_enabled: boolean
  profile_activity_enabled: boolean
  b2b_marketplace_enabled: boolean
  opening_lines_enabled: boolean
  rollout_percent: number
  updated_at: string
}

export type UserSearchRow = {
  id: string
  name: string
  age: number
  avatar_url: string | null
  bio: string | null
  city: string | null
  goal: string | null
  zodiac: string | null
  interests: string[]
  match_score: number
  distance_km: number
}