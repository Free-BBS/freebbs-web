CREATE TABLE IF NOT EXISTS collection_forms (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  cover_url VARCHAR(1024) NULL,
  organization_id VARCHAR(64) NULL,
  current_draft_version_id VARCHAR(64) NULL,
  published_version_id VARCHAR(64) NULL,
  opens_at DATETIME(3) NULL,
  closes_at DATETIME(3) NULL,
  capacity INT UNSIGNED NULL,
  status ENUM('draft', 'published', 'closed', 'archived') NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_collection_forms_status_time (status, opens_at, closes_at),
  INDEX idx_collection_forms_owner (owner_uid, updated_at),
  INDEX idx_collection_forms_organization (organization_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS collection_versions (
  id VARCHAR(64) PRIMARY KEY,
  form_id VARCHAR(64) NOT NULL,
  version INT UNSIGNED NOT NULL,
  schema_json JSON NOT NULL,
  published_at DATETIME(3) NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_collection_versions_form_version (form_id, version),
  INDEX idx_collection_versions_form (form_id, status),
  CONSTRAINT fk_collection_versions_form FOREIGN KEY (form_id) REFERENCES collection_forms(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS collection_responses (
  id VARCHAR(64) PRIMARY KEY,
  form_id VARCHAR(64) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  respondent_uid VARCHAR(128) NOT NULL,
  attempt INT UNSIGNED NOT NULL,
  answers_json JSON NOT NULL,
  submitted_at DATETIME(3) NOT NULL,
  status ENUM('submitted', 'cancelled') NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_collection_response_attempt (form_id, version_id, respondent_uid, attempt),
  INDEX idx_collection_responses_user (respondent_uid, submitted_at),
  INDEX idx_collection_responses_form (form_id, status),
  CONSTRAINT fk_collection_responses_form FOREIGN KEY (form_id) REFERENCES collection_forms(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_collection_responses_version FOREIGN KEY (version_id) REFERENCES collection_versions(id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS showcase_articles (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  excerpt VARCHAR(500) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  cover_url VARCHAR(1024) NULL,
  external_url VARCHAR(1024) NULL,
  organization_id VARCHAR(64) NULL,
  published_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_showcase_articles_published (status, published_at),
  INDEX idx_showcase_articles_organization (organization_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS showcase_likes (
  id VARCHAR(64) PRIMARY KEY,
  article_id VARCHAR(64) NOT NULL,
  user_uid VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_showcase_like (article_id, user_uid),
  INDEX idx_showcase_likes_article (article_id),
  CONSTRAINT fk_showcase_likes_article FOREIGN KEY (article_id) REFERENCES showcase_articles(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE collection_forms
  ADD CONSTRAINT fk_collection_forms_draft_version
    FOREIGN KEY (current_draft_version_id) REFERENCES collection_versions(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_collection_forms_published_version
    FOREIGN KEY (published_version_id) REFERENCES collection_versions(id) ON DELETE SET NULL;
