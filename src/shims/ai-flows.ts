// AI flows: real API calls with graceful fallbacks
import { getToken } from '@/lib/token';

const FALLBACK_SUGGESTIONS = [
  'Какое твое любимое хобби?',
  'Где ты любишь отдыхать?',
  'Какой фильм посоветуешь?',
];

type IcebreakerInput = {
  chatUserId?: number;
  userId?: number;
  chat_user_id?: number;
  language?: string;
};

export async function aiChatIcebreakerSuggestions(input?: IcebreakerInput): Promise<{ suggestions: string[] }> {
  const chatUserId = input?.chatUserId || input?.userId || input?.chat_user_id;
  const language = input?.language || (typeof localStorage !== 'undefined' && localStorage.getItem('lang')) || 'ru';
  try {
    const token = getToken();
    const res = await fetch('/api/icebreakers/suggest', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ chat_user_id: chatUserId, language }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        return { suggestions: data.suggestions };
      }
    }
  } catch { /* ignored */ }
  return { suggestions: FALLBACK_SUGGESTIONS };
}

export async function aiGenerateProfileBio(_input?: unknown): Promise<{ bio: string }> {
  return { bio: "" };
}
// Aliases used by some pages
export const generateIcebreakerSuggestions = aiChatIcebreakerSuggestions;
export const generateProfileBio = aiGenerateProfileBio;
export default {};