CREATE TABLE IF NOT EXISTS moderation_auto_control (
    id TINYINT PRIMARY KEY,
    paused TINYINT(1) NOT NULL DEFAULT 1,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    changed_by BIGINT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_moderation_auto_control_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT IGNORE INTO moderation_auto_control (id, paused, revision) VALUES (1, 1, 1);

CREATE TABLE IF NOT EXISTS moderation_auto_jobs (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    submission_version INT UNSIGNED NOT NULL,
    content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    state ENUM('queued', 'running', 'review', 'blocked', 'published', 'cancelled', 'withdrawn') NOT NULL DEFAULT 'queued',
    lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_until DATETIME(3) NULL,
    attempts INT UNSIGNED NOT NULL DEFAULT 0,
    control_revision BIGINT UNSIGNED NULL,
    input_meta_json JSON NULL,
    result_json JSON NULL,
    model VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    settings_revision BIGINT UNSIGNED NULL,
    policy_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    reason_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    published_version INT UNSIGNED NULL,
    withdrawn_by BIGINT NULL,
    withdrawal_request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    withdrawal_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    withdrawal_reason VARCHAR(1000) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    purged_at DATETIME(3) NULL,
    UNIQUE KEY uq_moderation_auto_submission (submission_id, submission_version),
    UNIQUE KEY uq_moderation_auto_withdrawal (withdrawn_by, withdrawal_request_id),
    INDEX idx_moderation_auto_queue (state, created_at, id),
    INDEX idx_moderation_auto_lease (state, lease_until),
    INDEX idx_moderation_auto_expiry (purged_at, expires_at),
    CONSTRAINT fk_moderation_auto_submission FOREIGN KEY (submission_id) REFERENCES moderation_submissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_auto_withdrawer FOREIGN KEY (withdrawn_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
