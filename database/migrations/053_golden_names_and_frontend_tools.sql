CREATE TABLE IF NOT EXISTS user_golden_names (
    user_id BIGINT PRIMARY KEY,
    expires_at_ms BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_golden_name_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS golden_name_uses (
    user_id BIGINT NOT NULL,
    request_key VARCHAR(64) NOT NULL,
    fingerprint VARCHAR(190) NOT NULL,
    result_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, request_key),
    CONSTRAINT fk_golden_name_use_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS frontend_tools (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    tid VARCHAR(32) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    title VARCHAR(120) NOT NULL,
    description VARCHAR(500) NOT NULL DEFAULT '',
    prompt TEXT NOT NULL,
    html_code MEDIUMTEXT NOT NULL,
    is_published TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_frontend_tools_published_created (is_published, created_at DESC, id DESC),
    INDEX idx_frontend_tools_user_updated (user_id, updated_at DESC, id DESC),
    CONSTRAINT fk_frontend_tools_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
) ENGINE=InnoDB;
