-- 057: журнал доставок вебхуков — webhook_deliveries.
--
-- Зачем отдельная таблица, а не расширение webhook_events: webhook_events —
-- это дедуп (UNIQUE provider+event_id), строка в нём создаётся ВНУТРИ транзакции
-- обработки и откатывается вместе с ней. То есть по ней физически нельзя увидеть
-- доставку, на которой обработка упала: при откате строки не остаётся. Журнал
-- должен фиксировать попытку ДО и независимо от транзакции — потому он живёт
-- отдельно и пишется через pool.query вне транзакции (fail-safe: ошибка журнала
-- не роняет вебхук, см. server/src/webhooks.js).
--
-- Статусы: received (доставка принята, обработка начата) -> processed | failed.
-- Повторная доставка того же события (provider+event_id) увеличивает attempts.
-- Payload хранит исходный event — он же нужен кнопке «Повторить» в админке.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  provider varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  event_id varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  event_type varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  status enum('received','processed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'received',
  payload mediumtext COLLATE utf8mb4_unicode_ci,
  error text COLLATE utf8mb4_unicode_ci,
  attempts int unsigned NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at timestamp NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_delivery (provider, event_id),
  KEY idx_webhook_delivery_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
