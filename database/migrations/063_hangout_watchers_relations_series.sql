-- 063: watchers, серии/relations и merge для встреч + подписка на юзера (P3 #26).
--
-- Задача: `hangout_watchers` (подписка на встречу без участия),
-- `hangout_series` + `hangouts.series_id` («та же серия», relations),
-- `hangouts.merged_into`/`merged_at` (tombstone для merge дублей) и
-- `user_watches` (qwen #14 — «Интересуют новые люди»: подписка на профиль).
--
-- Дрейф схемы: все три таблицы и три колонки `hangouts` объявлены в
-- database/mysql_schema.sql (эталон). Код читает/пишет:
--   server/src/routes/hangouts.js — hangout_watchers, hangout_series, hangouts.series_id/merged_into
--   server/src/routes/profile.js — user_watches
--   server/src/routes/admin/hangouts.js — hangouts.merged_into/merged_at + переносы по hangout_id
-- Гейт scripts/schema-drift-audit.mjs требует наличие и в схеме, и в живой БД.
--
-- Идемпотентно (как 049/051/054/060/061/062): повторный запуск ничего не делает.
-- Имена ограничений совпадают с mysql_schema.sql, чтобы свежая БД из полной
-- схемы и БД, поднятая миграциями, не расходились.

-- Серии создаются первыми: на них ссылается `hangouts.series_id`.
CREATE TABLE IF NOT EXISTS `hangout_series` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci,
  `created_by` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_hs_creator` (`created_by`),
  CONSTRAINT `fk_hs_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hangout_watchers` (
  `hangout_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`hangout_id`,`user_id`),
  KEY `idx_hw_user` (`user_id`),
  CONSTRAINT `fk_hw_hangout` FOREIGN KEY (`hangout_id`) REFERENCES `hangouts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_hw_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_watches` (
  `watcher_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`watcher_id`,`user_id`),
  KEY `idx_uw_user` (`user_id`),
  CONSTRAINT `fk_uw_watcher` FOREIGN KEY (`watcher_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_uw_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @series_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND COLUMN_NAME = 'series_id'
);
SET @ddl = IF(@series_col = 0,
  'ALTER TABLE hangouts ADD COLUMN series_id int unsigned DEFAULT NULL AFTER user_id',
  'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @series_idx = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND INDEX_NAME = 'idx_hangouts_series'
);
SET @ddl = IF(@series_idx = 0,
  'ALTER TABLE hangouts ADD INDEX idx_hangouts_series (series_id)',
  'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @series_fk = (
  SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND CONSTRAINT_NAME = 'fk_hangouts_series'
);
SET @ddl = IF(@series_fk = 0,
  'ALTER TABLE hangouts ADD CONSTRAINT fk_hangouts_series FOREIGN KEY (series_id) REFERENCES hangout_series (id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @merged_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND COLUMN_NAME = 'merged_into'
);
SET @ddl = IF(@merged_col = 0,
  'ALTER TABLE hangouts ADD COLUMN merged_into int unsigned DEFAULT NULL AFTER status',
  'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;

SET @merged_at_col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND COLUMN_NAME = 'merged_at'
);
SET @ddl = IF(@merged_at_col = 0,
  'ALTER TABLE hangouts ADD COLUMN merged_at datetime DEFAULT NULL AFTER merged_into',
  'SELECT 1');
PREPARE st FROM @ddl; EXECUTE st; DEALLOCATE PREPARE st;
