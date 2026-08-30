-- 046: Hangouts boost (этап 87) — «продвинуть свою встречу» (премиум-перк)
-- boosted: 1 = продвинута (поднята в начало ленты своего автора), 0 = обычная.
-- Премиум-перк: только с активной подпиской, лимит 1 активное продвижение на автора.
-- Повторно используется механика pinned из этапа 86: продвинутые поднимаются выше
-- партнёрских закреплённых в ORDER BY ленты /hangouts.
-- Additive (nullable, default 0) — не ломает существующие встречи.

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND COLUMN_NAME = 'boosted'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE hangouts ADD COLUMN boosted TINYINT(1) NOT NULL DEFAULT 0 AFTER capacity',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
