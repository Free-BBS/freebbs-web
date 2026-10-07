CREATE TABLE IF NOT EXISTS moderation_meta (
    setting_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    setting_value VARCHAR(64) NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderation_reviewers (
    user_id BIGINT PRIMARY KEY,
    active TINYINT(1) NOT NULL DEFAULT 1,
    changed_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_moderation_reviewer_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_reviewer_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderation_submissions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    kind ENUM('post', 'comment') NOT NULL,
    author_id BIGINT NULL,
    request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    payload_json JSON NULL,
    attachment_ids_json JSON NULL,
    content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('pending', 'approved', 'rejected', 'expired') NOT NULL DEFAULT 'pending',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    evidence_purged_at DATETIME(3) NULL,
    decided_by BIGINT NULL,
    decided_at DATETIME(3) NULL,
    decision_reason VARCHAR(1000) NULL,
    decision_request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    decision_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    published_id BIGINT NULL,
    published_url VARCHAR(512) NULL,
    UNIQUE KEY uq_moderation_author_request (author_id, request_id),
    UNIQUE KEY uq_moderation_decision_request (decided_by, decision_request_id),
    INDEX idx_moderation_queue (status, created_at, id),
    INDEX idx_moderation_author (author_id, created_at, id),
    INDEX idx_moderation_expiry (evidence_purged_at, expires_at),
    CONSTRAINT fk_moderation_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_moderation_decider FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderation_attachments (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    author_id BIGINT NULL,
    file_name VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    mime_type VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    byte_size BIGINT UNSIGNED NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    bound_content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    published_id BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    purged_at DATETIME(3) NULL,
    INDEX idx_moderation_attachment_submission (submission_id),
    INDEX idx_moderation_attachment_expiry (purged_at, published_id, expires_at),
    CONSTRAINT fk_moderation_attachment_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_moderation_attachment_submission FOREIGN KEY (submission_id) REFERENCES moderation_submissions(id) ON DELETE SET NULL
) ENGINE=InnoDB;
