SET @exist_moderation_status := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_photos' AND COLUMN_NAME = 'moderation_status');
SET @exist_moderation_reason := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_photos' AND COLUMN_NAME = 'moderation_reason');
SET @exist_evidence := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reports' AND COLUMN_NAME = 'evidence');

SET @sql = IF(@exist_moderation_status = 0, 'ALTER TABLE user_photos ADD COLUMN moderation_status VARCHAR(20) DEFAULT \'approved\'', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(@exist_moderation_reason = 0, 'ALTER TABLE user_photos ADD COLUMN moderation_reason TEXT', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(@exist_evidence = 0, 'ALTER TABLE reports ADD COLUMN evidence JSON', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
