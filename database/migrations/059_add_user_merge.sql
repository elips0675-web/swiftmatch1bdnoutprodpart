-- 059: merge duplicate profiles — действие 'merge' в audit_log.action.
--
-- Слияние дубликатов аккаунтов (P1 #11) пишет audit-запись об объединении.
-- ENUM audit_log.action раньше не знал 'merge', и запись из auditLog()
-- молча терялась бы в логе из-за ER_TRUNCATED_WRONG_VALUE в строгом режиме —
-- ровно тот класс, что уже был с delete_bulk (питфолл ряда 98). Добавляем
-- значение идемпотентно через information_schema + PREPARE.

SET @ddl := (
  SELECT IF(COLUMN_TYPE NOT LIKE '%merge%',
    'ALTER TABLE audit_log MODIFY COLUMN action enum(''create'',''update'',''delete'',''delete_bulk'',''restore'',''impersonate'',''merge'') COLLATE utf8mb4_unicode_ci NOT NULL',
    'SELECT ''audit_log.action merge exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log' AND COLUMN_NAME = 'action'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;