-- 052: refresh_tokens.ip_address + user_agent — «активные сессии» должны быть видны пользователю.
--
-- P0 #5 был не «нет данных», а «данные есть, но зашифрованы»: таблица хранила
-- только fingerprint = SHA256(IP + '|' + User-Agent), обрезанный до 32 символов
-- (миграция 042, server/src/routes/auth.js makeFingerprint). Хэш не обратим, поэтому
-- показать пользователю «Chrome на Windows, 203.0.113.7» было физически нечем:
-- ни IP, ни User-Agent, ни модель устройства в базе не лежали.
--
-- Отдельно найдено: таблица user_sessions (mysql_schema.sql:1308) с колонками
-- ip_address/user_agent существует, но НИГДЕ не заполняется — единственные
-- обращения к ней это DELETE в server/src/routes/gdpr.js:96 и очистка в seed.js:180.
-- То есть хранилище сессий в проекте одно (refresh_tokens), а второе пустое и
-- создаёт иллюзию «сессии где-то учитываются». Этот дефект не закрывается здесь
-- (удаление таблицы — отдельная миграция с проверкой на живых данных), но
-- зафиксирован в бэклоге, чтобы пустое хранилище не выдавали за рабочее.
--
-- Семантика: ip_address/user_agent пишутся на КАЖДЫЙ выпущенный refresh-токен,
-- включая ротацию внутри семейства. Поэтому у одной «семьи» (одной сессии
-- вкладки) значения могут различаться между устройствами — список сессий
-- показывает значения последнего токена семьи, то есть актуальные.
--
-- Идемпотентно (как 051): повторный запуск ничего не делает.
-- Nullable: у старых токенов данных нет, колонки не NOT NULL.
-- Длина повторяет максимум из user_sessions (45 = длина IPv6, 500 = User-Agent),
-- чтобы при возможной миграции на неё не ломалось.

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'refresh_tokens' AND COLUMN_NAME = 'ip_address'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE refresh_tokens ADD COLUMN ip_address VARCHAR(45) NULL AFTER fingerprint',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @p2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'refresh_tokens' AND COLUMN_NAME = 'user_agent'
);
SET @ddl2 = IF(@p2 = 0,
  'ALTER TABLE refresh_tokens ADD COLUMN user_agent VARCHAR(500) NULL AFTER ip_address',
  'SELECT 1');
PREPARE s2 FROM @ddl2; EXECUTE s2; DEALLOCATE PREPARE s2;