ALTER TABLE users MODIFY role ENUM('student', 'ta', 'teacher', 'admin', 'enterprise') DEFAULT 'student';

CREATE TABLE IF NOT EXISTS user_certification_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    slot ENUM('undergraduate', 'master', 'doctor', 'teacher', 'company') NOT NULL,
    year SMALLINT UNSIGNED NULL,
    institution VARCHAR(128) NULL,
    class_name VARCHAR(64) NULL,
    company_name VARCHAR(128) NULL,
    status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    requested_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    reviewed_at DATETIME(3) NULL,
    reviewed_by BIGINT NULL,
    review_note VARCHAR(500) NULL,
    pending_slot VARCHAR(16) GENERATED ALWAYS AS (IF(status = 'pending', slot, NULL)) STORED,
    UNIQUE KEY uq_certification_pending (user_id, pending_slot),
    INDEX idx_certification_requests_user (user_id, id),
    INDEX idx_certification_requests_status (status, id),
    CONSTRAINT fk_certification_request_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_certification_request_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_certifications (
    user_id BIGINT NOT NULL,
    slot ENUM('undergraduate', 'master', 'doctor', 'teacher', 'company') NOT NULL,
    year SMALLINT UNSIGNED NULL,
    institution VARCHAR(128) NULL,
    class_name VARCHAR(64) NULL,
    company_name VARCHAR(128) NULL,
    approved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    approved_by BIGINT NULL,
    source_request_id BIGINT NULL,
    PRIMARY KEY (user_id, slot),
    CONSTRAINT fk_certification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_certification_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_certification_source_request FOREIGN KEY (source_request_id) REFERENCES user_certification_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB;
