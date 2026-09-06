import mysql from 'mysql2/promise'
import bcrypt from 'bcryptjs'

const {
  DB_HOST = 'localhost',
  DB_PORT = '3306',
  DB_USER = 'root',
  DB_PASSWORD = '',
  DB_NAME = 'swiftmatch',
} = process.env

const TOTAL_USERS = 50
const TARGET_MATCHES = 30
const TARGET_MESSAGES = 200

const INTERESTS = [
  [1, 'Спорт', 'Sport', 'sport', 'Dumbbell'],
  [2, 'Музыка', 'Music', 'music', 'Music'],
  [3, 'Кино', 'Movies', 'movies', 'Film'],
  [4, 'Книги', 'Books', 'books', 'BookOpen'],
  [5, 'Путешествия', 'Travel', 'travel', 'Globe'],
  [6, 'Кулинария', 'Cooking', 'cooking', 'ChefHat'],
  [7, 'Игры', 'Games', 'games', 'Gamepad2'],
  [8, 'Рисование', 'Art', 'art', 'Palette'],
  [9, 'Фотография', 'Photography', 'photography', 'Camera'],
  [10, 'Технологии', 'Tech', 'tech', 'Cpu'],
  [11, 'Мода', 'Fashion', 'fashion', 'Shirt'],
  [12, 'Танцы', 'Dance', 'dance', 'Music'],
  [13, 'Животные', 'Animals', 'animals', 'Dog'],
  [14, 'Волонтёрство', 'Volunteering', 'volunteering', 'Heart'],
  [15, 'Политика', 'Politics', 'politics', 'Briefcase'],
  [16, 'Психология', 'Psychology', 'psychology', 'Brain'],
  [17, 'Философия', 'Philosophy', 'philosophy', 'BookOpen'],
  [18, 'Йога', 'Yoga', 'yoga', 'HeartPulse'],
  [19, 'Медитация', 'Meditation', 'meditation', 'Sparkles'],
  [20, 'Садоводство', 'Gardening', 'gardening', 'Flower'],
  [21, 'Автомобили', 'Cars', 'cars', 'Car'],
  [22, 'Наука', 'Science', 'science', 'FlaskConical'],
  [23, 'История', 'History', 'history', 'Scroll'],
  [24, 'Архитектура', 'Architecture', 'architecture', 'Building'],
  [25, 'Питомцы', 'Pets', 'pets', 'Dog'],
  [26, 'Кофе', 'Coffee', 'coffee', 'Coffee'],
  [27, 'Своими руками', 'DIY', 'diy', 'Hammer'],
  [28, 'Экстрим', 'Extreme', 'extreme', 'Rocket'],
  [29, 'Фильмы', 'Films', 'films', 'Film'],
  [30, 'Еда', 'Food', 'food', 'Utensils'],
  [31, 'Походы', 'Hiking', 'hiking', 'Mountain'],
  [32, 'Единоборства', 'Martial Arts', 'martial_arts', 'Swords'],
  [33, 'Подкасты', 'Podcasts', 'podcasts', 'Mic'],
  [34, 'Астрономия', 'Astronomy', 'astronomy', 'Star'],
  [35, 'Настольные игры', 'Board Games', 'board_games', 'Gamepad2'],
  [36, 'Природа', 'Nature', 'nature', 'Leaf'],
  [37, 'Дизайн', 'Design', 'design', 'Palette'],
]

const CITIES = ['Москва', 'Санкт-Петербург', 'Казань', 'Новосибирск', 'Екатеринбург', 'Краснодар', 'Сочи', 'Владивосток']
const ZODIACS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы']
const GENDERS = ['male', 'female']
const DATING_GOALS = ['serious_relationship', 'dating', 'just_talk', 'new_friends']
const CIRCADIAN = ['lark', 'owl', 'flexible']

const DEMO_PASSWORD = 'demo123456'
const ADMIN_EMAIL = 'admin@mail.ru'

const MOSCOW_COORDS = [
  [55.7558, 37.6173], [55.7612, 37.6105], [55.7500, 37.6300], [55.7700, 37.5900],
  [55.7400, 37.6500], [55.7800, 37.5700], [55.7450, 37.6200], [55.7650, 37.6050],
  [55.7600, 37.6400], [55.7850, 37.5800], [55.7300, 37.6700], [55.7200, 37.6800],
  [55.7900, 37.5500], [55.7480, 37.6100], [55.7550, 37.6250], [55.7350, 37.6600],
]

const FIRST_NAMES_MALE = ['Александр', 'Максим', 'Дмитрий', 'Иван', 'Артём', 'Михаил', 'Андрей', 'Сергей', 'Алексей', 'Никита',
  'Владимир', 'Павел', 'Егор', 'Кирилл', 'Роман', 'Даниил', 'Тимофей', 'Матвей', 'Илья', 'Глеб',
  'Виктор', 'Олег', 'Константин', 'Вадим', 'Юрий', 'Станислав', 'Руслан', 'Марат', 'Тимур', 'Давид',
  'Захар', 'Борис', 'Георгий', 'Василий', 'Пётр', 'Семён', 'Лев', 'Арсений', 'Фёдор', 'Ярослав']

