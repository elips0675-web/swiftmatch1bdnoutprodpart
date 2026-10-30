import { PlaceHolderImages } from "./placeholder-images";

const futureDate = new Date(new Date().getTime() + 24 * 60 * 60 * 1000).toISOString();

export const POLL_QUESTIONS = [
  { id: 'coffee_tea', options: 3 },
  { id: 'cat_dog', options: 3 },
  { id: 'morning_night', options: 2 },
  { id: 'pizza_sushi', options: 3 },
  { id: 'sea_mountains', options: 2 },
  { id: 'movies_series', options: 2 },
  { id: 'book_film', options: 3 },
  { id: 'marvel_dc', options: 3 },
];

function generatePollAnswers(seed: number): Record<string, number> {
  const answers: Record<string, number> = {};
  POLL_QUESTIONS.forEach((q, i) => {
    answers[q.id] = (seed + i * 7) % q.options;
  });
  return answers;
}

export type DemoUser = {
  id: number;
  name: string;
  age: number;
  img: string;
  hint: string;
  online: boolean;
  distance: number;
  match: number;
  city: string;
  zodiac: string;
  interests: string[];
  bio?: string;
  height: number;
  goal: string;
  gender: string;
  lookingFor: string;
  superLikes: number;
  boost: { boostedUntil: string | null };
  circadian: string;
};

export type DemoGroupSubcategory = {
  id: number;
  name_ru: string;
  name_en: string;
  members: number;
  online: number;
  href?: string;
};

export type DemoGroupCategory = {
  id: string;
  name_ru: string;
  name_en: string;
  icon: string;
  img: string;
  hint: string;
  subgroups: DemoGroupSubcategory[];
};

const BASE_USERS: DemoUser[] = [
  { id: 2, name: 'Анна', age: 24, img: '/demo/people/anna.png', hint: 'woman portrait', online: true, distance: 2, match: 87, city: 'Москва', zodiac: 'common.zodiac.leo', interests: ['interest.photography', 'interest.travel', 'interest.coffee', 'interest.music', 'interest.sport'], bio: 'Люблю закаты, хороший кофе и интересные разговоры.', height: 172, goal: 'goal.serious_relationship', gender: 'female', lookingFor: 'male', superLikes: 5, boost: { boostedUntil: futureDate }, circadian: 'lark' },
  
  // 10 Men for Anna (Москва, совпадающие интересы и цели)
  { id: 3, name: 'Александр', age: 26, img: '/demo/people/maxim.png', hint: 'man portrait', online: true, distance: 3, match: 95, city: 'Москва', zodiac: 'common.zodiac.aries', interests: ['interest.travel', 'interest.coffee', 'interest.sport'], bio: 'Всегда в движении. Ищу ту, кто разделит мою страсть к горам и кофе.', height: 185, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'owl' },
  { id: 5, name: 'Михаил', age: 28, img: '/demo/people/ivan.png', hint: 'man portrait', online: false, distance: 5, match: 89, city: 'Москва', zodiac: 'common.zodiac.scorpio', interests: ['interest.music', 'interest.coffee', 'interest.photography'], bio: 'Играю на гитаре, варю лучший эспрессо. Давай сходим на концерт?', height: 182, goal: 'goal.dating', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'owl' },
  { id: 7, name: 'Артем', age: 25, img: '/demo/people/artem.png', hint: 'man portrait', online: true, distance: 4, match: 84, city: 'Москва', zodiac: 'common.zodiac.gemini', interests: ['interest.sport', 'interest.music', 'interest.travel'], bio: 'Кодю днем, бегаю вечером. Люблю умные разговоры.', height: 178, goal: 'goal.new_friends', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 9, name: 'Иван', age: 27, img: '/demo/people/ivan.png', hint: 'man portrait', online: false, distance: 8, match: 91, city: 'Москва', zodiac: 'common.zodiac.sagittarius', interests: ['interest.photography', 'interest.travel', 'interest.sport'], bio: 'Пейзажный фотограф. Мечтаю о поездке в Исландию.', height: 188, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'owl' },
  { id: 11, name: 'Никита', age: 30, img: '/demo/people/maxim.png', hint: 'man portrait', online: false, distance: 6, match: 78, city: 'Москва', zodiac: 'common.zodiac.aquarius', interests: ['interest.coffee', 'interest.music', 'interest.photography'], bio: 'Ценю искренность и хороший юмор. Люблю открывать новые кофейни.', height: 180, goal: 'goal.just_talk', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 12, name: 'Дмитрий', age: 32, img: '/demo/people/maxim.png', hint: 'man portrait', online: true, distance: 2, match: 92, city: 'Москва', zodiac: 'common.zodiac.taurus', interests: ['interest.sport', 'interest.coffee', 'interest.travel'], bio: 'Люблю активный отдых и продуктивные утра. Ищу серьезные отношения.', height: 184, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 13, name: 'Максим', age: 29, img: '/demo/people/maxim.png', hint: 'man fashion', online: false, distance: 4, match: 86, city: 'Москва', zodiac: 'common.zodiac.capricorn', interests: ['interest.music', 'interest.photography', 'interest.sport'], bio: 'Меломан и эстет. Люблю находить красоту в мелочах.', height: 179, goal: 'goal.dating', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'owl' },
  { id: 14, name: 'Андрей', age: 31, img: '/demo/people/ivan.png', hint: 'man professional', online: true, distance: 7, match: 83, city: 'Москва', zodiac: 'common.zodiac.libra', interests: ['interest.travel', 'interest.coffee', 'interest.music'], bio: 'Архитектор. Ищу вдохновение и интересного собеседника.', height: 181, goal: 'goal.new_friends', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 15, name: 'Игорь', age: 24, img: '/demo/people/artem.png', hint: 'man fitness', online: true, distance: 1, match: 94, city: 'Москва', zodiac: 'common.zodiac.cancer', interests: ['interest.sport', 'interest.photography', 'interest.travel'], bio: 'Жизнь — это приключение. Давай напишем свою историю вместе?', height: 176, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'owl' },
  { id: 16, name: 'Виктор', age: 35, img: '/demo/people/ivan.png', hint: 'man intellectual', online: false, distance: 9, match: 81, city: 'Москва', zodiac: 'common.zodiac.virgo', interests: ['interest.coffee', 'interest.music', 'interest.sport'], bio: 'Спокойный, надежный, ценю уют и хороший джаз.', height: 183, goal: 'goal.dating', gender: 'male', lookingFor: 'female', superLikes: 0, boost: { boostedUntil: null }, circadian: 'lark' },

  // Other Women
  { id: 4, name: 'Елена', age: 26, img: '/demo/people/elena.png', hint: 'woman portrait', online: false, distance: 3, match: 81, city: 'Москва', zodiac: 'common.zodiac.pisces', interests: ['interest.art', 'interest.books', 'interest.cooking'], bio: 'Ищу кого-то, кто любит музеи и долгие прогулки.', height: 168, goal: 'goal.dating', gender: 'female', lookingFor: 'male', superLikes: 0, boost: { boostedUntil: null }, circadian: 'owl' },
  { id: 6, name: 'София', age: 22, img: '/demo/people/sophia.png', hint: 'woman portrait', online: true, distance: 7, match: 88, city: 'Москва', zodiac: 'common.zodiac.virgo', interests: ['interest.music', 'interest.art', 'interest.photography'], bio: 'Мечтаю собрать свою группу и объехать мир.', height: 165, goal: 'goal.just_talk', gender: 'female', lookingFor: 'male', superLikes: 0, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 8, name: 'Мария', age: 29, img: '/demo/people/anna.png', hint: 'woman portrait', online: true, distance: 1, match: 94, city: 'Москва', zodiac: 'common.zodiac.scorpio', interests: ['interest.yoga', 'interest.nature', 'interest.travel'], bio: 'Люблю готовить полезную еду и ходить в походы.', height: 170, goal: 'goal.serious_relationship', gender: 'female', lookingFor: 'male', superLikes: 0, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 10, name: 'Ксения', age: 23, img: '/demo/people/sophia.png', hint: 'woman portrait', online: true, distance: 6, match: 83, city: 'Москва', zodiac: 'common.zodiac.capricorn', interests: ['interest.fashion', 'interest.design', 'interest.art'], bio: 'Жизнь слишком коротка, чтобы носить скучную одежду.', height: 174, goal: 'goal.serious_relationship', gender: 'female', lookingFor: 'male', superLikes: 0, boost: { boostedUntil: null }, circadian: 'owl' },

  // 5 идеальных кандидатов для Анны (Автопоиск)
  { id: 19, name: 'Егор', age: 25, img: '/demo/people/maxim.png', hint: 'man portrait', online: true, distance: 2, match: 97, city: 'Москва', zodiac: 'common.zodiac.sagittarius', interests: ['interest.photography', 'interest.travel', 'interest.coffee', 'interest.music'], bio: 'Фотограф-путешественник. Ищу музу для совместных приключений и уютных вечеров с кофе.', height: 183, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 3, boost: { boostedUntil: futureDate }, circadian: 'lark' },
  { id: 20, name: 'Тимур', age: 26, img: '/demo/people/artem.png', hint: 'man fitness', online: true, distance: 4, match: 96, city: 'Москва', zodiac: 'common.zodiac.leo', interests: ['interest.sport', 'interest.music', 'interest.travel', 'interest.photography'], bio: 'Фитнес-тренер и меломан. Утро начинаю с пробежки, вечер — с гитары. Ищу вторую половинку.', height: 186, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 2, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 21, name: 'Даниил', age: 27, img: '/demo/people/ivan.png', hint: 'man portrait', online: true, distance: 3, match: 95, city: 'Москва', zodiac: 'common.zodiac.taurus', interests: ['interest.coffee', 'interest.travel', 'interest.sport', 'interest.music'], bio: 'Бариста и путешественник. Варю лучший кофе в городе. Мечтаю объехать всю Европу на машине.', height: 180, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 1, boost: { boostedUntil: null }, circadian: 'lark' },
  { id: 22, name: 'Матвей', age: 24, img: '/demo/people/artem.png', hint: 'man fitness', online: true, distance: 5, match: 98, city: 'Москва', zodiac: 'common.zodiac.gemini', interests: ['interest.music', 'interest.sport', 'interest.photography', 'interest.travel'], bio: 'Музыкант и спортсмен. Играю в группе, бегаю марафоны. Ищу девушку, с которой будет не скучно.', height: 177, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 4, boost: { boostedUntil: futureDate }, circadian: 'lark' },
  { id: 23, name: 'Роман', age: 28, img: '/demo/people/ivan.png', hint: 'man portrait', online: false, distance: 1, match: 93, city: 'Москва', zodiac: 'common.zodiac.libra', interests: ['interest.photography', 'interest.music', 'interest.coffee', 'interest.travel'], bio: 'Программист в душе и романтик в сердце. Люблю закаты, джаз и долгие прогулки. Ищу серьёзные отношения.', height: 184, goal: 'goal.serious_relationship', gender: 'male', lookingFor: 'female', superLikes: 2, boost: { boostedUntil: null }, circadian: 'lark' }
];

