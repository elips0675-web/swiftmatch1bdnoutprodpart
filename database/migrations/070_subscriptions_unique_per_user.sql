-- 070: UNIQUE (provider, provider_subscription_id) -> (+ user_id) в subscriptions.
--
-- Зачем: server/src/routes/iap.js кладёт в provider_subscription_id не id
-- подписки магазина, а product_id (gold_1m, plus_1m, ...) — он одинаков у всех
-- покупателей. С UNIQUE (provider, provider_subscription_id) ключ становился
-- общим на весь продукт: первую строку занимал первый купивший, а
-- `ON DUPLICATE KEY UPDATE` на покупке второго молча обновлял ЧУЖУЮ строку.
-- Второй пользователь оставался без подписки: /api/iap/status отдавал
-- active:false, tier:null, хотя вебхук отвечал 200 received:true.
-- Нашёл E2E-спек e2e/iap-webhook.spec.ts.
--
-- Пара (provider, provider_subscription_id) остаётся ключом сопоставления:
-- server/src/routes/premium.js (Stripe, provider_subscription_id = session.id)
-- ищет подписку этой парой — добавление user_id в уникальный ключ на SELECT
-- не влияет, левый префикс ключа сохранён.
--
-- Дрейф схемы: объявление есть и в database/mysql_schema.sql (эталон) —
-- гейт scripts/schema-drift-audit.mjs сверяет код со схемой и живой БД.
--
-- Идемпотентно: старый ключ (2 колонки) снимается, новый (3 колонки)
-- добавляется. Расширение уникального ключа не может дать ER_DUP_ENTRY, пока
-- старый ключ на месте; если старого нет, а дубли есть, ALTER упадёт — это
-- намеренно: молча выбранный «один из дублей» скрыл бы расхождение подписок.

SET @cols = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'subscriptions'
    AND INDEX_NAME = 'uq_subscriptions_provider'
);

SET @sql = IF(@cols = 2, 'ALTER TABLE `subscriptions` DROP INDEX `uq_subscriptions_provider`', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @cols = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'subscriptions'
    AND INDEX_NAME = 'uq_subscriptions_provider'
);

SET @sql = IF(@cols = 0, 'ALTER TABLE `subscriptions` ADD UNIQUE KEY `uq_subscriptions_provider` (`provider`,`provider_subscription_id`,`user_id`)', 'SELECT 1');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
