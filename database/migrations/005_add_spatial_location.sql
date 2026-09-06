-- Add spatial location column for geospatial search (MySQL 8.0+)
SET @exist_location := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_profiles' AND COLUMN_NAME = 'location');

SET @sql = IF(@exist_location = 0,
  'ALTER TABLE user_profiles ADD COLUMN location POINT SRID 4326 AFTER lng',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_index := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_profiles' AND INDEX_NAME = 'idx_location');

-- Backfill from existing lat/lng (only for rows with location IS NULL)
UPDATE user_profiles SET location = ST_SRID(POINT(COALESCE(lng, 0), COALESCE(lat, 0)), 4326)
  WHERE lat IS NOT NULL AND lng IS NOT NULL AND (location IS NULL OR ST_AsText(location) IS NULL);

-- Set default location for remaining NULL rows
UPDATE user_profiles SET location = ST_SRID(POINT(0, 0), 4326) WHERE location IS NULL;

SET @sql = IF(@exists_index = 0,
  'ALTER TABLE user_profiles MODIFY COLUMN location POINT SRID 4326 NOT NULL, ADD SPATIAL INDEX idx_location (location)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
