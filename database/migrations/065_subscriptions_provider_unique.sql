-- 065: UNIQUE (provider, provider_subscription_id) в subscriptions.
--
-- Зачем: server/src/routes/iap.js пишет подписку RevenueCat через
-- `ON DUPLICATE KEY UPDATE`. Уникального ключа по паре (provider,
-- provider_subscription_id) не было — миграция 008 добавила только обычный
-- индекс (idx_subscriptions_provider), поэтому ON DUPLICATE KEY UPDATE не
-- срабатывал и каждое продление (RENEWAL) вставляло новую строку вместо
-- обновления существующей.
--
-- Та же пара — ключ сопоставления для сверки пропущенных оплат:
-- server/src/payment-reconcile.js (applySession → applyPremiumCheckout,
-- server/src/routes/premium.js) ищет подписку по provider =
-- 'stripe' + session.id, а applyPremiumCheckout пишет её в те же колонки.
--
-- Дрейф схемы: объявление есть и в database/mysql_schema.sql (эталон) —
-- гейт scripts/schema-drift-audit.mjs сверяет код со схемой и живой БД.
--
-- Идемпотентно: повторный запуск ничего не делает. Если в БД уже есть
-- дубли пары, ALTER упадёт с ER_DUP_ENTRY — это намеренно: молча выбранный
-- «один из дублей» скрыл бы расхождение подписок вместо того, чтобы его
-- показать.

SET @u = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions' AND INDEX_NAME = 'uq_subscriptions_provider'
);
SET @ddl = IF(@u = 0,
  'ALTER TABLE subscriptions ADD UNIQUE KEY uq_subscriptions_provider (provider, provider_subscription_id)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
