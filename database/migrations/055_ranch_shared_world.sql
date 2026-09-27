CREATE TABLE IF NOT EXISTS ranch_world_state (
  id TINYINT UNSIGNED PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  state_json JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
INSERT IGNORE INTO ranch_world_state (id, state_json) VALUES (1, '{"scene":"meadow","events":[]}');
