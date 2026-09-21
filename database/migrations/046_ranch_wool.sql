-- A new counter starts at zero. Historical feeding is not backfilled.
-- Wool belongs to the ranch and never becomes a user_assets inventory item.
CREATE TABLE IF NOT EXISTS user_ranch_wool (
  user_id BIGINT PRIMARY KEY,
  feed_progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  wool_ready INT UNSIGNED NOT NULL DEFAULT 0,
  wool_stored INT UNSIGNED NOT NULL DEFAULT 0,
  last_shear_day VARCHAR(10) NOT NULL DEFAULT '',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_ranch_wool_progress CHECK (feed_progress < 5),
  CONSTRAINT fk_ranch_wool_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
