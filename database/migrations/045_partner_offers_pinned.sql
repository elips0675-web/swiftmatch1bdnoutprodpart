-- 045: Partner offers pinned / sponsored (этап 86) — «закреплённые/спонсорские карточки» в ленте /hangouts
-- pinned: 1 = закреплён (спонсор), 0/0 = обычный оффер. Админ ставит в admin-partners.tsx.
-- Закреплённые офферы поднимаются в начало ленты /hangouts (ORDER BY po.pinned DESC) с бейджем «Sponsored».
-- Additive (nullable, default 0) — не ломает существующие офферы.

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'partner_offers' AND COLUMN_NAME = 'pinned'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE partner_offers ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER placement',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
