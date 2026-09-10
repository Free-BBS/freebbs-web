CREATE TABLE IF NOT EXISTS surveys (
  id CHAR(36) PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  questions JSON NOT NULL,
  opens_at DATETIME(3) NOT NULL,
  closes_at DATETIME(3) NOT NULL,
  winner_count INT UNSIGNED NOT NULL,
  draw_mode VARCHAR(10) NOT NULL,
  repeat_days INT UNSIGNED NOT NULL DEFAULT 0,
  next_id CHAR(36) NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft',
  drawn_at DATETIME(3) NULL,
  drawn_by VARCHAR(64) NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX survey_due (status, closes_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS survey_entries (
  id CHAR(36) PRIMARY KEY,
  survey_id CHAR(36) NOT NULL,
  contact VARCHAR(254) NOT NULL,
  receipt_hash CHAR(64) NOT NULL,
  answers JSON NOT NULL,
  winner TINYINT NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY survey_contact (survey_id, contact),
  UNIQUE KEY survey_receipt (receipt_hash),
  FOREIGN KEY (survey_id) REFERENCES surveys(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
