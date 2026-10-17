CREATE TABLE IF NOT EXISTS moderation_ai_runs (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reviewer_id BIGINT NULL,
    submission_version INT UNSIGNED NOT NULL,
    content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    INDEX idx_moderation_ai_submission (submission_id, created_at, id),
    INDEX idx_moderation_ai_expiry (expires_at),
    CONSTRAINT fk_moderation_ai_submission FOREIGN KEY (submission_id) REFERENCES moderation_submissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_ai_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderation_ai_feedback (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reviewer_id BIGINT NULL,
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    feedback_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_moderation_feedback_request (reviewer_id, request_id),
    INDEX idx_moderation_feedback_run (run_id, id),
    CONSTRAINT fk_moderation_feedback_run FOREIGN KEY (run_id) REFERENCES moderation_ai_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_feedback_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS moderation_regression_cases (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    run_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    feedback_id BIGINT NOT NULL,
    reviewer_id BIGINT NULL,
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    case_json JSON NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_moderation_regression_request (reviewer_id, request_id),
    INDEX idx_moderation_regression_expiry (expires_at),
    CONSTRAINT fk_moderation_regression_run FOREIGN KEY (run_id) REFERENCES moderation_ai_runs(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_regression_feedback FOREIGN KEY (feedback_id) REFERENCES moderation_ai_feedback(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_regression_reviewer FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
