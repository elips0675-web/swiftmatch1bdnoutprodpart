-- 060: feature_flags.rollout_percent — процент пользователей, которым
-- доступны включённые флаги (P2 #17 «Feature flag rollout %»).
--
-- Дрейф схемы: колонка объявлена в database/mysql_schema.sql (эталон), но в
-- живой БД её нет, пока миграция не применена. Код читает её в
-- server/src/routes/admin/features.js (SELECT * FROM feature_flags, поле
-- row.rollout_percent) — без колонки значение undefined, и GET
-- /api/admin/features обязан трактовать это как 100 (весь выкат виден всем).
-- Гейт scripts/schema-drift-audit.mjs требует колонку и в схеме, и в миграции.
--
-- Идемпотентно (как 049/051/054): повторный запуск ничего не делает.
-- DEFAULT 100: пока процент не управляется из админки, видят все — поведение
-- не меняется. TINYINT UNSIGNED 0..255, код валидирует 0..100 через intField;
-- при FF >= 100 флаг доступен всем, bucket пользователя не участвует.
-- Индекс не нужен: feature_flags — одна строка (id=1).

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags' AND COLUMN_NAME = 'rollout_percent'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE feature_flags ADD COLUMN rollout_percent tinyint unsigned NOT NULL DEFAULT 100 AFTER b2b_marketplace_enabled',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;