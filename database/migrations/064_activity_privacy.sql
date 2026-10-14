-- 064: presence + приватность активности (P3 #27, пере-формулированный).
--
-- user_profiles.show_online / show_last_seen — пер-пользовательская видимость
-- статуса активности. Колонки объявлены в database/mysql_schema.sql (эталон);
-- без миграции код их не увидит и трактует отсутствие как «видно»
-- (server/src/presence.js:applyActivityPrivacy — undefined не скрывает) —
-- миграция и схема обязаны сойтись, гейт scripts/schema-drift-audit.mjs.
-- AFTER last_seen — порядок совпадает с mysql_schema.sql.
--
-- feature_flags.activity_privacy_enabled — тумблер UI-переключателей
-- на /admin/features (server/src/routes/admin/features.js). DEFAULT 1:
-- существующие пользователи по умолчанию показывают активность, как раньше.
--
-- Идемпотентно: повторный запуск ничего не делает.

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'show_online'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE user_profiles ADD COLUMN show_online tinyint(1) NOT NULL DEFAULT 1 AFTER last_seen',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'show_last_seen'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE user_profiles ADD COLUMN show_last_seen tinyint(1) NOT NULL DEFAULT 1 AFTER show_online',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags' AND COLUMN_NAME = 'activity_privacy_enabled'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE feature_flags ADD COLUMN activity_privacy_enabled tinyint(1) NOT NULL DEFAULT 1 AFTER opening_lines_enabled',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
