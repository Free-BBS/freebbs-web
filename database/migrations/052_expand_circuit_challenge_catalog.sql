SET @challenge_catalog_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'circuit_challenge_catalog_seeds'
     AND COLUMN_NAME = 'seed_revision') = 0,
  'ALTER TABLE circuit_challenge_catalog_seeds ADD COLUMN seed_revision INT UNSIGNED NOT NULL DEFAULT 1 AFTER challenge_id',
  'SELECT 1'
);
PREPARE challenge_catalog_stmt FROM @challenge_catalog_sql;
EXECUTE challenge_catalog_stmt;
DEALLOCATE PREPARE challenge_catalog_stmt;
