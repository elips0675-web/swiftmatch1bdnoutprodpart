-- 066: feature_flags.hangout_relations_enabled / user_watches_enabled —
-- тумблеры модуля связей (P3 #26 «Watchers/Relations/Merge + user_watches»).
--
-- hangout_relations_enabled: подписка на встречу без участия, «та же серия»
-- и «похожие встречи» на детальной странице, привязка встречи к серии в
-- редакторе. Код читает колонку в server/src/routes/admin/features.js
-- (SELECT * FROM feature_flags, поле row.hangout_relations_enabled); без
-- колонки значение undefined, и GET /api/admin/features обязан трактовать
-- это как «включено» (Boolean(x ?? true)).
--
-- user_watches_enabled: «Интересуют новые люди» — подписка на профиль
-- другого пользователя (server/src/routes/profile.js, /api/users/:id/watch).
--
-- Дрейф схемы: колонки объявлены в database/mysql_schema.sql (эталон), но в
-- живой БД их нет, пока миграция не применена. Гейт
-- scripts/schema-drift-audit.mjs требует наличие колонки и в схеме, и здесь.
--
-- Идемпотентно (как 049/051/054/060/061/064): повторный запуск ничего не делает.
-- DEFAULT 1: модуль доступен по умолчанию, выключается тумблером на
-- /admin/features (ничего не разрушает в данных).
-- AFTER activity_privacy_enabled — порядок совпадает с mysql_schema.sql, где
-- колонки стоят между activity_privacy_enabled и rollout_percent.
-- Индекс не нужен: feature_flags — одна строка (id=1).

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags' AND COLUMN_NAME = 'hangout_relations_enabled'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE feature_flags ADD COLUMN hangout_relations_enabled tinyint(1) NOT NULL DEFAULT 1 AFTER activity_privacy_enabled',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags' AND COLUMN_NAME = 'user_watches_enabled'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE feature_flags ADD COLUMN user_watches_enabled tinyint(1) NOT NULL DEFAULT 1 AFTER hangout_relations_enabled',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
