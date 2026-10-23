import { BANNED_WORDS } from "@/lib/constants";

export const INTEREST_KEY_TO_ID: Record<string, number> = {
  'interest.sport': 1, 'interest.music': 2, 'interest.movies': 3, 'interest.books': 4,
  'interest.travel': 5, 'interest.cooking': 6, 'interest.games': 7, 'interest.art': 8,
  'interest.photography': 9, 'interest.tech': 10, 'interest.fashion': 11, 'interest.dance': 12,
  'interest.animals': 13, 'interest.volunteering': 14, 'interest.politics': 15,
  'interest.psychology': 16, 'interest.philosophy': 17, 'interest.yoga': 18,
  'interest.meditation': 19, 'interest.gardening': 20, 'interest.cars': 21,
  'interest.science': 22, 'interest.history': 23, 'interest.architecture': 24,
  'interest.pets': 25,
  'interest.coffee': 26, 'interest.diy': 27, 'interest.extreme': 28,
  'interest.films': 29, 'interest.food': 30, 'interest.hiking': 31,
  'interest.martial_arts': 32, 'interest.podcasts': 33,
  'interest.gaming': 7, 'interest.dancing': 12, 'interest.reading': 4, 'interest.technology': 10,
  'interest.astronomy': 34, 'interest.board_games': 35, 'interest.nature': 36,
  'interest.design': 37,
};

export const NAME_TO_KEY: Record<string, string> = {
  'Спорт': 'interest.sport', 'Музыка': 'interest.music', 'Фотография': 'interest.photography',
  'Путешествия': 'interest.travel', 'Кофе': 'interest.coffee', 'Искусство': 'interest.art',
  'Кино': 'interest.movies', 'Йога': 'interest.yoga', 'Бизнес': 'interest.business',
  'Игры': 'interest.games', 'Кошки': 'interest.animals', 'Чтение': 'interest.books',
  'Кулинария': 'interest.cooking', 'Творчество': 'interest.art', 'Природа': 'interest.nature',
  'Рукоделие': 'interest.diy', 'Дизайн': 'interest.design', 'Мода': 'interest.fashion',
  'Танцы': 'interest.dance', 'Технологии': 'interest.tech', 'Волонтерство': 'interest.volunteering',
  'Политика': 'interest.politics', 'Психология': 'interest.psychology', 'Философия': 'interest.philosophy',
  'Медитация': 'interest.meditation', 'Садоводство': 'interest.gardening', 'Автомобили': 'interest.cars',
  'Наука': 'interest.science', 'История': 'interest.history', 'Архитектура': 'interest.architecture',
  'Животные': 'interest.animals', 'Экстрим': 'interest.extreme', 'Фильмы': 'interest.films',
  'Еда': 'interest.food', 'Походы': 'interest.hiking', 'Единоборства': 'interest.martial_arts',
  'Подкасты': 'interest.podcasts', 'Питомцы': 'interest.pets',
  'Своими руками': 'interest.diy', 'Астрономия': 'interest.astronomy', 'Настольные игры': 'interest.board_games',
  'Sports': 'interest.sport', 'Music': 'interest.music', 'Photography': 'interest.photography',
  'Travel': 'interest.travel', 'Coffee': 'interest.coffee', 'Art': 'interest.art',
  'Movies': 'interest.movies', 'Yoga': 'interest.yoga', 'Business': 'interest.business',
  'Gaming': 'interest.games', 'Cats': 'interest.animals', 'Books': 'interest.books',
  'Cooking': 'interest.cooking', 'Nature': 'interest.nature', 'Design': 'interest.design',
  'Fashion': 'interest.fashion', 'Dance': 'interest.dance',
  'Tech': 'interest.tech', 'Animals': 'interest.animals', 'Volunteering': 'interest.volunteering',
  'Politics': 'interest.politics', 'Psychology': 'interest.psychology', 'Philosophy': 'interest.philosophy',
  'Meditation': 'interest.meditation', 'Gardening': 'interest.gardening', 'Cars': 'interest.cars',
  'Science': 'interest.science', 'History': 'interest.history', 'Architecture': 'interest.architecture',
  'Sport': 'interest.sport', 'Pets': 'interest.pets',
  'DIY': 'interest.diy', 'Extreme': 'interest.extreme', 'Films': 'interest.films',
  'Food': 'interest.food', 'Hiking': 'interest.hiking', 'Martial Arts': 'interest.martial_arts',
  'Podcasts': 'interest.podcasts',
  'Astronomy': 'interest.astronomy', 'Board Games': 'interest.board_games',
}

type InterestLike = { name_ru?: string | null; name_en?: string | null }

export function normalizeObjectInterests(interests: unknown): string[] {
  if (!Array.isArray(interests)) return []
  return [...new Set(interests.map((item: unknown) => {
    if (typeof item === 'string') return item === 'interest.technology' ? 'interest.tech' : item
    const i = item as InterestLike
    const name = i.name_ru && !/^\?+$/.test(i.name_ru) ? i.name_ru : i.name_en
    if (!name) return ''
    return NAME_TO_KEY[name] || name
  }))].filter((i: string) => i && !BANNED_WORDS.includes(i))
}
