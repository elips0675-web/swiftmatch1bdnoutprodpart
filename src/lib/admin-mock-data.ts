import { CAPITALS, INTEREST_OPTIONS, DATING_GOALS, EDUCATION_OPTIONS } from './constants';

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const FIRST_NAMES_F = ['Анна','Елена','София','Мария','Дарья','Ольга','Екатерина','Наталья','Ирина','Полина','Алина','Виктория','Ксения','Татьяна','Юлия','Кристина','Марина','Валерия','Светлана','Арина','Вероника','Лариса','Евгения','Надежда','Диана'];
const FIRST_NAMES_M = ['Максим','Артем','Дмитрий','Иван','Александр','Сергей','Андрей','Никита','Павел','Егор','Роман','Алексей','Михаил','Даниил','Кирилл','Владимир','Константин','Олег','Тимур','Виктор','Денис','Григорий','Антон','Борис','Илья'];

export type UserStatus = 'active' | 'banned' | 'suspended' | 'pending';
export type PremiumTier = 'free' | 'plus' | 'gold' | 'platinum';

export interface MockUser {
  id: number;
  name: string;
  age: number;
  gender: 'M' | 'F';
  email: string;
  city: string;
  status: UserStatus;
  premium: PremiumTier;
  online: boolean;
  joined: string;
  lastActive: string;
  bio: string;
  interests: string[];
  matchesCount: number;
  reportsCount: number;
  moderationHistory: { date: string; action: string; admin: string; reason: string }[];
}

export interface MockReport {
  id: number;
  reporterId: number;
  reporterName: string;
  reportedUserId: number;
  reportedUserName: string;
  reason: string;
  description: string;
  evidence: string;
  date: string;
  status: 'new' | 'reviewed' | 'dismissed' | 'action_taken';
}

export interface MockCampaign {
  id: number;
  title: string;
  body: string;
  target: 'all' | 'premium' | 'new';
  channel: 'push' | 'email';
  status: 'sent' | 'scheduled' | 'draft';
  sentAt: string;
  delivered: number;
  opened: number;
  clicked: number;
}

const rand = seededRandom(42);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function pickN<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rand() - 0.5);
  return shuffled.slice(0, n);
}

function randomDate(start: string, end: string): string {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return new Date(s + rand() * (e - s)).toISOString().split('T')[0];
}

export function generateMockUsers(): MockUser[] {
  const users: MockUser[] = [];
  for (let i = 1; i <= 120; i++) {
    const isFemale = rand() > 0.45;
    const name = isFemale ? pick(FIRST_NAMES_F) : pick(FIRST_NAMES_M);
    const statuses: UserStatus[] = ['active','active','active','active','active','active','active','banned','suspended','pending'];
    const premiums: PremiumTier[] = ['free','free','free','free','plus','plus','gold','platinum'];
    const status = pick(statuses);
    const joined = randomDate('2023-06-01', '2026-04-30');
    users.push({
      id: i,
      name,
      age: 18 + Math.floor(rand() * 22),
      gender: isFemale ? 'F' : 'M',
      email: `${name.toLowerCase().replace(/[а-яё]/g, c => {
        const map: Record<string, string> = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ы':'y','э':'e','ю':'yu','я':'ya'};
        return map[c] || c;
      })}${i}@mail.ru`,
      city: pick(CAPITALS),
      status,
      premium: pick(premiums),
      online: rand() > 0.7,
      joined,
      lastActive: randomDate(joined, '2026-05-04'),
      bio: `Привет! Мне ${18 + Math.floor(rand() * 22)} лет, из ${pick(CAPITALS)}.`,
      interests: pickN(INTEREST_OPTIONS, 2 + Math.floor(rand() * 5)),
      matchesCount: Math.floor(rand() * 80),
      reportsCount: Math.floor(rand() * 4),
      moderationHistory: status === 'banned' ? [{ date: randomDate('2025-01-01','2026-05-01'), action: 'Бан', admin: 'admin@swiftmatch.ru', reason: 'Нарушение правил' }] : [],
    });
  }
  return users;
}

const REPORT_REASONS = ['Фейковый профиль','Оскорбительное поведение','Спам','Неприемлемый контент','Мошенничество','Домогательства','Несовершеннолетний','Другое'];
export function generateMockReports(users: MockUser[]): MockReport[] {
  const reports: MockReport[] = [];
  for (let i = 1; i <= 35; i++) {
    const reporter = pick(users);
    let reported = pick(users);
    while (reported.id === reporter.id) reported = pick(users);
    const statuses: MockReport['status'][] = ['new','new','new','reviewed','dismissed','action_taken'];
    reports.push({
      id: i,
      reporterId: reporter.id,
      reporterName: reporter.name,
      reportedUserId: reported.id,
      reportedUserName: reported.name,
      reason: pick(REPORT_REASONS),
      description: `Пользователь ${reported.name} нарушает правила сообщества.`,
      evidence: rand() > 0.5 ? 'Скриншот чата прикреплен' : 'Без доказательств',
      date: randomDate('2026-03-01', '2026-05-04'),
      status: pick(statuses),
    });
  }
  return reports.sort((a, b) => b.date.localeCompare(a.date));
}

export function generateRegistrationTrend(days: number) {
  const data: { date: string; users: number }[] = [];
  const now = new Date('2026-05-04');
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data.push({
      date: d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
      users: 30 + Math.floor(rand() * 70) + (days === 7 ? 0 : Math.floor(i * 0.3)),
    });
  }
  return data;
}

