SET NAMES utf8mb4;
SET CHARACTER_SET_CLIENT=utf8mb4;
SET CHARACTER_SET_CONNECTION=utf8mb4;
SET CHARACTER_SET_RESULTS=utf8mb4;

-- Migration/initdb 03: e2e self-contained seed.
-- Применяется docker-entrypoint-initdb.d ПОСЛЕ 02-data.sql при первом подъёме volume.
-- Зачем: (а) админ-строчка из 02-data могла нести неверный bcrypt; (б) RU-тексты
-- icebreaker_questions/профилей в live-дампе double-encoded mojibake; (в) гарантируем
-- нужных для .auth e2e юзеров. REPLACE по PK — идемпотентно, не дублирует.

-- Пароль demo123456 (bcrypt, gen from seed.js).
REPLACE INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
VALUES
  (1, 'admin@mail.ru', '$2a$10$Mub8ccI8tHazrq0TLPJcDOL2KyeyP6YbCWxk//Er9cuzUC4E3D4v.', 'admin', 1, NOW(), NOW()),
  (3, 'user2@mail.ru', '$2a$10$Mub8ccI8tHazrq0TLPJcDOL2KyeyP6YbCWxk//Er9cuzUC4E3D4v.', 'user', 1, NOW(), NOW()),
  (5, 'user4@mail.ru', '$2a$10$Mub8ccI8tHazrq0TLPJcDOL2KyeyP6YbCWxk//Er9cuzUC4E3D4v.', 'user', 1, NOW(), NOW()),
  (6, 'user5@mail.ru', '$2a$10$Mub8ccI8tHazrq0TLPJcDOL2KyeyP6YbCWxk//Er9cuzUC4E3D4v.', 'user', 1, NOW(), NOW());

-- Профили (правильный кириллический текст вместо mojibake из live-дампа).
REPLACE INTO user_profiles
  (id, display_name, age, bio, gender, looking_for, city, lat, lng, location, online, last_seen)
VALUES
  (1, 'Администратор', 30, 'Admin', 'male', 'female', 'Москва', 55.7558, 37.6173, ST_SRID(POINT(37.6173, 55.7558), 4326), 1, NOW()),
  (3, 'Анна', 28, 'Тестовый профиль user2', 'female', 'male', 'Екатеринбург', 56.8389, 60.6057, ST_SRID(POINT(60.6057, 56.8389), 4326), 1, NOW()),
  (5, 'Дмитрий', 26, 'Тестовый профиль user4', 'male', 'female', 'Казань', 55.7964, 49.1088, ST_SRID(POINT(49.1088, 55.7964), 4326), 1, NOW()),
  (6, 'Елена', 32, 'Тестовый профиль user5', 'female', 'male', 'Санкт-Петербург', 59.9311, 30.3609, ST_SRID(POINT(30.3609, 59.9311), 4326), 1, NOW());

-- Интересы
INSERT IGNORE INTO user_interests (user_id, interest_id) VALUES
  (1, 1), (1, 9), (3, 5), (3, 2), (5, 6), (5, 1), (6, 4), (6, 7);

-- Icebreaker: темы id 1..8
REPLACE INTO icebreaker_themes (id, key_id, icon, color_class, sort_order) VALUES
  (1, 'romantic', 'Heart', 'text-rose-500', 1),
  (2, 'funny', 'Laugh', 'text-amber-500', 2),
  (3, 'hobbies', 'Palette', 'text-violet-500', 3),
  (4, 'travel', 'Plane', 'text-sky-500', 4),
  (5, 'food', 'UtensilsCrossed', 'text-orange-500', 5),
  (6, 'music', 'Music', 'text-emerald-500', 6),
  (7, 'movies', 'Clapperboard', 'text-indigo-500', 7),
  (8, 'deep', 'MessageCircle', 'text-teal-500', 8);

