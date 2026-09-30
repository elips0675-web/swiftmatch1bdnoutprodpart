-- 051: user_profiles.birth_date — дата рождения пользователя.
--
-- Дрейф схемы: колонка объявлена в database/mysql_schema.sql:1261 (эталон),
-- но ни одна миграция её не создавала. Код её использует в трёх местах
-- server/src/routes/profile.js: SELECT (строка 384), разбор тела PUT (421),
-- UPDATE в PUT /api/profile/:id (450). Любое сохранение профиля падало с
-- ERROR 1054 (42S22) Unknown column 'birth_date' in 'field list' -> HTTP 500,
-- то есть /profile/edit не сохранял НИЧЕГО: ни имени, ни био, ни города.
--
-- Миграция 049 показала тот же класс дефекта (hangouts.view_count), поэтому
-- начиная с этой миграции колонки, используемые кодом, обязаны появляться
-- и в database/migrations/, и проверяться гейтом scripts/schema-drift-audit.mjs.
--
-- Идемпотентно (как 049): повторный запуск ничего не делает.
-- Nullable: у старых аккаунтов даты нет, age продолжает храниться отдельно.
-- Индекс не нужен: birth_date используется только для пересчёта age при сохранении,
-- выборок по диапазону дат в коде нет.

SET @p = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'birth_date'
);
SET @ddl = IF(@p = 0,
  'ALTER TABLE user_profiles ADD COLUMN birth_date DATE DEFAULT NULL AFTER age',
  'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
