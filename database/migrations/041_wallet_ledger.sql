-- Balance snapshots after ledger activation. No invented historical entries.
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  electric_before BIGINT NOT NULL,
  electric_after BIGINT NOT NULL,
  magnetic_before BIGINT NOT NULL,
  magnetic_after BIGINT NOT NULL,
  source_key VARCHAR(160) NULL,
  title VARCHAR(100) NULL,
  reason VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_wallet_user_id (user_id, id),
  UNIQUE KEY uq_wallet_source (user_id, source_key),
  CONSTRAINT fk_wallet_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
