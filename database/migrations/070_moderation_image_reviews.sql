CREATE TABLE IF NOT EXISTS moderation_image_reviews (
    job_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    submission_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    published_version INT UNSIGNED NOT NULL,
    state ENUM('pending', 'confirmed', 'withdrawn') NOT NULL DEFAULT 'pending',
    reviewed_by BIGINT NULL,
    reviewed_at DATETIME(3) NULL,
    review_request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    review_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_moderation_image_review_request (reviewed_by, review_request_id),
    INDEX idx_moderation_image_review_pending (state, created_at, job_id),
    INDEX idx_moderation_image_review_submission (submission_id),
    CONSTRAINT fk_moderation_image_review_job FOREIGN KEY (job_id) REFERENCES moderation_auto_jobs(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_image_review_submission FOREIGN KEY (submission_id) REFERENCES moderation_submissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_moderation_image_review_actor FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
