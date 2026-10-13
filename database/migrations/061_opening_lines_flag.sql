-- 061: feature_flags.opening_lines_enabled — флаг библиотеки готовых первых
-- сообщений (P3 #30 «Opening lines library»).
--
-- Дрейф схемы: колонка объявлена в database/mysql_schema.sql (эталон), но в
-- живой БД её нет, пока миграция не применена. Код её читает в
-- server/src/routes/admin/features.js (SELECT * FROM feature_flags, поле
-- row.opening_lines_enabled) — без колонки значение undefined, и GET
-- /api/admin/features обязан трактовать это как «включено» (Boolean(x ?? true)).
-- Гейт scripts/schema-drift-audit.mjs требует наличие колонки и в схеме,
-- и в миграции.
--
-- Идемпотентно (как 049/051/054/060): повторный запуск ничего не делает.
-- DEFAULT 1: библиотека доступна пользователю по умолчанию (фича — не разрушает
-- данные, её можно выключить тумблером на /admin/features).
-- AFTER b2b_marketplace_enabled — порядок совпадает с mysql_schema.sql, где
-- колонка стоит между b2b_marketplace_enabled и rollout_percent.
-- Индекс не нужен: feature_flags — одна строка (id=1).

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags' AND COLUMN_NAME = 'opening_lines_enabled'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE feature_flags ADD COLUMN opening_lines_enabled tinyint(1) NOT NULL DEFAULT 1 AFTER b2b_marketplace_enabled',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
