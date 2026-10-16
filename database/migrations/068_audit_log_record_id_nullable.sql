-- 068: audit_log.record_id становится NULL-допустимым.
--
-- Зачем: softDeleteWhere (server/src/audit.js:52-55) пишет аудит массового
-- удаления с recordId: null — при удалении пачки одиночной записи нет, а
-- область удаления лежит в old_values.where. Колонка объявлена
-- `record_id int unsigned NOT NULL` (database/mysql_schema.sql, audit_log),
-- поэтому в strict-режиме MySQL (STRICT_TRANS_TABLES) INSERT падает с
-- ER_BAD_NULL_ERROR (1048), а auditLog (server/src/audit.js:18-20) глотает
-- ошибку: POST /api/admin/users/bulk с action='delete'
-- (server/src/routes/admin/users.js:488) удалял пользователей БЕЗ строки
-- аудита — молча, при зелёных тестах (мок БД не проверяет NOT NULL).
--
-- Проверено живьём 15.10.2026 (MySQL 8.4.3, STRICT_TRANS_TABLES):
--   INSERT INTO audit_log (table_name, record_id, action)
--     VALUES ('user_photos', NULL, 'delete_bulk')
--   -> ERROR 1048 (ER_BAD_NULL_ERROR): Column 'record_id' cannot be null
--   (в таблице ровно 0 строк с record_id = 0 — приведения NULL к 0 не было)
--
-- Питфолл 98 закрыл на этом же пути только ENUM-часть ('delete_bulk' был вне
-- ENUM -> 1265). После его лечения осталась вторая причина отказа, которую не
-- видит ENUM-канон-тест (server/src/__tests__/audit-action-enum.test.js) и не
-- видит мок БД. Канон-тест расширен проверкой «recordId: null в коде -> колонка
-- должна быть nullable», чтобы причина не вернулась.
--
-- Дрейф схемы: объявление есть и в database/mysql_schema.sql (эталон).
-- Идемпотентно: MODIFY COLUMN повторяем и безопасен.

SET @n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log'
    AND COLUMN_NAME = 'record_id' AND IS_NULLABLE = 'NO'
);
SET @ddl = IF(@n = 1,
  'ALTER TABLE audit_log MODIFY COLUMN record_id int unsigned DEFAULT NULL',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