-- Вопросы с явными id 1..40: перезаписывают кривые RU-строки из live-дампа.
REPLACE INTO icebreaker_questions (id, theme_id, text_ru, text_en, sort_order) VALUES
  (1, 1, 'Что для тебя идеальное первое свидание?', 'What does your perfect first date look like?', 1),
  (2, 1, 'Какое самое романтичное, что с тобой делали?', 'What is the most romantic thing someone has done for you?', 2),
  (3, 1, 'Где бы ты хотела, чтобы я увел тебя в будущем?', 'Where would you want me to take you in the future?', 3),
  (4, 1, 'Ты веришь в любовь с первого взгляда или нужно время?', 'Do you believe in love at first sight or does it take time?', 4),
  (5, 1, 'Какие комплименты тебе приятнее всего слышать?', 'What compliments do you like hearing the most?', 5),
  (6, 2, 'Расскажи смешную историю из своей жизни!', 'Tell me a funny story from your life!', 1),
  (7, 2, 'Какая была самая неловкая ситуация на свидании?', 'What was your most awkward date moment?', 2),
  (8, 2, 'Если бы ты была супергероем, какая была бы твоя сила?', 'If you were a superhero, what would your power be?', 3),
  (9, 2, 'Что из твоего детства до сих пор тебя смешит?', 'What from your childhood still makes you laugh?', 4),
  (10, 2, 'Какое самое странное увлечение у твоих друзей?', 'What is the weirdest hobby your friends have?', 5),
  (11, 3, 'Чем ты занимаешься в свободное время?', 'What do you do in your free time?', 1),
  (12, 3, 'Есть ли у тебя хобби, о котором мало кто знает?', 'Do you have a hobby few people know about?', 2),
  (13, 3, 'Какой навык ты хочешь освоить в этом году?', 'What skill do you want to learn this year?', 3),
  (14, 3, 'Что помогает тебе расслабиться после тяжелого дня?', 'What helps you unwind after a long day?', 4),
  (15, 3, 'Какое занятие ты можешь назвать своим guilty pleasure?', 'What activity is your guilty pleasure?', 5),
  (16, 4, 'Какое место мечты ты хочешь посетить?', 'What dream destination do you want to visit?', 1),
  (17, 4, 'Ты больше любишь море или горы?', 'Do you prefer the sea or the mountains?', 2),
  (18, 4, 'Расскажи о лучшем путешествии в твоей жизни', 'Tell me about the best trip of your life', 3),
  (19, 4, 'Ты собираешься с чемоданами заранее или в последний момент?', 'Do you pack early or at the last minute?', 4),
  (20, 4, 'Какая страна тебе интересна по культуре и почему?', 'Which country fascinates you culturally and why?', 5),
  (21, 5, 'Какое твое любимое блюдо?', 'What is your favorite dish?', 1),
  (22, 5, 'Ты сладкоежка или предпочитаешь соленое?', 'Are you into sweets or savory?', 2),
  (23, 5, 'Какое кафе или ресторан ты можешь порекомендовать?', 'What cafe or restaurant would you recommend?', 3),
  (24, 5, 'Ты умеешь готовить? Что у тебя лучше всего получается?', 'Can you cook? What is your best dish?', 4),
  (25, 5, 'Что бы ты заказала на идеальном свидании?', 'What would you order on a perfect date?', 5),
  (26, 6, 'Какая музыка у тебя в плейлисте последнее время?', 'What music has been on your playlist lately?', 1),
  (27, 6, 'Ты ходишь на концерты? Какой был лучший?', 'Do you go to concerts? Which was the best?', 2),
  (28, 6, 'Какая песня у тебя ассоциируется с приятными воспоминаниями?', 'What song reminds you of happy memories?', 3),
  (29, 6, 'Ты больше любишь живой звук или наушники?', 'Do you prefer live sound or headphones?', 4),
  (30, 6, 'Какой музыкальный жанр ты бы никогда не стала слушать?', 'What music genre would you never listen to?', 5),
  (31, 7, 'Какой фильм или сериал посоветуешь?', 'What movie or series would you recommend?', 1),
  (32, 7, 'Ты смотришь фильмы в кинотеатре или дома?', 'Do you watch movies at the cinema or at home?', 2),
  (33, 7, 'Какая кинокартина заставила тебя плакать?', 'What movie made you cry?', 3),
  (34, 7, 'Кто твой любимый герой из киновселенной?', 'Who is your favorite character from any movie universe?', 4),
  (35, 7, 'Какой сериал ты пересматриваешь по несколько раз?', 'What series do you rewatch again and again?', 5),
  (36, 8, 'Что для тебя важнее: стабильность или приключения?', 'What matters more to you: stability or adventure?', 1),
  (37, 8, 'Какая черта характера тебе нравится в людях больше всего?', 'What personality trait do you value most in people?', 2),
  (38, 8, 'О чем ты мечтаешь, когда смотришь в небо?', 'What do you dream about when you look at the sky?', 3),
  (39, 8, 'Что бы ты сказала себе десятилетней давности?', 'What would you tell yourself ten years ago?', 4),
  (40, 8, 'Какое достижение в жизни тебя больше всего гордит?', 'What achievement in life are you most proud of?', 5);

-- feature_flags / content_config — стандартный дефолт (как в seed.js).
REPLACE INTO feature_flags (id, video_calls_enabled, ai_icebreakers_enabled, ai_compatibility_enabled, groups_page_enabled, contest_enabled, show_ads, autosearch_enabled)
VALUES (1, 1, 1, 1, 1, 1, 0, 1);

REPLACE INTO content_config (id, interests, dating_goals, education, banned_words) VALUES (1,
  '["cars","architecture","astronomy","martial_arts","gaming","volunteering","design","food","games","art","history","yoga","books","coffee","cooking","meditation","fashion","music","board_games","science","pets","podcasts","nature","psychology","travel","gardening","diy","sport","dance","tech","hiking","philosophy","movies","photography","reading","extreme"]',
  '["serious_relationship","dating","just_talk","new_friends","one_night","family_kids","travel","co_living","penpal","no_commitment"]',
  '["secondary","vocational","incomplete_higher","higher","bachelor","master","candidate","doctor"]',
  '["спам","мошенничество","фейк","скам","развод","обман","реклама","казино","ставки","заработок","крипта","инвестиции","наркотики","закладки","продажа","куплю","порно","секс"]');