export function generateCityDistribution(users: MockUser[]) {
  const counts: Record<string, number> = {};
  users.forEach(u => { counts[u.city] = (counts[u.city] || 0) + 1; });
  return Object.entries(counts)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
}

export interface ActivityItem {
  id: number;
  type: 'registration' | 'match' | 'report' | 'premium';
  text: string;
  time: string;
}
export function generateRecentActivity(): ActivityItem[] {
  return [
    { id: 1, type: 'registration', text: 'Новый пользователь: Алина из Москвы', time: '2 мин назад' },
    { id: 2, type: 'match', text: 'Новый мэтч: Артем ❤️ Елена', time: '5 мин назад' },
    { id: 3, type: 'premium', text: 'Максим оформил Gold подписку', time: '12 мин назад' },
    { id: 4, type: 'report', text: 'Жалоба на пользователя Никита', time: '18 мин назад' },
    { id: 5, type: 'registration', text: 'Новый пользователь: Дмитрий из Казани', time: '25 мин назад' },
    { id: 6, type: 'match', text: 'Новый мэтч: Полина ❤️ Роман', time: '30 мин назад' },
    { id: 7, type: 'premium', text: 'София оформила Plus подписку', time: '45 мин назад' },
    { id: 8, type: 'registration', text: 'Новый пользователь: Кристина из Питера', time: '1 ч назад' },
  ];
}

export function generateMockCampaigns(): MockCampaign[] {
  return [
    { id: 1, title: '🔥 Весенняя акция — Premium со скидкой 50%', body: 'Только до конца мая...', target: 'all', channel: 'push', status: 'sent', sentAt: '2026-04-28', delivered: 8420, opened: 3210, clicked: 890 },
    { id: 2, title: '💎 Эксклюзив для Gold-пользователей', body: 'Новые фильтры уже доступны...', target: 'premium', channel: 'email', status: 'sent', sentAt: '2026-04-20', delivered: 1240, opened: 780, clicked: 310 },
    { id: 3, title: '👋 Добро пожаловать в SwiftMatch!', body: 'Заполни профиль и получи бонус...', target: 'new', channel: 'push', status: 'scheduled', sentAt: '2026-05-10', delivered: 0, opened: 0, clicked: 0 },
    { id: 4, title: '🎉 Конкурс "Лучшее фото недели"', body: 'Загрузи фото и выиграй Premium...', target: 'all', channel: 'push', status: 'sent', sentAt: '2026-04-15', delivered: 9100, opened: 4500, clicked: 1200 },
    { id: 5, title: '💌 День рождения SwiftMatch', body: 'Нам 1 год! Дарим подарки...', target: 'all', channel: 'email', status: 'draft', sentAt: '', delivered: 0, opened: 0, clicked: 0 },
  ];
}

export function generateRevenueData() {
  const months = ['Янв','Фев','Мар','Апр','Май'];
  return months.map((m, i) => ({
    month: m,
    subscriptions: 2000 + Math.floor(rand() * 3000) + i * 500,
    ads: 400 + Math.floor(rand() * 600),
    boosts: 300 + Math.floor(rand() * 500),
  }));
}

export function generateConversionFunnel() {
  return [
    { stage: 'Регистрация', count: 12480 },
    { stage: 'Онбординг', count: 9800 },
    { stage: 'Первый мэтч', count: 6200 },
    { stage: 'Первое сообщение', count: 4100 },
    { stage: 'Триал Premium', count: 1800 },
    { stage: 'Подписка', count: 650 },
  ];
}

export interface ModerationLogEntry {
  id: number;
  date: string;
  admin: string;
  action: string;
  targetUser: string;
  reason: string;
}
export function generateModerationLog(): ModerationLogEntry[] {
  return [
    { id: 1, date: '2026-05-04 14:32', admin: 'admin@swiftmatch.ru', action: 'Бан', targetUser: 'Никита', reason: 'Спам' },
    { id: 2, date: '2026-05-04 12:15', admin: 'mod@swiftmatch.ru', action: 'Предупреждение', targetUser: 'Дмитрий', reason: 'Оскорбительное поведение' },
    { id: 3, date: '2026-05-03 18:45', admin: 'admin@swiftmatch.ru', action: 'Разблокировка', targetUser: 'Анна', reason: 'Ложная жалоба' },
    { id: 4, date: '2026-05-03 10:22', admin: 'mod@swiftmatch.ru', action: 'Удаление фото', targetUser: 'Роман', reason: 'Неприемлемый контент' },
    { id: 5, date: '2026-05-02 16:10', admin: 'admin@swiftmatch.ru', action: 'Бан', targetUser: 'user_fake_42', reason: 'Фейковый профиль' },
    { id: 6, date: '2026-05-02 09:30', admin: 'mod@swiftmatch.ru', action: 'Приостановка', targetUser: 'Тимур', reason: 'Домогательства' },
  ];
}

export function exportToCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export const FORBIDDEN_WORDS_DEFAULT = [
  'спам','мошенничество','фейк','скам','обман',
  'реклама','казино','ставки','заработок','крипта','инвестиции',
  'наркотики','закладки','продажа','куплю','порно','секс',
  'работа на дому','пассивный доход','быстрый доход','заработок в интернете',
  'форекс','бинарные опционы','покер','слоты','микрозайм',
  'кидалово','лохотрон','обнал','кардинг','фишинг','накрутка',
  'продам аккаунт','куплю аккаунт','мефедрон','кокаин','амфетамин',
  'кладмен','закладчик',
];
