import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { ALL_TITLES, type TitleMetadata } from "./constants"
import type { Language } from "@/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getUserTitles(
  user: { match?: number; interests?: string[]; bio?: string } | null,
  language: Language,
): (TitleMetadata & { displayName: string })[] {
  if (!user) return []

  let bestTitleId = "rookie"

  if ((user.match ?? 0) >= 90) {
    bestTitleId = "king"
  } else if ((user.interests?.length ?? 0) >= 5) {
    bestTitleId = "party"
  } else if ((user.bio?.length ?? 0) > 20) {
    bestTitleId = "romantic"
  }

  const meta = ALL_TITLES.find((t) => t.id === bestTitleId)!
  return [{
    ...meta,
    displayName: language === "RU" ? meta.name_ru : meta.name_en,
  }]
}
