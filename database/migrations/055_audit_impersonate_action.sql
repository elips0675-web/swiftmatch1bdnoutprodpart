-- 055: audit_log.action += 'impersonate' — журнал входа админа как пользователь.
--
-- Дрейф схемы: значение ENUM объявлено в database/mysql_schema.sql (эталон), но в
-- живой БД его нет, пока миграция не применена. Код пишет action='impersonate'
-- из server/src/routes/admin/users.js (POST /api/admin/impersonate/:userId) —
-- без нового значения MySQL отклонит INSERT (1265 Data truncated), аудит
-- impersonation молча потеряется, а гейт scripts/check-enum-constraints.mjs
-- требует, чтобы литерал в коде лежал внутри ENUM.
--
-- MODIFY на надмножество идемпотентен: повторный запуск оставляет тот же набор.
-- Существующие строки ('create','update','delete','restore') сохраняются.

ALTER TABLE audit_log
  MODIFY COLUMN action enum('create','update','delete','restore','impersonate')
  COLLATE utf8mb4_unicode_ci NOT NULL;
