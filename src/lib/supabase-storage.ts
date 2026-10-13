import { getSupabase } from './supabase'

export async function uploadPhoto(
  bucket: string,
  path: string,
  file: File,
): Promise<string | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) {
    if (import.meta.env.DEV) console.error('Upload error:', error.message)
    return null
  }
  const { data: url } = supabase.storage.from(bucket).getPublicUrl(path)
  return url.publicUrl
}

export async function uploadProfilePhoto(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()
  const path = `profiles/${crypto.randomUUID()}.${ext}`
  return uploadPhoto('photos', path, file)
}

export async function uploadGalleryPhoto(
  profileId: string,
  file: File,
): Promise<string | null> {
  const ext = file.name.split('.').pop()
  const path = `gallery/${profileId}/${crypto.randomUUID()}.${ext}`
  return uploadPhoto('photos', path, file)
}

export async function uploadMessagePhoto(file: File): Promise<string | null> {
  const ext = file.name.split('.').pop()
  const path = `messages/${crypto.randomUUID()}.${ext}`
  return uploadPhoto('photos', path, file)
}

export async function deletePhoto(path: string): Promise<boolean> {
  const supabase = getSupabase()
  if (!supabase) return false
  const { error } = await supabase.storage.from('photos').remove([path])
  return !error
}
