-- 056: audit_log.action += 'delete_bulk' — закрыт дрейф схемы, из-за которого
-- журнал массового удаления молча терялся.
--
-- Что было не так: server/src/audit.js:55 пишет action='delete_bulk' (массовое
-- soft-delete через softDeleteWhere), но ENUM audit_log.action содержал только
-- ('create','update','delete','restore') — ни 006 (создание таблицы), ни 055
-- (impersonate) его не добавляли. Мок БД в тестах ENUM не проверяет, поэтому
-- тест active-user.test.js:266 зелёный, а в проде (MySQL 8, strict mode) INSERT
-- падал с 1265 Data truncated, который ловит try/catch в auditLog (audit.js:18)
-- и только пишет в лог. То есть каждое массовое удаление шло без строки аудита.
--
-- MODIFY на надмножество идемпотентен; существующие значения сохраняются.
-- Полный набор включает 'impersonate' из 055 — на случай БД, где 055 не
-- применялась, чтобы не откатить уже разрешённое значение.

ALTER TABLE audit_log
  MODIFY COLUMN action enum('create','update','delete','delete_bulk','restore','impersonate')
  COLLATE utf8mb4_unicode_ci NOT NULL;
