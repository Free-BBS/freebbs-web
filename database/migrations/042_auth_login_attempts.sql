CREATE TABLE IF NOT EXISTS auth_login_attempts (
  scope_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  expires_at DATETIME(3) NOT NULL,
  INDEX idx_auth_login_attempts_expiry (expires_at)
) ENGINE=InnoDB;
