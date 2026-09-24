ALTER TABLE announcements
  ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE AFTER body;

ALTER TABLE consultations
  ADD COLUMN visibility ENUM('public', 'private') NOT NULL DEFAULT 'private' AFTER body;

CREATE TABLE IF NOT EXISTS information_replies (
  id VARCHAR(64) PRIMARY KEY,
  target_type ENUM('announcement', 'consultation') NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  author_uid VARCHAR(128) NOT NULL,
  reply_kind ENUM('reply', 'supplement') NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_information_replies_target (target_type, target_id, created_at),
  INDEX idx_information_replies_author (author_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS information_likes (
  id VARCHAR(64) PRIMARY KEY,
  target_type ENUM('announcement', 'consultation') NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  user_uid VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_information_like (target_type, target_id, user_uid),
  INDEX idx_information_likes_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
