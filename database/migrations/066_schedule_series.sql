-- Original rules and occurrence anchors survive individual edits and deletions.
CREATE TABLE IF NOT EXISTS schedule_series (
  user_id BIGINT NOT NULL,
  series_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  definition_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, series_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
