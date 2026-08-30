-- 044: Paid hangouts (этап 85) — платные встречи + таблица билетов
-- price: цена билета в рублях; NULL = бесплатно (RSVP/join как раньше)
-- capacity: макс. число оплаченных билетов; NULL = не ограничивает (лимит = max_companions)
-- hangout_tickets: один оплаченный билет на user за встречу (UNIQUE hangout_id+user_id)
-- Все additive (nullable) — не ломают существующий UGC.

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND COLUMN_NAME = 'price'
);
SET @ddl1 = IF(@p = 0,
  'ALTER TABLE hangouts ADD COLUMN price DECIMAL(10,2) NULL DEFAULT NULL AFTER partner_offer_id',
  'SELECT 1');
PREPARE s1 FROM @ddl1; EXECUTE s1; DEALLOCATE PREPARE s1;

SET @c = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND COLUMN_NAME = 'capacity'
);
SET @ddl2 = IF(@c = 0,
  'ALTER TABLE hangouts ADD COLUMN capacity INT UNSIGNED NULL DEFAULT NULL AFTER price',
  'SELECT 1');
PREPARE s2 FROM @ddl2; EXECUTE s2; DEALLOCATE PREPARE s2;

CREATE TABLE IF NOT EXISTS hangout_tickets (
  id int unsigned NOT NULL AUTO_INCREMENT,
  hangout_id int unsigned NOT NULL,
  user_id int unsigned NOT NULL,
  stripe_session_id varchar(191) DEFAULT NULL,
  amount decimal(10,2) DEFAULT NULL,
  status enum('pending','paid','refunded') NOT NULL DEFAULT 'pending',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at timestamp NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hangout_ticket (hangout_id, user_id),
  KEY idx_tickets_hangout (hangout_id),
  KEY idx_tickets_user (user_id),
  CONSTRAINT fk_hangout_tickets_hangout FOREIGN KEY (hangout_id) REFERENCES hangouts (id) ON DELETE CASCADE,
  CONSTRAINT fk_hangout_tickets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
