-- 062: команды модерации (P3 #31 «Team/Group scope для модераторов»).
--
-- Задача: модератор видит только жалобы своей команды, а не все
-- (`server/src/routes/admin/reports.js` до этой миграции отдавал все жалобы
-- без фильтра). Роли «модератор» в проекте нет: `users.role` —
-- enum('user','admin'). Скоуп задаётся членством в команде
-- (`moderation_team_members`): админ с командой видит только её жалобы, админ
-- без команды — супер-админ, видит всё. Поэтому миграция не трогает ENUM.
--
-- Дрейф схемы: обе таблицы и колонка `reports.team_id` объявлены в
-- database/mysql_schema.sql (эталон). Код читает:
--   server/src/middleware/adminAuth.js — moderation_team_members.team_id/user_id
--   server/src/routes/report.js — moderation_teams.id/is_active, reports.team_id/status
--   server/src/routes/admin/reports.js — reports.team_id, moderation_teams.id/name
-- Гейт scripts/schema-drift-audit.mjs требует наличие и в схеме, и в живой БД.
--
-- Идемпотентно (как 049/051/054/060/061): повторный запуск ничего не делает.
-- team_id — NULLABLE: legacy-жалобы (созданные до миграции) получают команду
-- «Основная» ниже; ON DELETE SET NULL, чтобы удаление команды не рушило жалобы.

CREATE TABLE IF NOT EXISTS `moderation_teams` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_moderation_teams_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `moderation_team_members` (
  `team_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`team_id`,`user_id`),
  KEY `idx_mtm_user` (`user_id`),
  CONSTRAINT `moderation_team_members_ibfk_1` FOREIGN KEY (`team_id`) REFERENCES `moderation_teams` (`id`) ON DELETE CASCADE,
  CONSTRAINT `moderation_team_members_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'team_id'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE reports ADD COLUMN team_id int unsigned DEFAULT NULL AFTER evidence',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @i = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND INDEX_NAME = 'idx_reports_team'
);
SET @ddl = IF(@i = 0,
  'ALTER TABLE reports ADD KEY idx_reports_team (team_id)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @f = (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND CONSTRAINT_NAME = 'reports_ibfk_3'
);
SET @ddl = IF(@f = 0,
  'ALTER TABLE reports ADD CONSTRAINT reports_ibfk_3 FOREIGN KEY (team_id) REFERENCES moderation_teams (id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Команда приёма по умолчанию: без неё round-robin нечего назначать, и новые
-- жалобы остались бы «ничьими». Сеем только если команд нет вовсе.
SET @seed = (SELECT COUNT(*) FROM moderation_teams);
SET @ddl = IF(@seed = 0,
  'INSERT INTO moderation_teams (name) VALUES (''Основная'')',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Legacy-жалобы (и любые «ничьи») относим к первой команде, чтобы скоупленные
-- модераторы их видели. NULL остаётся только на время между INSERT и этим UPDATE.
UPDATE reports SET team_id = (SELECT id FROM moderation_teams ORDER BY id LIMIT 1) WHERE team_id IS NULL;
