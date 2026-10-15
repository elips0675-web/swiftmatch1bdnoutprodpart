-- 067: provider_payment_intent в subscriptions + ENUM-значение 'refunded'.
--
-- Зачем колонка: обработчик возврата (server/src/routes/premium.js,
-- applyStripeRefund) должен связать событие `charge.refunded` с подпиской.
-- У события есть `payment_intent`, но нет `session.id`, поэтому хранить
-- payment_intent нужно в самой подписке — иначе связать нечем без сетевого
-- вызова Stripe в момент события. Значение пишет applyPremiumCheckout тем же
-- INSERT-ом (session.payment_intent из события или из сверки
-- server/src/payment-reconcile.js); у mock-подписок и у старых строк оно NULL —
-- значит, возврат по ним не сматчится (известное ограничение, нужен бэкфилл
-- через checkout.sessions.list({ payment_intent })).
--
-- Зачем индекс: поиск подписки по возврату идёт
-- `WHERE provider = 'stripe' AND provider_payment_intent = ?`.
--
-- Зачем 'refunded' в status: MySQL отвечает на значение вне ENUM не 400, а 500
-- (ER_WARN_DATA_TRUNCATED), а возврат — это отдельное состояние, отличное от
-- пользовательской отмены ('canceled') и от истечения срока ('expired'):
-- админка должна видеть возврат как возврат. Гейт
-- scripts/check-enum-constraints.mjs сверяет литералы UPDATE с ENUM.
--
-- Дрейф схемы: объявление есть и в database/mysql_schema.sql (эталон) —
-- гейт scripts/schema-drift-audit.mjs сверяет код со схемой и живой БД.
--
-- Идемпотентно: колонка и индекс добавляются только при отсутствии
-- (information_schema, как 061/064/065/066); MODIFY COLUMN повторяем и он
-- безопасен (значение добавляется в конец ENUM).

SET @c = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions' AND COLUMN_NAME = 'provider_payment_intent'
);
SET @ddl = IF(@c = 0,
  'ALTER TABLE subscriptions ADD COLUMN provider_payment_intent varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER provider_subscription_id',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @i = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'subscriptions' AND INDEX_NAME = 'idx_subscriptions_payment_intent'
);
SET @ddl = IF(@i = 0,
  'ALTER TABLE subscriptions ADD KEY idx_subscriptions_payment_intent (provider_payment_intent)',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE subscriptions MODIFY COLUMN status enum('active','canceled','expired','past_due','refunded') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active';