export const ALL_DEMO_USERS = BASE_USERS.map(u => ({ ...u, pollAnswers: generatePollAnswers(u.id) }));

export const TOP_OF_THE_WEEK = [
  { id: 'top1', name_ru: 'Клуб любителей котиков', name_en: 'Cat Lovers Club', members: 12345, img: 'https://picsum.photos/seed/top_week_1/600/400' },
  { id: 'top2', name_ru: 'Обсуждаем кино', name_en: 'Movie Discussions', members: 8765, img: 'https://picsum.photos/seed/top_week_2/600/400' },
  { id: 'top3', name_ru: 'Путешествия на выходные', name_en: 'Weekend Travelers', members: 7654, img: 'https://picsum.photos/seed/top_week_3/600/400' },
  { id: 'top4', name_ru: 'React-разработчики', name_en: 'React Developers', members: 6543, img: 'https://picsum.photos/seed/top_week_4/600/400' },
];

export const GROUP_CATEGORIES: DemoGroupCategory[] = [
  {
    id: 'music', name_ru: 'Музыка', name_en: 'Music', icon: 'Music', img: 'https://picsum.photos/seed/cat_music/600/400', hint: 'concert crowd',
    subgroups: [
      { id: 101, name_ru: 'Хип-хоп', name_en: 'Hip-hop', members: 150, online: 25 }, { id: 102, name_ru: 'Рок', name_en: 'Rock', members: 200, online: 40 },
      { id: 103, name_ru: 'Электроника', name_en: 'Electronic', members: 180, online: 30 }, { id: 104, name_ru: 'Джаз & Блюз', name_en: 'Jazz & Blues', members: 80, online: 10 },
      { id: 105, name_ru: 'Классика', name_en: 'Classical', members: 60, online: 5 }, { id: 106, name_ru: 'Инди', name_en: 'Indie', members: 120, online: 20 },
      { id: 107, name_ru: 'Поп', name_en: 'Pop', members: 300, online: 50 }, { id: 108, name_ru: 'Метал', name_en: 'Metal', members: 90, online: 15 },
      { id: 109, name_ru: 'K-Pop', name_en: 'K-Pop', members: 250, online: 60 }, { id: 110, name_ru: 'Авторская песня', name_en: 'Bard Song', members: 70, online: 8 },
      { id: 111, name_ru: 'Техно', name_en: 'Techno', members: 160, online: 28 }, { id: 112, name_ru: 'R&B / Соул', name_en: 'R&B / Soul', members: 130, online: 22 },
      { id: 113, name_ru: 'Фолк', name_en: 'Folk', members: 50, online: 7 }, { id: 114, name_ru: 'Саундтреки', name_en: 'Soundtracks', members: 110, online: 18 },
      { id: 115, name_ru: 'Reggae', name_en: 'Reggae', members: 85, online: 14 }, { id: 116, name_ru: 'Кантри', name_en: 'Country', members: 40, online: 4 },
      { id: 117, name_ru: 'Панк-рок', name_en: 'Punk Rock', members: 95, online: 17 }, { id: 118, name_ru: 'Хаус', name_en: 'House', members: 140, online: 26 },
      { id: 119, name_ru: 'Транс', name_en: 'Trance', members: 135, online: 24 }, { id: 120, name_ru: 'Амбиент', name_en: 'Ambient', members: 75, online: 9 },
    ]
  },
  {
    id: 'sports', name_ru: 'Спорт', name_en: 'Sports', icon: 'Dumbbell', img: 'https://picsum.photos/seed/cat_sports/600/400', hint: 'stadium sports',
    subgroups: [
      { id: 201, name_ru: 'Футбол', name_en: 'Football', members: 400, online: 80, href: '/groups/football' }, { id: 202, name_ru: 'Баскетбол', name_en: 'Basketball', members: 250, online: 50 },
      { id: 203, name_ru: 'Бег', name_en: 'Running', members: 180, online: 35 }, { id: 204, name_ru: 'Йога', name_en: 'Yoga', members: 300, online: 60 },
      { id: 205, name_ru: 'Плавание', name_en: 'Swimming', members: 150, online: 20 }, { id: 206, name_ru: 'Боевые искусства', name_en: 'Martial Arts', members: 120, online: 25 },
      { id: 207, name_ru: 'Теннис', name_en: 'Tennis', members: 100, online: 15 }, { id: 208, name_ru: 'Велоспорт', name_en: 'Cycling', members: 130, online: 18 },
      { id: 209, name_ru: 'Зимние виды', name_en: 'Winter Sports', members: 90, online: 12 }, { id: 210, name_ru: 'Шахматы', name_en: 'Chess', members: 70, online: 10 },
      { id: 211, name_ru: 'Хоккей', name_en: 'Hockey', members: 190, online: 38 }, { id: 212, name_ru: 'Волейбол', name_en: 'Volleyball', members: 160, online: 30 },
      { id: 213, name_ru: 'Фитнес и тренажерка', name_en: 'Fitness & Gym', members: 350, online: 70 }, { id: 214, name_ru: 'Автоспорт', name_en: 'Motorsport', members: 110, online: 22 },
      { id: 215, name_ru: 'Скейтбординг', name_en: 'Skateboarding', members: 80, online: 16 }, { id: 216, name_ru: 'Настольный теннис', name_en: 'Table Tennis', members: 95, online: 19 },
      { id: 217, name_ru: 'Гольф', name_en: 'Golf', members: 50, online: 5 }, { id: 218, name_ru: 'Конный спорт', name_en: 'Equestrian', members: 60, online: 8 },
      { id: 219, name_ru: 'Сёрфинг', name_en: 'Surfing', members: 40, online: 6 }, { id: 220, name_ru: 'Скалолазание', name_en: 'Climbing', members: 75, online: 14 },
    ]
  },
  {
    id: 'creativity', name_ru: 'Творчество', name_en: 'Creativity', icon: 'Palette', img: 'https://picsum.photos/seed/cat_creativity/600/400', hint: 'art supplies',
    subgroups: [
      { id: 301, name_ru: 'Рисование', name_en: 'Drawing', members: 220, online: 45 }, { id: 302, name_ru: 'Фотография', name_en: 'Photography', members: 350, online: 70 },
      { id: 303, name_ru: 'UI/UX Дизайн', name_en: 'UI/UX Design', members: 280, online: 60 }, { id: 304, name_ru: 'Писательство', name_en: 'Writing', members: 150, online: 25 },
      { id: 305, name_ru: 'Рукоделие', name_en: 'Crafts', members: 180, online: 30 }, { id: 306, name_ru: 'Скульптура', name_en: 'Sculpture', members: 50, online: 8 },
      { id: 307, name_ru: 'Каллиграфия', name_en: 'Calligraphy', members: 90, online: 15 }, { id: 308, name_ru: 'Актерское мастерство', name_en: 'Acting', members: 110, online: 20 },
      { id: 309, name_ru: 'Создание видео', name_en: 'Video Making', members: 160, online: 35 }, { id: 310, name_ru: 'Флористика', name_en: 'Floristry', members: 70, online: 12 },
      { id: 311, name_ru: 'Графический дизайн', name_en: 'Graphic Design', members: 240, online: 48 }, { id: 312, name_ru: 'Игра на гитаре', name_en: 'Guitar Playing', members: 190, online: 38 },
      { id: 313, name_ru: 'Мода и шитье', name_en: 'Fashion & Sewing', members: 140, online: 28 }, { id: 314, name_ru: 'Гончарное дело', name_en: 'Pottery', members: 60, online: 10 },
      { id: 315, name_ru: 'Stand-up комедия', name_en: 'Stand-up Comedy', members: 80, online: 18 }, { id: 316, name_ru: 'Создание украшений', name_en: 'Jewelry Making', members: 100, online: 21 },
      { id: 317, name_ru: '3D-моделирование', name_en: '3D Modeling', members: 130, online: 27 }, { id: 318, name_ru: 'DJ-инг', name_en: 'DJing', members: 95, online: 19 },
      { id: 319, name_ru: 'Поэзия', name_en: 'Poetry', members: 85, online: 16 }, { id: 320, name_ru: 'Ландшафтный дизайн', name_en: 'Landscape Design', members: 55, online: 9 },
    ]
  },
  {
    id: 'gaming', name_ru: 'Игры', name_en: 'Gaming', icon: 'Gamepad2', img: 'https://picsum.photos/seed/cat_gaming/600/400', hint: 'video games',
    subgroups: [
      { id: 401, name_ru: 'PC Гейминг', name_en: 'PC Gaming', members: 500, online: 120 }, { id: 402, name_ru: 'PlayStation', name_en: 'PlayStation', members: 450, online: 100 },
      { id: 403, name_ru: 'Xbox', name_en: 'Xbox', members: 300, online: 70 }, { id: 404, name_ru: 'Nintendo Switch', name_en: 'Nintendo Switch', members: 250, online: 50 },
      { id: 405, name_ru: 'Мобильные игры', name_en: 'Mobile Games', members: 600, online: 150 }, { id: 406, name_ru: 'Настольные игры', name_en: 'Board Games', members: 200, online: 40 },
      { id: 407, name_ru: 'VR/AR', name_en: 'VR/AR', members: 80, online: 15 }, { id: 408, name_ru: 'Киберспорт', name_en: 'eSports', members: 350, online: 80 },
      { id: 409, name_ru: 'Ретро-гейминг', name_en: 'Retro Gaming', members: 100, online: 20 }, { id: 410, name_ru: 'Стриминг', name_en: 'Streaming', members: 180, online: 45 },
      { id: 411, name_ru: 'MMORPG', name_en: 'MMORPG', members: 420, online: 95 }, { id: 412, name_ru: 'Инди-игры', name_en: 'Indie Games', members: 220, online: 48 },
      { id: 413, name_ru: 'RPG', name_en: 'RPG', members: 380, online: 85 }, { id: 414, name_ru: 'Стратегии', name_en: 'Strategy Games', members: 260, online: 55 },
      { id: 415, name_ru: 'Шутеры', name_en: 'Shooters', members: 480, online: 110 }, { id: 416, name_ru: 'Симуляторы', name_en: 'Simulators', members: 190, online: 39 },
      { id: 417, name_ru: 'Файтинги', name_en: 'Fighting Games', members: 140, online: 28 }, { id: 418, name_ru: 'Кооперативные игры', name_en: 'Co-op Games', members: 330, online: 75 },
      { id: 419, name_ru: 'Головоломки', name_en: 'Puzzles', members: 120, online: 24 }, { id: 420, name_ru: 'D&D и ролёвки', name_en: 'D&D and Role-playing', members: 170, online: 35 },
    ]
  },
  {
    id: 'movies', name_ru: 'Кино и Сериалы', name_en: 'Movies & TV', icon: 'Film', img: 'https://picsum.photos/seed/cat_movies/600/400', hint: 'cinema theater',
    subgroups: [
      { id: 501, name_ru: 'Netflix', name_en: 'Netflix', members: 700, online: 150 }, { id: 502, name_ru: 'Marvel & DC', name_en: 'Marvel & DC', members: 600, online: 130 },
      { id: 503, name_ru: 'Аниме', name_en: 'Anime', members: 550, online: 120 }, { id: 504, name_ru: 'Классика кино', name_en: 'Classic Cinema', members: 200, online: 30 },
      { id: 505, name_ru: 'Артхаус', name_en: 'Arthouse', members: 150, online: 25 }, { id: 506, name_ru: 'Ужасы', name_en: 'Horror', members: 300, online: 60 },
      { id: 507, name_ru: 'Комедии', name_en: 'Comedies', members: 400, online: 80 }, { id: 508, name_ru: 'Фантастика', name_en: 'Sci-Fi', members: 500, online: 110 },
      { id: 509, name_ru: 'Документалки', name_en: 'Documentaries', members: 180, online: 35 }, { id: 510, name_ru: 'Дорамы', name_en: 'K-Dramas', members: 450, online: 90 },
      { id: 511, name_ru: 'HBO сериалы', name_en: 'HBO Series', members: 650, online: 140 }, { id: 512, name_ru: 'Дисней', name_en: 'Disney', members: 380, online: 75 },
      { id: 513, name_ru: 'Триллеры и детективы', name_en: 'Thrillers & Detectives', members: 420, online: 88 }, { id: 514, name_ru: 'Научная фантастика', name_en: 'Science Fiction', members: 480, online: 100 },
      { id: 515, name_ru: 'Ромкомы', name_en: 'Rom-Coms', members: 320, online: 65 }, { id: 516, name_ru: 'Исторические фильмы', name_en: 'Historical Films', members: 190, online: 28 },
      { id: 517, name_ru: 'Короткометражки', name_en: 'Short Films', members: 90, online: 18 }, { id: 518, name_ru: 'Европейское кино', name_en: 'European Cinema', members: 160, online: 29 },
      { id: 519, name_ru: 'Азиатское кино', name_en: 'Asian Cinema', members: 280, online: 58 }, { id: 520, name_ru: 'Кинофестивали', name_en: 'Film Festivals', members: 130, online: 22 },
    ]
  },
  {
    id: 'travel', name_ru: 'Путешествия', name_en: 'Travel', icon: 'Globe', img: 'https://picsum.photos/seed/cat_travel/600/400', hint: 'world map',
    subgroups: [
      { id: 601, name_ru: 'Походы', name_en: 'Hiking', members: 250, online: 50 }, { id: 602, name_ru: 'Пляжный отдых', name_en: 'Beach Vacation', members: 400, online: 80 },
      { id: 603, name_ru: 'Автопутешествия', name_en: 'Road Trips', members: 300, online: 60 }, { id: 604, name_ru: 'Путешествия по Азии', name_en: 'Asia Travel', members: 200, online: 40 },
      { id: 605, name_ru: 'Путешествия по Европе', name_en: 'Europe Travel', members: 350, online: 70 }, { id: 606, name_ru: 'Экстремальный туризм', name_en: 'Extreme Tourism', members: 120, online: 25 },
      { id: 607, name_ru: 'Бюджетные путешествия', name_en: 'Budget Travel', members: 280, online: 55 }, { id: 608, name_ru: 'Одиночные поездки', name_en: 'Solo Trips', members: 180, online: 30 },
      { id: 609, name_ru: 'Круизы', name_en: 'Cruises', members: 90, online: 15 }, { id: 610, name_ru: 'Гастро-туры', name_en: 'Food Tours', members: 160, online: 35 },
      { id: 611, name_ru: 'По России', name_en: 'Around Russia', members: 320, online: 65 }, { id: 612, name_ru: 'США и Канада', name_en: 'USA & Canada', members: 190, online: 38 },
      { id: 613, name_ru: 'Латинская Америка', name_en: 'Latin America', members: 140, online: 28 }, { id: 614, name_ru: 'Африка', name_en: 'Africa', members: 70, online: 12 },
      { id: 615, name_ru: 'Работа в путешествии', name_en: 'Work & Travel', members: 210, online: 45 }, { id: 616, name_ru: 'С палатками', name_en: 'Camping', members: 170, online: 34 },
      { id: 617, name_ru: 'Экотуризм', name_en: 'Ecotourism', members: 130, online: 26 }, { id: 618, name_ru: 'Города-миллионники', name_en: 'Big Cities', members: 380, online: 78 },
      { id: 619, name_ru: 'Острова', name_en: 'Islands', members: 230, online: 47 }, { id: 620, name_ru: 'Необычные отели', name_en: 'Unique Hotels', members: 110, online: 21 },
    ]
  },
  {
    id: 'food', name_ru: 'Еда и Кулинария', name_en: 'Food & Cooking', icon: 'ChefHat', img: 'https://picsum.photos/seed/cat_food/600/400', hint: 'delicious food',
    subgroups: [
      { id: 701, name_ru: 'Домашняя выпечка', name_en: 'Home Baking', members: 300, online: 60 }, { id: 702, name_ru: 'Здоровое питание', name_en: 'Healthy Eating', members: 250, online: 50 },
      { id: 703, name_ru: 'Кофейные гурманы', name_en: 'Coffee Gourmets', members: 400, online: 80 }, { id: 704, name_ru: 'Вегетарианство/Веганство', name_en: 'Vegetarian/Vegan', members: 200, online: 40 },
      { id: 705, name_ru: 'Азиатская кухня', name_en: 'Asian Cuisine', members: 280, online: 55 }, { id: 706, name_ru: 'Итальянская кухня', name_en: 'Italian Cuisine', members: 350, online: 70 },
      { id: 707, name_ru: 'Гриль и BBQ', name_en: 'Grill & BBQ', members: 180, online: 35 }, { id: 708, name_ru: 'Вино и сыр', name_en: 'Wine & Cheese', members: 220, online: 45 },
      { id: 709, name_ru: 'Рецепты для ленивых', name_en: 'Lazy Recipes', members: 150, online: 30 }, { id: 710, name_ru: 'Молекулярная кухня', name_en: 'Molecular Gastronomy', members: 50, online: 10 },
      { id: 711, name_ru: 'Мексиканская кухня', name_en: 'Mexican Cuisine', members: 190, online: 38 }, { id: 712, name_ru: 'Французская кухня', name_en: 'French Cuisine', members: 170, online: 34 },
      { id: 713, name_ru: 'Стрит-фуд', name_en: 'Street Food', members: 320, online: 65 }, { id: 714, name_ru: 'Коктейли и миксология', name_en: 'Cocktails & Mixology', members: 210, online: 42 },
      { id: 715, name_ru: 'Десерты', name_en: 'Desserts', members: 290, online: 58 }, { id: 716, name_ru: 'Ферментация', name_en: 'Fermentation', members: 80, online: 16 },
      { id: 717, name_ru: 'Специи и соусы', name_en: 'Spices & Sauces', members: 110, online: 22 }, { id: 718, name_ru: 'Чайная церемония', name_en: 'Tea Ceremony', members: 90, online: 18 },
      { id: 719, name_ru: 'Фермерские продукты', name_en: 'Farm Products', members: 130, online: 26 }, { id: 720, name_ru: 'Ресторанные обзоры', name_en: 'Restaurant Reviews', members: 240, online: 48 },
    ]
  },
  {
    id: 'tech', name_ru: 'Технологии и IT', name_en: 'Tech & IT', icon: 'Cpu', img: 'https://picsum.photos/seed/cat_tech/600/400', hint: 'circuit board',
    subgroups: [
      { id: 801, name_ru: 'Frontend', name_en: 'Frontend', members: 400, online: 90 }, { id: 802, name_ru: 'Backend', name_en: 'Backend', members: 350, online: 80 },
      { id: 803, name_ru: 'Data Science & AI', name_en: 'Data Science & AI', members: 300, online: 70 }, { id: 804, name_ru: 'Mobile Dev', name_en: 'Mobile Dev', members: 250, online: 50 },
      { id: 805, name_ru: 'DevOps', name_en: 'DevOps', members: 150, online: 30 }, { id: 806, name_ru: 'Гаджеты', name_en: 'Gadgets', members: 500, online: 110 },
      { id: 807, name_ru: 'Стартапы', name_en: 'Startups', members: 280, online: 60 }, { id: 808, name_ru: 'Кибербезопасность', name_en: 'Cybersecurity', members: 200, online: 40 },
      { id: 809, name_ru: 'UI/UX Дизайн', name_en: 'UI/UX Design', members: 320, online: 75 }, { id: 810, name_ru: 'Код-новички', name_en: 'Code Newbies', members: 180, online: 45 },
      { id: 811, name_ru: 'Python', name_en: 'Python', members: 380, online: 85 }, { id: 812, name_ru: 'JavaScript', name_en: 'JavaScript', members: 420, online: 95 },
      { id: 813, name_ru: 'GameDev', name_en: 'GameDev', members: 260, online: 55 }, { id: 814, name_ru: 'QA / Тестирование', name_en: 'QA / Testing', members: 190, online: 38 },
      { id: 815, name_ru: 'Криптовалюты', name_en: 'Cryptocurrencies', members: 210, online: 42 }, { id: 816, name_ru: 'Apple-фаны', name_en: 'Apple Fans', members: 450, online: 100 },
      { id: 817, name_ru: 'Android-фаны', name_en: 'Android Fans', members: 390, online: 88 }, { id: 818, name_ru: 'Linux', name_en: 'Linux', members: 170, online: 34 },
      { id: 819, name_ru: 'DIY Электроника', name_en: 'DIY Electronics', members: 110, online: 22 }, { id: 820, name_ru: 'Умный дом', name_en: 'Smart Home', members: 230, online: 46 },
    ]
  },
  {
    id: 'books', name_ru: 'Книги', name_en: 'Books', icon: 'BookOpen', img: 'https://picsum.photos/seed/cat_books/600/400', hint: 'library books',
    subgroups: [
      { id: 901, name_ru: 'Фантастика', name_en: 'Science Fiction', members: 400, online: 80 }, { id: 902, name_ru: 'Фэнтези', name_en: 'Fantasy', members: 450, online: 90 },
      { id: 903, name_ru: 'Детективы', name_en: 'Detectives', members: 350, online: 70 }, { id: 904, name_ru: 'Классика', name_en: 'Classics', members: 200, online: 40 },
      { id: 905, name_ru: 'Нон-фикшн', name_en: 'Non-fiction', members: 250, online: 50 }, { id: 906, name_ru: 'Поэзия', name_en: 'Poetry', members: 100, online: 20 },
      { id: 907, name_ru: 'Современная проза', name_en: 'Modern Prose', members: 300, online: 60 }, { id: 908, name_ru: 'Психология', name_en: 'Psychology', members: 280, online: 55 },
      { id: 909, name_ru: 'Комиксы и манга', name_en: 'Comics & Manga', members: 320, online: 75 }, { id: 910, name_ru: 'Аудиокниги', name_en: 'Audiobooks', members: 180, online: 35 },
      { id: 911, name_ru: 'Научная фантастика', name_en: 'Sci-Fi Lit', members: 380, online: 78 }, { id: 912, name_ru: 'Ужасы и мистика', name_en: 'Horror & Mysticism', members: 220, online: 44 },
      { id: 913, name_ru: 'Романы', name_en: 'Novels', members: 290, online: 58 }, { id: 914, name_ru: 'Биография', name_en: 'Biography', members: 160, online: 32 },
      { id: 915, name_ru: 'Бизнес-литература', name_en: 'Business Literature', members: 210, online: 42 }, { id: 916, name_ru: 'История', name_en: 'History Books', members: 190, online: 38 },
      { id: 917, name_ru: 'Детские книги', name_en: 'Children\'s Books', members: 130, online: 26 }, { id: 918, name_ru: 'Книжный клуб', name_en: 'Book Club', members: 260, online: 52 },
      { id: 919, name_ru: 'Молодежная литература', name_en: 'Young Adult', members: 240, online: 48 }, { id: 920, name_ru: 'Философия', name_en: 'Philosophy', members: 140, online: 28 },
    ]
  },
  {
    id: 'selfdev', name_ru: 'Саморазвитие', name_en: 'Self-Dev', icon: 'Sparkles', img: 'https://picsum.photos/seed/cat_selfdev/600/400', hint: 'meditation nature',
    subgroups: [
      { id: 1001, name_ru: 'Продуктивность', name_en: 'Productivity', members: 300, online: 60 }, { id: 1002, name_ru: 'Медитация', name_en: 'Meditation', members: 250, online: 50 },
      { id: 1003, name_ru: 'Финансовая грамотность', name_en: 'Financial Literacy', members: 280, online: 55 }, { id: 1004, name_ru: 'Изучение языков', name_en: 'Language Learning', members: 400, online: 80 },
      { id: 1005, name_ru: 'Публичные выступления', name_en: 'Public Speaking', members: 150, online: 30 }, { id: 1006, name_ru: 'Психология', name_en: 'Psychology', members: 350, online: 70 },
      { id: 1007, name_ru: 'Философия', name_en: 'Philosophy', members: 120, online: 25 }, { id: 1008, name_ru: 'Карьерный рост', name_en: 'Career Growth', members: 220, online: 45 },
      { id: 1009, name_ru: 'Эмоциональный интеллект', name_en: 'Emotional Intelligence', members: 180, online: 35 }, { id: 1010, name_ru: 'Стоицизм', name_en: 'Stoicism', members: 90, online: 15 },
      { id: 1011, name_ru: 'Тайм-менеджмент', name_en: 'Time Management', members: 260, online: 52 }, { id: 1012, name_ru: 'Целеполагание', name_en: 'Goal Setting', members: 230, online: 46 },
      { id: 1013, name_ru: 'Нетворкинг', name_en: 'Networking', members: 190, online: 38 }, { id: 1014, name_ru: 'Осознанность', name_en: 'Mindfulness', members: 270, online: 54 },
      { id: 1015, name_ru: 'Критическое мышление', name_en: 'Critical Thinking', members: 160, online: 32 }, { id: 1016, name_ru: 'Здоровый образ жизни', name_en: 'Healthy Lifestyle', members: 320, online: 64 },
      { id: 1017, name_ru: 'Минимализм', name_en: 'Minimalism', members: 140, online: 28 }, { id: 1018, name_ru: 'Эффективное обучение', name_en: 'Effective Learning', members: 200, online: 40 },
      { id: 1019, name_ru: 'Борьба с прокрастинацией', name_en: 'Anti-Procrastination', members: 240, online: 48 }, { id: 1020, name_ru: 'Духовные практики', name_en: 'Spiritual Practices', members: 110, online: 22 },
    ]
  },
  {
    id: 'fashion', name_ru: 'Мода и Стиль', name_en: 'Fashion & Style', icon: 'Shirt', img: 'https://picsum.photos/seed/cat_fashion/600/400', hint: 'fashion runway',
    subgroups: [
      { id: 1101, name_ru: 'Стритвир', name_en: 'Streetwear', members: 300, online: 60 }, { id: 1102, name_ru: 'Высокая мода', name_en: 'High Fashion', members: 150, online: 30 },
      { id: 1103, name_ru: 'Винтаж', name_en: 'Vintage', members: 180, online: 35 }, { id: 1104, name_ru: 'Кроссовки', name_en: 'Sneakers', members: 250, online: 50 },
      { id: 1105, name_ru: 'Минимализм', name_en: 'Minimalism Style', members: 200, online: 40 }, { id: 1106, name_ru: 'Аксессуары', name_en: 'Accessories', members: 170, online: 34 },
      { id: 1107, name_ru: 'Уход за собой', name_en: 'Self-Care', members: 280, online: 56 }, { id: 1108, name_ru: 'Парфюмерия', name_en: 'Perfumery', members: 220, online: 44 },
      { id: 1109, name_ru: 'Капсульный гардероб', name_en: 'Capsule Wardrobe', members: 160, online: 32 }, { id: 1110, name_ru: 'DIY одежда', name_en: 'DIY Clothes', members: 130, online: 26 },
      { id: 1111, name_ru: 'Люксовые бренды', name_en: 'Luxury Brands', members: 190, online: 38 }, { id: 1112, name_ru: 'Эко-мода', name_en: 'Eco-Fashion', members: 110, online: 22 },
      { id: 1113, name_ru: 'Мужской стиль', name_en: 'Men\'s Style', members: 260, online: 52 }, { id: 1114, name_ru: 'Женский стиль', name_en: 'Women\'s Style', members: 350, online: 70 },
      { id: 1115, name_ru: 'История моды', name_en: 'History of Fashion', members: 90, online: 18 }, { id: 1116, name_ru: 'Макияж', name_en: 'Makeup', members: 290, online: 58 },
      { id: 1117, name_ru: 'Прически', name_en: 'Hairstyles', members: 240, online: 48 }, { id: 1118, name_ru: 'Секонд-хенд', name_en: 'Second-hand', members: 210, online: 42 },
      { id: 1119, name_ru: 'Модные блоги', name_en: 'Fashion Blogs', members: 270, online: 54 }, { id: 1120, name_ru: 'Шопинг-советы', name_en: 'Shopping Tips', members: 320, online: 64 },
    ]
  },
  {
    id: 'health', name_ru: 'Здоровье', name_en: 'Health', icon: 'HeartPulse', img: 'https://picsum.photos/seed/cat_health/600/400', hint: 'healthy food yoga',
    subgroups: [
      { id: 1201, name_ru: 'Правильное питание', name_en: 'Healthy Nutrition', members: 350, online: 70 }, { id: 1202, name_ru: 'Фитнес дома', name_en: 'Home Fitness', members: 300, online: 60 },
      { id: 1203, name_ru: 'Тренажерный зал', name_en: 'Gym', members: 280, online: 56 }, { id: 1204, name_ru: 'Йога и пилатес', name_en: 'Yoga & Pilates', members: 250, online: 50 },
      { id: 1205, name_ru: 'Медитация', name_en: 'Meditation', members: 200, online: 40 }, { id: 1206, name_ru: 'Психическое здоровье', name_en: 'Mental Health', members: 220, online: 44 },
      { id: 1207, name_ru: 'Бег', name_en: 'Running', members: 180, online: 36 }, { id: 1208, name_ru: 'Витамины и БАДы', name_en: 'Vitamins & Supplements', members: 160, online: 32 },
      { id: 1209, name_ru: 'Рецепты ПП', name_en: 'Healthy Recipes', members: 290, online: 58 }, { id: 1210, name_ru: 'Биохакинг', name_en: 'Biohacking', members: 130, online: 26 },
      { id: 1211, name_ru: 'Интервальное голодание', name_en: 'Intermittent Fasting', members: 170, online: 34 }, { id: 1212, name_ru: 'Кроссфит', name_en: 'CrossFit', members: 140, online: 28 },
      { id: 1213, name_ru: 'Здоровый сон', name_en: 'Healthy Sleep', members: 210, online: 42 }, { id: 1214, name_ru: 'Закаливание', name_en: 'Cold Exposure', members: 90, online: 18 },
      { id: 1215, name_ru: 'Детокс', name_en: 'Detox', members: 110, online: 22 }, { id: 1216, name_ru: 'Массаж', name_en: 'Massage', members: 150, online: 30 },
      { id: 1217, name_ru: 'Ароматерапия', name_en: 'Aromatherapy', members: 80, online: 16 }, { id: 1218, name_ru: 'Веганство', name_en: 'Veganism', members: 190, online: 38 },
      { id: 1219, name_ru: 'Спортивное питание', name_en: 'Sports Nutrition', members: 160, online: 32 }, { id: 1220, name_ru: 'Челенджи здоровья', name_en: 'Health Challenges', members: 230, online: 46 },
    ]
  },
  {
    id: 'pets', name_ru: 'Питомцы', name_en: 'Pets', icon: 'Dog', img: 'https://picsum.photos/seed/cat_pets/600/400', hint: 'cute dog cat',
    subgroups: [
      { id: 1301, name_ru: 'Собачники', name_en: 'Dog Lovers', members: 500, online: 100 }, { id: 1302, name_ru: 'Кошатники', name_en: 'Cat Lovers', members: 600, online: 120 },
      { id: 1303, name_ru: 'Грызуны', name_en: 'Rodents', members: 150, online: 30 }, { id: 1304, name_ru: 'Аквариумистика', name_en: 'Aquaristics', members: 120, online: 24 },
      { id: 1305, name_ru: 'Птицы', name_en: 'Birds', members: 100, online: 20 }, { id: 1306, name_ru: 'Экзотические животные', name_en: 'Exotic Animals', members: 80, online: 16 },
      { id: 1307, name_ru: 'Дрессировка', name_en: 'Training', members: 200, online: 40 }, { id: 1308, name_ru: 'Груминг', name_en: 'Grooming', members: 180, online: 36 },
      { id: 1309, name_ru: 'Волонтерство', name_en: 'Volunteering', members: 130, online: 26 }, { id: 1310, name_ru: 'Фото питомцев', name_en: 'Pet Photos', members: 300, online: 60 },
      { id: 1311, name_ru: 'Породистые собаки', name_en: 'Purebred Dogs', members: 220, online: 44 }, { id: 1312, name_ru: 'Породистые кошки', name_en: 'Purebred Cats', members: 250, online: 50 },
      { id: 1313, name_ru: 'Рептилии', name_en: 'Reptiles', members: 70, online: 14 }, { id: 1314, name_ru: 'Здоровье питомцев', name_en: 'Pet Health', members: 190, online: 38 },
      { id: 1315, name_ru: 'Смешные видео', name_en: 'Funny Videos', members: 400, online: 80 }, { id: 1316, name_ru: 'Выставки', name_en: 'Exhibitions', members: 90, online: 18 },
      { id: 1317, name_ru: 'Путешествия с животными', name_en: 'Traveling with Pets', members: 110, online: 22 }, { id: 1318, name_ru: 'Помощь бездомным', name_en: 'Helping Strays', members: 160, online: 32 },
      { id: 1319, name_ru: 'Амуниция и игрушки', name_en: 'Gear & Toys', members: 140, online: 28 }, { id: 1320, name_ru: 'Конный спорт', name_en: 'Equestrianism', members: 60, online: 12 },
    ]
  },
  {
    id: 'science', name_ru: 'Наука', name_en: 'Science', icon: 'FlaskConical', img: 'https://picsum.photos/seed/cat_science/600/400', hint: 'galaxy space',
    subgroups: [
      { id: 1401, name_ru: 'Космос', name_en: 'Space', members: 300, online: 60 }, { id: 1402, name_ru: 'Физика', name_en: 'Physics', members: 200, online: 40 },
      { id: 1403, name_ru: 'Биология', name_en: 'Biology', members: 250, online: 50 }, { id: 1404, name_ru: 'Химия', name_en: 'Chemistry', members: 180, online: 36 },
      { id: 1405, name_ru: 'Математика', name_en: 'Mathematics', members: 150, online: 30 }, { id: 1406, name_ru: 'Научпоп', name_en: 'Pop Science', members: 400, online: 80 },
      { id: 1407, name_ru: 'История науки', name_en: 'History of Science', members: 120, online: 24 }, { id: 1408, name_ru: 'Нейробиология', name_en: 'Neurobiology', members: 220, online: 44 },
      { id: 1409, name_ru: 'Экология', name_en: 'Ecology', members: 190, online: 38 }, { id: 1410, name_ru: 'Генетика', name_en: 'Genetics', members: 160, online: 32 },
      { id: 1411, name_ru: 'Астрономия', name_en: 'Astronomy', members: 280, online: 56 }, { id: 1412, name_ru: 'Квантовая физика', name_en: 'Quantum Physics', members: 170, online: 34 },
      { id: 1413, name_ru: 'Антропология', name_en: 'Anthropology', members: 110, online: 22 }, { id: 1414, name_ru: 'Психология', name_en: 'Psychology', members: 350, online: 70 },
      { id: 1415, name_ru: 'Геология', name_en: 'Geology', members: 90, online: 18 }, { id: 1416, name_ru: 'Лингвистика', name_en: 'Linguistics', members: 130, online: 26 },
      { id: 1417, name_ru: 'Робототехника', name_en: 'Robotics', members: 210, online: 42 }, { id: 1418, name_ru: 'Будущее технологий', name_en: 'Future Tech', members: 320, online: 64 },
      { id: 1419, name_ru: 'Научные эксперименты', name_en: 'Science Experiments', members: 140, online: 28 }, { id: 1420, name_ru: 'Дикая природа', name_en: 'Wildlife', members: 260, online: 52 },
    ]
  },
  {
    id: 'business', name_ru: 'Бизнес', name_en: 'Business', icon: 'Briefcase', img: 'https://picsum.photos/seed/cat_business/600/400', hint: 'city skyline office',
    subgroups: [
      { id: 1501, name_ru: 'Стартапы', name_en: 'Startups', members: 300, online: 60 }, { id: 1502, name_ru: 'Инвестиции', name_en: 'Investing', members: 350, online: 70 },
      { id: 1503, name_ru: 'Маркетинг', name_en: 'Marketing', members: 280, online: 56 }, { id: 1504, name_ru: 'Продажи', name_en: 'Sales', members: 250, online: 50 },
      { id: 1505, name_ru: 'Менеджмент', name_en: 'Management', members: 220, online: 44 }, { id: 1506, name_ru: 'Криптовалюты', name_en: 'Crypto', members: 400, online: 80 },
      { id: 1507, name_ru: 'Недвижимость', name_en: 'Real Estate', members: 180, online: 36 }, { id: 1508, name_ru: 'Личные финансы', name_en: 'Personal Finance', members: 320, online: 64 },
      { id: 1509, name_ru: 'E-commerce', name_en: 'E-commerce', members: 260, online: 52 }, { id: 1510, name_ru: 'Нетворкинг', name_en: 'Networking', members: 200, online: 40 },
      { id: 1511, name_ru: 'Франшизы', name_en: 'Franchises', members: 120, online: 24 }, { id: 1512, name_ru: 'HR и рекрутинг', name_en: 'HR & Recruiting', members: 160, online: 32 },
      { id: 1513, name_ru: 'Тайм-менеджмент', name_en: 'Time Management', members: 290, online: 58 }, { id: 1514, name_ru: 'Деловые переговоры', name_en: 'Business Negotiations', members: 190, online: 38 },
      { id: 1515, name_ru: 'Женщины в бизнесе', name_en: 'Women in Business', members: 230, online: 46 }, { id: 1516, name_ru: 'Пассивный доход', name_en: 'Passive Income', members: 270, online: 54 },
      { id: 1517, name_ru: 'Бизнес-книги', name_en: 'Business Books', members: 210, online: 42 }, { id: 1518, name_ru: 'IT-бизнес', name_en: 'IT Business', members: 380, online: 76 },
      { id: 1519, name_ru: 'Социальное предпринимательство', name_en: 'Social Entrepreneurship', members: 110, online: 22 }, { id: 1520, name_ru: 'Ораторское искусство', name_en: 'Public Speaking', members: 140, online: 28 },
    ]
  },
  {
    id: 'home', name_ru: 'Дом и Сад', name_en: 'Home & Garden', icon: 'Home', img: 'https://picsum.photos/seed/cat_home/600/400', hint: 'cozy interior garden',
    subgroups: [
      { id: 1601, name_ru: 'Дизайн интерьера', name_en: 'Interior Design', members: 300, online: 60 }, { id: 1602, name_ru: 'Садоводство', name_en: 'Gardening', members: 250, online: 50 },
      { id: 1603, name_ru: 'Комнатные растения', name_en: 'Houseplants', members: 350, online: 70 }, { id: 1604, name_ru: 'DIY-ремонт', name_en: 'DIY Renovation', members: 200, online: 40 },
      { id: 1605, name_ru: 'Минимализм', name_en: 'Minimalism', members: 180, online: 36 }, { id: 1606, name_ru: 'Организация пространства', name_en: 'Organizing', members: 220, online: 44 },
      { id: 1607, name_ru: 'Умный дом', name_en: 'Smart Home', members: 280, online: 56 }, { id: 1608, name_ru: 'Ландшафтный дизайн', name_en: 'Landscape Design', members: 150, online: 30 },
      { id: 1609, name_ru: 'Загородная жизнь', name_en: 'Country Living', members: 190, online: 38 }, { id: 1610, name_ru: 'Эко-дом', name_en: 'Eco Home', members: 120, online: 24 },
      { id: 1611, name_ru: 'Скандинавский стиль', name_en: 'Scandinavian Style', members: 260, online: 52 }, { id: 1612, name_ru: 'Лофт', name_en: 'Loft', members: 170, online: 34 },
      { id: 1613, name_ru: 'Балконные сады', name_en: 'Balcony Gardens', members: 140, online: 28 }, { id: 1614, name_ru: 'Мебель своими руками', name_en: 'DIY Furniture', members: 110, online: 22 },
      { id: 1615, name_ru: 'Декор', name_en: 'Decor', members: 290, online: 58 }, { id: 1616, name_ru: 'Строительство дома', name_en: 'Home Building', members: 90, online: 18 },
      { id: 1617, name_ru: 'Хюгге', name_en: 'Hygge', members: 230, online: 46 }, { id: 1618, name_ru: 'Вертикальные фермы', name_en: 'Vertical Farms', members: 70, online: 14 },
      { id: 1619, name_ru: 'Вторая жизнь вещей', name_en: 'Upcycling', members: 160, online: 32 }, { id: 1620, name_ru: 'Сезонные украшения', name_en: 'Seasonal Decorations', members: 130, online: 26 },
    ]
  },
  {
    id: 'cars', name_ru: 'Автомобили', name_en: 'Cars', icon: 'Car', img: 'https://picsum.photos/seed/cat_cars/600/400', hint: 'sports car',
    subgroups: [
      { id: 1701, name_ru: 'Спорткары', name_en: 'Sports Cars', members: 250, online: 50 }, { id: 1702, name_ru: 'Классические авто', name_en: 'Classic Cars', members: 180, online: 36 },
      { id: 1703, name_ru: 'Внедорожники', name_en: 'SUVs', members: 300, online: 60 }, { id: 1704, name_ru: 'Электромобили', name_en: 'Electric Cars', members: 220, online: 44 },
      { id: 1705, name_ru: 'Тюнинг', name_en: 'Tuning', members: 280, online: 56 }, { id: 1706, name_ru: 'Автопутешествия', name_en: 'Car Travel', members: 200, online: 40 },
      { id: 1707, name_ru: 'Мотоциклы', name_en: 'Motorcycles', members: 350, online: 70 }, { id: 1708, name_ru: 'Формула-1', name_en: 'Formula 1', members: 190, online: 38 },
      { id: 1709, name_ru: 'Ремонт и обслуживание', name_en: 'Repair & Maintenance', members: 150, online: 30 }, { id: 1710, name_ru: 'Автозвук', name_en: 'Car Audio', members: 120, online: 24 },
      { id: 1711, name_ru: 'BMW', name_en: 'BMW', members: 290, online: 58 }, { id: 1712, name_ru: 'Mercedes', name_en: 'Mercedes', members: 270, online: 54 },
      { id: 1713, name_ru: 'Audi', name_en: 'Audi', members: 260, online: 52 }, { id: 1714, name_ru: 'Японские авто', name_en: 'Japanese Cars', members: 320, online: 64 },
      { id: 1715, name_ru: 'Американские авто', name_en: 'American Cars', members: 170, online: 34 }, { id: 1716, name_ru: 'Дрифт', name_en: 'Drifting', members: 140, online: 28 },
      { id: 1717, name_ru: 'Автовыставки', name_en: 'Car Shows', members: 110, online: 22 }, { id: 1718, name_ru: 'Картинг', name_en: 'Karting', members: 90, online: 18 },
      { id: 1719, name_ru: 'Ралли', name_en: 'Rally', members: 80, online: 16 }, { id: 1720, name_ru: 'Продажа/покупка авто', name_en: 'Buying/Selling Cars', members: 230, online: 46 },
    ]
  },
  {
    id: 'humor', name_ru: 'Юмор', name_en: 'Humor', icon: 'Laugh', img: 'https://picsum.photos/seed/cat_humor/600/400', hint: 'laughing people',
    subgroups: [
      { id: 1801, name_ru: 'Мемы', name_en: 'Memes', members: 800, online: 150 }, { id: 1802, name_ru: 'Stand-up', name_en: 'Stand-up', members: 400, online: 80 },
      { id: 1803, name_ru: 'Черный юмор', name_en: 'Dark Humor', members: 250, online: 50 }, { id: 1804, name_ru: 'Анекдоты', name_en: 'Jokes', members: 300, online: 60 },
      { id: 1805, name_ru: 'Смешные видео', name_en: 'Funny Videos', members: 700, online: 140 }, { id: 1806, name_ru: 'Ирония и сарказм', name_en: 'Irony & Sarcasm', members: 350, online: 70 },
      { id: 1807, name_ru: 'КВН', name_en: 'KVN', members: 180, online: 36 }, { id: 1808, name_ru: 'Комедийные шоу', name_en: 'Comedy Shows', members: 280, online: 56 },
      { id: 1809, name_ru: 'Каламбуры', name_en: 'Puns', members: 220, online: 44 }, { id: 1810, name_ru: 'Абсурдный юмор', name_en: 'Absurd Humor', members: 190, online: 38 },
      { id: 1811, name_ru: 'Смешные истории из жизни', name_en: 'Funny Life Stories', members: 450, online: 90 }, { id: 1812, name_ru: 'Пранки', name_en: 'Pranks', members: 150, online: 30 },
      { id: 1813, name_ru: 'Комиксы', name_en: 'Comics', members: 320, online: 64 }, { id: 1814, name_ru: 'Животные-приколисты', name_en: 'Funny Animals', members: 500, online: 100 },
      { id: 1815, name_ru: 'Профессиональный юмор', name_en: 'Professional Humor', members: 170, online: 34 }, { id: 1816, name_ru: 'Позитив', name_en: 'Positivity', members: 600, online: 120 },
      { id: 1817, name_ru: 'Пародии', name_en: 'Parodies', members: 210, online: 42 }, { id: 1818, name_ru: 'Тонкий юмор', name_en: 'Subtle Humor', members: 290, online: 58 },
      { id: 1819, name_ru: 'IT-юмор', name_en: 'IT Humor', members: 260, online: 52 }, { id: 1820, name_ru: 'Сатира', name_en: 'Satire', members: 160, online: 32 },
    ]
  },
  {
    id: 'dance', name_ru: 'Танцы', name_en: 'Dance', icon: 'Star', img: 'https://picsum.photos/seed/cat_dance/600/400', hint: 'dancing couple',
    subgroups: [
      { id: 1901, name_ru: 'Хип-хоп', name_en: 'Hip-hop', members: 250, online: 50 }, { id: 1902, name_ru: 'Сальса и Бачата', name_en: 'Salsa & Bachata', members: 300, online: 60 },
      { id: 1903, name_ru: 'Современные танцы', name_en: 'Modern Dance', members: 220, online: 44 }, { id: 1904, name_ru: 'Балет', name_en: 'Ballet', members: 120, online: 24 },
      { id: 1905, name_ru: 'Танго', name_en: 'Tango', members: 150, online: 30 }, { id: 1906, name_ru: 'Клубные танцы', name_en: 'Club Dancing', members: 350, online: 70 },
      { id: 1907, name_ru: 'Народные танцы', name_en: 'Folk Dance', members: 100, online: 20 }, { id: 1908, name_ru: 'Брейк-данс', name_en: 'Breakdance', members: 180, online: 36 },
      { id: 1909, name_ru: 'Джаз-модерн', name_en: 'Jazz-modern', members: 130, online: 26 }, { id: 1910, name_ru: 'Вог', name_en: 'Vogue', members: 160, online: 32 },
      { id: 1911, name_ru: 'Зумба', name_en: 'Zumba', members: 280, online: 56 }, { id: 1912, name_ru: 'Свинг', name_en: 'Swing', members: 90, online: 18 },
      { id: 1913, name_ru: 'Контемпорари', name_en: 'Contemporary', members: 190, online: 38 }, { id: 1914, name_ru: 'Танцы на пилоне', name_en: 'Pole Dance', members: 170, online: 34 },
      { id: 1915, name_ru: 'K-Pop cover dance', name_en: 'K-Pop Cover Dance', members: 290, online: 58 }, { id: 1916, name_ru: 'Исторические танцы', name_en: 'Historical Dance', members: 70, online: 14 },
      { id: 1917, name_ru: 'Тверк', name_en: 'Twerk', members: 140, online: 28 }, { id: 1918, name_ru: 'Танцевальная терапия', name_en: 'Dance Therapy', members: 110, online: 22 },
      { id: 1919, name_ru: 'Фламенко', name_en: 'Flamenco', members: 80, online: 16 }, { id: 1920, name_ru: 'Импровизация', name_en: 'Improvisation', members: 210, online: 42 },
    ]
  },
  {
    id: 'history', name_ru: 'История', name_en: 'History', icon: 'Scroll', img: 'https://picsum.photos/seed/cat_history/600/400', hint: 'ancient ruins',
    subgroups: [
      { id: 2001, name_ru: 'Древний мир', name_en: 'Ancient World', members: 200, online: 40 }, { id: 2002, name_ru: 'Средневековье', name_en: 'Middle Ages', members: 250, online: 50 },
      { id: 2003, name_ru: 'Новое время', name_en: 'Modern History', members: 180, online: 36 }, { id: 2004, name_ru: 'XX век', name_en: '20th Century', members: 300, online: 60 },
      { id: 2005, name_ru: 'Военная история', name_en: 'Military History', members: 220, online: 44 }, { id: 2006, name_ru: 'Археология', name_en: 'Archaeology', members: 150, online: 30 },
      { id: 2007, name_ru: 'Мифология', name_en: 'Mythology', members: 280, online: 56 }, { id: 2008, name_ru: 'История России', name_en: 'History of Russia', members: 260, online: 52 },
      { id: 2009, name_ru: 'Альтернативная история', name_en: 'Alternate History', members: 190, online: 38 }, { id: 2010, name_ru: 'Реконструкция', name_en: 'Reenactment', members: 130, online: 26 },
      { id: 2011, name_ru: 'История моды', name_en: 'History of Fashion', members: 170, online: 34 }, { id: 2012, name_ru: 'История искусств', name_en: 'Art History', members: 210, online: 42 },
      { id: 2013, name_ru: 'Генеалогия', name_en: 'Genealogy', members: 110, online: 22 }, { id: 2014, name_ru: 'История науки', name_en: 'History of Science', members: 160, online: 32 },
      { id: 2015, name_ru: 'Викинги', name_en: 'Vikings', members: 230, online: 46 }, { id: 2016, name_ru: 'Римская империя', name_en: 'Roman Empire', members: 240, online: 48 },
      { id: 2017, name_ru: 'Древний Египет', name_en: 'Ancient Egypt', members: 190, online: 38 }, { id: 2018, name_ru: 'Исторические мемы', name_en: 'History Memes', members: 350, online: 70 },
      { id: 2019, name_ru: 'Геральдика', name_en: 'Heraldry', members: 80, online: 16 }, { id: 2020, name_ru: 'Культурология', name_en: 'Cultural Studies', members: 140, online: 28 },
    ]
  },
];
