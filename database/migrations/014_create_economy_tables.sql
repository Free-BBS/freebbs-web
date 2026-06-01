SET @heat_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'heat'
);

SET @heat_migration_sql := IF(
    @heat_column_exists = 0,
    'ALTER TABLE users ADD COLUMN heat BIGINT NOT NULL DEFAULT 0 AFTER manetrons',
    'SELECT 1'
);

PREPARE heat_migration_stmt FROM @heat_migration_sql;
EXECUTE heat_migration_stmt;
DEALLOCATE PREPARE heat_migration_stmt;

CREATE TABLE IF NOT EXISTS user_assets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    asset_key VARCHAR(64) NOT NULL,
    quantity BIGINT NOT NULL DEFAULT 0,
    metadata_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_assets_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    UNIQUE KEY uq_user_assets_user_asset (user_id, asset_key),
    INDEX idx_user_assets_asset_key (asset_key)
);

CREATE TABLE IF NOT EXISTS user_checkins (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    checkin_date DATE NOT NULL,
    streak_count INT NOT NULL DEFAULT 1,
    reward_electrons INT NOT NULL DEFAULT 1,
    fortune_score INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_checkins_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    UNIQUE KEY uq_user_checkins_user_date (user_id, checkin_date),
    INDEX idx_user_checkins_user_date (user_id, checkin_date)
);