const FIRST_NAMES_FEMALE = ['Анна', 'Мария', 'Елена', 'София', 'Анастасия', 'Ольга', 'Татьяна', 'Екатерина', 'Наталья', 'Дарья',
  'Виктория', 'Полина', 'Алиса', 'Вероника', 'Ксения', 'Юлия', 'Ирина', 'Светлана', 'Алёна', 'Валерия',
  'Ульяна', 'Маргарита', 'Евгения', 'Людмила', 'Галина', 'Нина', 'Зоя', 'Раиса', 'Лидия', 'Вера',
  'Надежда', 'Любовь', 'Марина', 'Лариса', 'Оксана', 'Таисия', 'Милана', 'Арина', 'Варвара', 'Ева']

const MALE_AVATARS = ['/demo/people/maxim.png', '/demo/people/ivan.png', '/demo/people/artem.png']
const FEMALE_AVATARS = ['/demo/people/anna.png', '/demo/people/elena.png', '/demo/people/sophia.png']

const BIO_MALE = [
  'Люблю активный отдых и путешествия',
  'Ищу интересные знакомства',
  'Rust-разработчик, люблю собак',
  'Футбол, кино, хорошая компания',
  'Путешественник со стажем',
]

const BIO_FEMALE = [
  'Люблю читать и готовить',
  'Ищу серьёзные отношения',
  'Творческая личность, занимаюсь фотографией',
  'Обожаю животных и йогу',
  'Мечтаю объехать весь мир',
]

const GREETINGS = [
  'Привет! Как дела?', 'Привет! Рад познакомиться!', 'Как проходит день?',
  'Привет! Чем занимаешься?', 'Хорошо выглядишь на фото!', 'Привет! Давно тут?',
  'Привет! Люблю твой стиль', 'Как настроение?', 'Привет! Расскажи о себе',
  'Чем увлекаешься?', 'Привет! Отличный профиль', 'Привет! Какие планы на выходные?',
]

const REPLIES = [
  'Привет! Всё отлично, а у тебя?', 'Спасибо! И тебе того же', 'Да вроде норм, работаю',
  'Отлично! Только с тренировки', 'Привет! Всё хорошо', 'Спасибо! Стараюсь',
  'Настроение супер!', 'Всё отлично, спасибо что спросил', 'Давно хотела написать',
  'Ой, спасибо! Приятно', 'Планов много — и все интересные', 'Всё хорошо, отдыхаю',
]

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick(arr) {
  return arr[rand(0, arr.length - 1)]
}

function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

