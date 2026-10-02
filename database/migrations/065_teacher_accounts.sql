ALTER TABLE users MODIFY student_id VARCHAR(10) NULL;

CREATE TABLE IF NOT EXISTS account_identity_codes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    email VARCHAR(128) NOT NULL,
    purpose ENUM('bind_email', 'reset_password') NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_identity_codes_user (user_id, purpose, id),
    INDEX idx_identity_codes_email (email, created_at),
    CONSTRAINT fk_identity_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS account_student_requests (
    user_id BIGINT PRIMARY KEY,
    student_id VARCHAR(10) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT NULL,
    INDEX idx_student_requests_status (status, requested_at),
    CONSTRAINT fk_student_requests_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_student_requests_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
