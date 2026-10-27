-- 073: карточка брони в сообщении чата (card_type/card_payload).
--
-- Зачем: «Поделиться бронью в чат» обещало карточку, но сервер
-- (server/src/routes/partners.js, POST /api/partners/booking/share) только
-- отправлял socket-событие partner:restaurant_shared в комнату chat:<id>,
-- которую никто не join'ил. Сообщение в messages не вставлялось, история чата
-- карточку не знала, а получатель события не слушал вовсе.
--
-- Теперь бронь пишется в messages обычной строкой с типом карточки:
-- card_type = 'booking', card_payload = JSON с заголовком, партнёром, датой,
-- временем, числом гостей и комментарием. Текст сообщения остаётся
-- человекочитаемым превью для списка чатов.
--
-- Дрейф схемы: то же объявление есть в database/mysql_schema.sql (эталон,
-- таблица messages) — гейт scripts/schema-drift-audit.mjs сверяет код со схемой.
--
-- Идемпотентно через information_schema + PREPARE: повторный прогон ничего не
-- меняет, а частично применённая миграция доводится до конца.

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE messages ADD COLUMN card_type varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER image_url',
    'SELECT ''messages.card_type exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'card_type'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE messages ADD COLUMN card_payload json DEFAULT NULL AFTER card_type',
    'SELECT ''messages.card_payload exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'card_payload'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
