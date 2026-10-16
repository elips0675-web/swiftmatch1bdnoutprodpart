-- 069: отписка от email-кампаний (п.8 бэклога) + флаг email_unsubscribe_enabled.
--
-- Зачем: POST /api/admin/campaigns (server/src/routes/admin/messaging.js)
-- отправлял письмо всем активным пользователям, механизма отписки не было —
-- получатель не мог отказаться от рассылки.
--
-- Дрейф схемы: оба объявления есть и в database/mysql_schema.sql (эталон).
-- Идемпотентно: ADD COLUMN и CREATE TABLE защищены проверкой/IF NOT EXISTS,
-- предикат «таблица уже есть в схеме» не даёт упасть на повторном прогоне.

SET @n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feature_flags'
    AND COLUMN_NAME = 'email_unsubscribe_enabled'
);
SET @ddl = IF(@n = 0,
  'ALTER TABLE feature_flags ADD COLUMN email_unsubscribe_enabled tinyint(1) NOT NULL DEFAULT 1',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS `email_unsubscribes` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned DEFAULT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_email_unsubscribes_email` (`email`),
  KEY `idx_email_unsubscribes_user` (`user_id`),
  CONSTRAINT `email_unsubscribes_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
