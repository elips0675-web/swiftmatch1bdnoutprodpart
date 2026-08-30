-- 047: Событийная интеграция (этап 88) — ивент-организаторы: speed-dating, миксеры, мастер-классы
-- Расширяет partner_offers полями события (постер, дата/время, место, линк, capacity) +
-- event_tickets для контроля количества/уникальности проданных билетов.
-- Всё additive (nullable) — не ломает существующие офферы.

SET @e = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_offers' AND COLUMN_NAME = 'event_start'
);
SET @ddl = IF(@e = 0,
  'ALTER TABLE partner_offers
     ADD COLUMN event_start DATETIME NULL AFTER valid_to,
     ADD COLUMN event_end DATETIME NULL AFTER event_start,
     ADD COLUMN location VARCHAR(255) NULL AFTER event_end,
     ADD COLUMN poster_url VARCHAR(500) NULL AFTER location,
     ADD COLUMN event_url VARCHAR(500) NULL AFTER poster_url,
     ADD COLUMN capacity INT UNSIGNED NULL AFTER event_url,
     ADD COLUMN tickets_sold INT UNSIGNED NOT NULL DEFAULT 0 AFTER capacity',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS event_tickets (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  offer_id          INT UNSIGNED NOT NULL,
  user_id           INT UNSIGNED NOT NULL,
  partner_order_id  INT UNSIGNED NULL,
  stripe_session_id VARCHAR(191) NULL,
  amount            DECIMAL(10,2) NULL,
  status            ENUM('pending','paid','refunded') NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at           TIMESTAMP NULL DEFAULT NULL,
  UNIQUE KEY uq_event_ticket (offer_id, user_id),
  INDEX idx_evtick_offer (offer_id),
  INDEX idx_evtick_user (user_id),
  CONSTRAINT fk_event_tickets_offer FOREIGN KEY (offer_id) REFERENCES partner_offers(id) ON DELETE CASCADE,
  CONSTRAINT fk_event_tickets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Демо-организатор событий (ивент-площадка). Комиссия 20% (10–30% маржа за билет).
INSERT INTO partners (name, type, commission_rate, status)
SELECT * FROM (SELECT 'Wild Events', 'deeplink', 20.00, 'active') AS seed
WHERE NOT EXISTS (SELECT 1 FROM partners WHERE name = 'Wild Events');

-- Демо-события: speed-dating, миксер, мастер-класс. Билеты продаются внутри приложения (через partner_offers.price).
INSERT INTO partner_offers
  (partner_id, category, title, description, image_url, deeplink, price, city, placement, status, event_start, event_end, location, poster_url, event_url, capacity, tickets_sold)
SELECT p.id, v.category, v.title, v.description, v.image_url, v.deeplink, v.price, v.city, v.placement, 'active',
       v.event_start, v.event_end, v.location, v.poster_url, v.event_url, v.capacity, 0
FROM (SELECT 'Wild Events' AS pname, 'event' AS category,
             'Speed-dating: знакомства за 3 минуты' AS title,
             'Быстрые свидания для одиноких — за вечер познакомишься с 15+ участниками. Велком-дринк в подарок.' AS description,
             NULL AS image_url,
             'https://swiftmatch.app/events#speed-dating' AS deeplink,
             1500.00 AS price, 'Москва' AS city, 'hangout,chat' AS placement,
             DATE_ADD(CURDATE(), INTERVAL 3 DAY) AS event_start,
             DATE_ADD(CURDATE(), INTERVAL 3 DAY) + INTERVAL 3 HOUR AS event_end,
             'Лофт «Красный Октябрь», Берсеневская наб. 6' AS location,
             NULL AS poster_url,
             'https://swiftmatch.app/events#speed-dating' AS event_url,
             40 AS capacity
      UNION ALL SELECT 'Wild Events', 'event', 'Миксер «Познакомься с городом»: настольные игры и живая музыка',
             'Большая встреча людей по интересам: настолки, живая музыка, нетворкинг. Отличный способ найти новых знакомых и вторую половинку.' AS description,
             NULL, 'https://swiftmatch.app/events#mixer', 1200.00, 'Москва', 'hangout,chat',
             DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_ADD(CURDATE(), INTERVAL 7 DAY) + INTERVAL 4 HOUR,
             'Арт-пространство «Сретенка», ул. Сретенка 27', NULL, 'https://swiftmatch.app/events#mixer', 60
      UNION ALL SELECT 'Wild Events', 'experience', 'Мастер-класс для пар: гончарное дело',
             'Совместное творчество — лучший способ сблизиться. Создай пару керамических изделий под руководством художника.' AS description,
             NULL, 'https://swiftmatch.app/events#pottery', 1800.00, 'Москва', 'hangout,profile',
             DATE_ADD(CURDATE(), INTERVAL 5 DAY), DATE_ADD(CURDATE(), INTERVAL 5 DAY) + INTERVAL 2 HOUR,
             'Студия «Глина», ул. Мясницкая 12', NULL, 'https://swiftmatch.app/events#pottery', 20) AS v
JOIN partners p ON p.name = v.pname
WHERE NOT EXISTS (SELECT 1 FROM partner_offers o JOIN partners p2 ON o.partner_id = p2.id
                  WHERE p2.name = v.pname AND o.title = v.title);
