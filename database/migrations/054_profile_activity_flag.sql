-- 054: feature_flags.profile_activity_enabled — флаг вкладки «История изменений».
--
-- Дрейф схемы: колонка объявлена в database/mysql_schema.sql (эталон), но в
-- живой БД её нет, пока миграция не применена. Код её читает в
-- server/src/routes/admin/features.js (SELECT * FROM feature_flags, поле
-- row.profile_activity_enabled) — без колонки значение undefined, и GET
-- /api/admin/features обязан трактовать это как «включено» (Boolean(x ?? true)).
-- Гейт scripts/schema-drift-audit.mjs требует наличие колонки и в схеме,
-- и в миграции.
--
-- Идемпотентно (как 049/051): повторный запуск ничего не делает.
-- DEFAULT 1: флаг включает вкладку по умолчанию (фича — пользователю).
-- Индекс не нужен: feature_flags — одна строка (id=1).

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags' AND COLUMN_NAME = 'profile_activity_enabled'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE feature_flags ADD COLUMN profile_activity_enabled tinyint(1) NOT NULL DEFAULT 1 AFTER partner_offers_enabled',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
