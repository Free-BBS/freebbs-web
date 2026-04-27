CREATE TABLE IF NOT EXISTS ai_dialogs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    did VARCHAR(36) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    title VARCHAR(120) NOT NULL,
    messages_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ai_dialogs_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    INDEX idx_ai_dialogs_user_updated_at (user_id, updated_at DESC)
);
