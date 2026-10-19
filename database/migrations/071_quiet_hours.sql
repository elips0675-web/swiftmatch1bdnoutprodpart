-- 071: тихие часы (DND) для push-уведомлений (Stage 69, «Нет quiet hours / DND»).
--
-- notification_preferences: четыре колонки настройки «не беспокоить» —
-- включено/выключено, окно ЧЧ:ММ (может переходить через полночь) и часовой
-- пояс пользователя (клиент отдаёт Intl, сервер сравнивает локальное время).
-- Код читает колонки в server/src/quiet-hours.js (getQuiet/quietUserSet) и
-- пишет через saveQuiet; отсутствие строки в таблице = тишина выключена.
--
-- feature_flags.quiet_hours_enabled: тумблер модуля в /admin/features
-- (server/src/routes/admin/features.js GET/PUT, UI-блок в
-- src/components/settings/notification-preferences-section.tsx рендерится
-- только при включённом флаге; серверный гейт в sendPushToUser читает ту же
-- колонку в JOIN — выключение флага снимает тишину сразу у всех).
-- DEFAULT 0: модуль скрыт по умолчанию, владелец включает тумблером
-- (правило «Фича = флаг, по умолчанию off»).
--
-- Дрейф схемы: обе заявки есть и в database/mysql_schema.sql (эталон), гейт
-- scripts/schema-drift-audit.mjs требует и схему, и миграцию.
-- Идемпотентно (как 049/066/069): повторный запуск ничего не делает.

SET @n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_preferences'
    AND COLUMN_NAME = 'quiet_enabled'
);
SET @ddl = IF(@n = 0,
  'ALTER TABLE notification_preferences ADD COLUMN quiet_enabled tinyint(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_preferences'
    AND COLUMN_NAME = 'quiet_start'
);
SET @ddl = IF(@n = 0,
  'ALTER TABLE notification_preferences ADD COLUMN quiet_start varchar(5) NOT NULL DEFAULT ''22:00''',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_preferences'
    AND COLUMN_NAME = 'quiet_end'
);
SET @ddl = IF(@n = 0,
  'ALTER TABLE notification_preferences ADD COLUMN quiet_end varchar(5) NOT NULL DEFAULT ''08:00''',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_preferences'
    AND COLUMN_NAME = 'quiet_timezone'
);
SET @ddl = IF(@n = 0,
  'ALTER TABLE notification_preferences ADD COLUMN quiet_timezone varchar(64) NOT NULL DEFAULT ''UTC''',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags'
    AND COLUMN_NAME = 'quiet_hours_enabled'
);
SET @ddl = IF(@n = 0,
  'ALTER TABLE feature_flags ADD COLUMN quiet_hours_enabled tinyint(1) NOT NULL DEFAULT 0',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
