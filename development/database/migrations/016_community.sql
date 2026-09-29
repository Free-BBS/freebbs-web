CREATE TABLE IF NOT EXISTS community_posts (
  id VARCHAR(64) PRIMARY KEY,
  post_kind ENUM('daily', 'wish', 'festival_showcase') NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  tags JSON NOT NULL,
  display_mode ENUM('named', 'anonymous') NOT NULL,
  source_type VARCHAR(64) NULL,
  source_id VARCHAR(128) NULL,
  status ENUM('active', 'hidden', 'deleted', 'frozen') NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_community_source (source_type, source_id),
  INDEX idx_community_posts_feed (status, post_kind, created_at),
  INDEX idx_community_posts_owner (owner_uid, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS community_comments (
  id VARCHAR(64) PRIMARY KEY,
  post_id VARCHAR(64) NOT NULL,
  parent_id VARCHAR(64) NULL,
  author_uid VARCHAR(128) NOT NULL,
  body TEXT NOT NULL,
  display_mode ENUM('named', 'anonymous') NOT NULL,
  status ENUM('active', 'hidden', 'deleted', 'frozen') NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_community_comments_post (post_id, status, created_at),
  INDEX idx_community_comments_parent (parent_id),
  CONSTRAINT fk_community_comments_post FOREIGN KEY (post_id) REFERENCES community_posts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_community_comments_parent FOREIGN KEY (parent_id) REFERENCES community_comments(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS community_supplements (
  id VARCHAR(64) PRIMARY KEY,
  post_id VARCHAR(64) NOT NULL,
  author_uid VARCHAR(128) NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_community_supplements_post (post_id, created_at),
  CONSTRAINT fk_community_supplements_post FOREIGN KEY (post_id) REFERENCES community_posts(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS community_likes (
  id VARCHAR(64) PRIMARY KEY,
  target_type ENUM('post', 'comment') NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  user_uid VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_community_like (target_type, target_id, user_uid),
  INDEX idx_community_likes_target (target_type, target_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS community_thread_aliases (
  id VARCHAR(64) PRIMARY KEY,
  thread_id VARCHAR(64) NOT NULL,
  user_uid VARCHAR(128) NOT NULL,
  alias_index INT UNSIGNED NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_community_alias_user (thread_id, user_uid),
  UNIQUE KEY uq_community_alias_index (thread_id, alias_index),
  CONSTRAINT fk_community_alias_thread FOREIGN KEY (thread_id) REFERENCES community_posts(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS community_views (
  id VARCHAR(64) PRIMARY KEY,
  post_id VARCHAR(64) NOT NULL,
  user_uid VARCHAR(128) NOT NULL,
  bucket_start DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_community_view_bucket (post_id, user_uid, bucket_start),
  INDEX idx_community_views_post_time (post_id, bucket_start),
  CONSTRAINT fk_community_views_post FOREIGN KEY (post_id) REFERENCES community_posts(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS community_reports (
  id VARCHAR(64) PRIMARY KEY,
  post_id VARCHAR(64) NOT NULL,
  reporter_uid VARCHAR(128) NOT NULL,
  reason VARCHAR(500) NOT NULL,
  resolution TEXT NULL,
  handled_by_uid VARCHAR(128) NULL,
  status ENUM('open', 'resolved', 'dismissed') NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_community_reports_status (status, created_at),
  INDEX idx_community_reports_post (post_id),
  CONSTRAINT fk_community_reports_post FOREIGN KEY (post_id) REFERENCES community_posts(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS community_wish_workflows (
  id VARCHAR(64) PRIMARY KEY,
  post_id VARCHAR(64) NOT NULL,
  wish_status ENUM('collecting', 'responded', 'planning', 'realized') NOT NULL,
  official_response TEXT NULL,
  response_by_uid VARCHAR(128) NULL,
  conversion_status ENUM('none', 'requested', 'approved') NOT NULL,
  conversion_payload JSON NULL,
  activity_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_community_wish_post (post_id),
  UNIQUE KEY uq_community_wish_activity (activity_id),
  INDEX idx_community_wish_status (wish_status, updated_at),
  CONSTRAINT fk_community_wish_post FOREIGN KEY (post_id) REFERENCES community_posts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_community_wish_activity FOREIGN KEY (activity_id) REFERENCES activities(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE activities
  ADD COLUMN source_community_post_id VARCHAR(64) NULL AFTER standing_activity,
  ADD UNIQUE KEY uq_activities_source_community_post (source_community_post_id),
  ADD CONSTRAINT fk_activities_source_community_post
    FOREIGN KEY (source_community_post_id) REFERENCES community_posts(id) ON DELETE SET NULL;
