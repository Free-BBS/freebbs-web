CREATE TABLE IF NOT EXISTS course_upload_tokens (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    name VARCHAR(80) NOT NULL,
    token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    token_prefix VARCHAR(12) CHARACTER SET ascii NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_used_at DATETIME NULL,
    revoked_at DATETIME NULL,
    CONSTRAINT fk_course_upload_tokens_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_course_upload_tokens_user (user_id, revoked_at, expires_at)
);

CREATE TABLE IF NOT EXISTS course_uploaded_files (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    course_id BIGINT NOT NULL,
    node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    file_name VARCHAR(180) NOT NULL,
    stored_name VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    content_type VARCHAR(128) CHARACTER SET ascii NOT NULL,
    byte_size INT UNSIGNED NOT NULL,
    sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    uploaded_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_course_uploaded_files_course FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_uploaded_files_user FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE KEY idx_course_uploaded_files_digest (course_id, sha256),
    INDEX idx_course_uploaded_files_node (course_id, node_id)
);
