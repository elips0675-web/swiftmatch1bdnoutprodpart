-- 049: Hangouts view counter (H2) — колонка view_count в таблице hangouts.
-- Инкрементируется при открытии детальной страницы встречи (/api/hangouts/:id).
-- Используется для отображения популярности на карточке ленты и в деталях.
-- Additive (nullable, default 0) — не ломает существующие встречи.

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND COLUMN_NAME = 'view_count'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE hangouts ADD COLUMN view_count INT NOT NULL DEFAULT 0 AFTER boosted',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Индексация популярности для сортировки/фильтра по просмотрам
SET @i = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'hangouts' AND INDEX_NAME = 'idx_hangouts_view_count'
);
SET @ddl2 = IF(@i = 0,
  'CREATE INDEX idx_hangouts_view_count ON hangouts (view_count)',
  'SELECT 1');
PREPARE s2 FROM @ddl2; EXECUTE s2; DEALLOCATE PREPARE s2;
