-- 058: редактирование сообщений чата — edited_at в messages.
--
-- Раньше сообщение после отправки нельзя было исправить: колонки для
-- признака «изменено» не было, и правка текста на месте была бы неотличима
-- от новой отправки. Теперь PUT /api/chats/:chatId/messages/:msgId меняет
-- текст и ставит edited_at = NOW() (только автор, окно 15 минут), а клиент
-- показывает признак «изменено» рядом с временем.
-- Идемпотентно через information_schema + PREPARE.

SET @ddl := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE messages ADD COLUMN edited_at timestamp NULL DEFAULT NULL AFTER deleted_at',
    'SELECT ''messages.edited_at exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'messages' AND COLUMN_NAME = 'edited_at'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;