async function main() {
  const conn = await mysql.createConnection({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, database: DB_NAME })
  console.log('Connected to MySQL')

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10)

  const seedUsers = []
  for (let i = 0; i < TOTAL_USERS; i++) {
    const isAdmin = i === 0
    const isBanned = i === 1
    const isPremium = i === 2
    const gender = isAdmin ? 'male' : pick(GENDERS)
    const firstName = gender === 'male' ? FIRST_NAMES_MALE[i % FIRST_NAMES_MALE.length] : FIRST_NAMES_FEMALE[i % FIRST_NAMES_FEMALE.length]
    const age = rand(18, 45)
    const city = pick(CITIES)
    const coord = pick(MOSCOW_COORDS)
    const bio = gender === 'male' ? pick(BIO_MALE) : pick(BIO_FEMALE)
    const avatar = gender === 'male' ? pick(MALE_AVATARS) : pick(FEMALE_AVATARS)
    const zodiac = pick(ZODIACS)
    const circadian = pick(CIRCADIAN)
    const goal = pick(DATING_GOALS)
    const height = gender === 'male' ? rand(170, 195) : rand(158, 180)

    seedUsers.push({
      email: isAdmin ? ADMIN_EMAIL : `user${i}@mail.ru`,
      passwordHash,
      role: isAdmin ? 'admin' : 'user',
      isActive: isBanned ? 0 : 1,
      displayName: firstName,
      age,
      bio,
      avatarUrl: avatar,
      gender,
      lookingFor: gender === 'male' ? 'female' : 'male',
      datingGoal: goal,
      height,
      city,
      lat: coord[0],
      lng: coord[1],
      zodiac,
      circadian,
      superLikes: isPremium ? 10 : 0,
    })
  }

  console.log('Truncating tables...')
  await conn.execute('SET FOREIGN_KEY_CHECKS = 0')
  const tables = [
    'messages', 'chat_participants', 'chats', 'matches',
    'likes', 'user_interests', 'user_photos', 'user_stories', 'user_profiles',
    'notifications', 'reports', 'moderation_log', 'invites', 'push_subscriptions',
    'subscriptions', 'user_blocks', 'saved_filters', 'compatibility_scores',
    'user_sessions', 'activity_log', 'analytics_events', 'posts', 'post_images',
    'post_comments', 'post_likes', 'group_members', 'group_posts', 'group_post_likes',
    'group_post_comments', 'users', 'refresh_tokens', 'sms_verification',
  ]
  for (const t of tables) {
    await conn.execute(`DELETE FROM \`${t}\``).catch(() => {})
  }

  // Reset AUTO_INCREMENT for all tables
  for (const t of [...tables, 'interests', 'compatibility_scores', 'content_config', 'feature_flags', 'message_reactions'].reverse()) {
    await conn.execute(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`).catch(() => {})
  }
  await conn.execute('SET FOREIGN_KEY_CHECKS = 1')
  console.log('Truncated all tables')

  console.log('Inserting interests...')
  for (const [id, ru, en, cat, icon] of INTERESTS) {
    await conn.execute(
      'REPLACE INTO interests (id, name_ru, name_en, category, icon) VALUES (?, ?, ?, ?, ?)',
      [id, ru, en, cat, icon],
    )
  }

  console.log(`Inserting ${seedUsers.length} users...`)
  for (const u of seedUsers) {
    const [result] = await conn.execute(
      'INSERT INTO users (email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
      [u.email, u.passwordHash, u.role, u.isActive],
    )
    const userId = result.insertId

    const genderId = u.gender === 'male' ? 3 : (u.gender === 'female' ? 4 : 1)

    await conn.execute(
      `INSERT INTO user_profiles
       (id, display_name, age, bio, avatar_url, gender, looking_for, dating_goal, height, city, lat, lng, location, zodiac, circadian, super_likes, online, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ST_SRID(POINT(?, ?), 4326), ?, ?, ?, 1, NOW())`,
      [userId, u.displayName, u.age, u.bio, u.avatarUrl, u.gender, u.lookingFor, u.datingGoal, u.height, u.city, u.lat, u.lng, u.lng, u.lat, u.zodiac, u.circadian, u.superLikes],
    )

    const numInterests = rand(2, 5)
    const selectedInterests = pickN(INTERESTS, numInterests)
    for (const [intId] of selectedInterests) {
      await conn.execute('INSERT INTO user_interests (user_id, interest_id) VALUES (?, ?)', [userId, intId])
    }
  }

  console.log('Inserting feature_flags and content_config...')
  await conn.execute('REPLACE INTO feature_flags (id, video_calls_enabled, ai_icebreakers_enabled, ai_compatibility_enabled, groups_page_enabled, contest_enabled, show_ads, autosearch_enabled) VALUES (1, 1, 1, 1, 1, 1, 0, 1)')
  await conn.execute(`REPLACE INTO content_config (id, interests, dating_goals, education, banned_words) VALUES (1,
    '["cars","architecture","astronomy","martial_arts","gaming","volunteering","design","food","games","art","history","yoga","books","coffee","cooking","meditation","fashion","music","board_games","science","pets","podcasts","nature","psychology","travel","gardening","diy","sport","dance","tech","hiking","philosophy","movies","photography","reading","extreme"]',
    '["serious_relationship","dating","just_talk","new_friends","one_night","family_kids","travel","co_living","penpal","no_commitment"]',
    '["secondary","vocational","incomplete_higher","higher","bachelor","master","candidate","doctor"]',
    '["spam","scam","bot","admin","support"]'
  )`)

  console.log(`Creating ${TARGET_MATCHES} matches and ${TARGET_MESSAGES} messages...`)
  let matchCount = 0
  let msgCount = 0

  for (let i = 0; i < TARGET_MATCHES; i++) {
    const fromId = i + 3
    const toId = (i + 3 + rand(1, 15)) % (TOTAL_USERS - 1) + 3
    if (fromId === toId) continue

    if (i < TARGET_MATCHES / 2) {
      await conn.execute(
        'INSERT INTO likes (from_user_id, to_user_id, type) VALUES (?, ?, ?)',
        [1, fromId, 'like'],
      )
    }

    await conn.execute(
      'INSERT INTO likes (from_user_id, to_user_id, type) VALUES (?, ?, ?)',
      [fromId, toId, 'like'],
    )
    matchCount++

    const [chatResult] = await conn.execute(
      'INSERT INTO chats (is_group, created_at, updated_at) VALUES (0, NOW(), NOW())',
    )
    const chatId = chatResult.insertId

    await conn.execute('INSERT INTO chat_participants (chat_id, user_id, joined_at) VALUES (?, ?, NOW())', [chatId, fromId])
    await conn.execute('INSERT INTO chat_participants (chat_id, user_id, joined_at) VALUES (?, ?, NOW())', [chatId, toId])

    const msgsInChat = Math.min(rand(3, 15), TARGET_MESSAGES - msgCount)
    for (let m = 0; m < msgsInChat; m++) {
      const senderId = m % 2 === 0 ? fromId : toId
      const text = m === 0 ? pick(GREETINGS) : pick(REPLIES)
      await conn.execute(
        'INSERT INTO messages (chat_id, sender_id, text, created_at) VALUES (?, ?, ?, DATE_SUB(NOW(), INTERVAL ? MINUTE))',
        [chatId, senderId, text, msgsInChat - m],
      )
      msgCount++
    }
  }

  console.log(`Created ${matchCount} matches, ${msgCount} messages`)
  console.log('Seed complete!')

  await conn.end()
}

main().catch((err) => {
  console.error('Seed failed:', err.message)
  process.exit(1)
})
