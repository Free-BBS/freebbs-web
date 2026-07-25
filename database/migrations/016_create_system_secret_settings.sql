ALTER TABLE app_settings
    MODIFY COLUMN setting_value TEXT NOT NULL;

CREATE TABLE IF NOT EXISTS system_secret_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    ciphertext MEDIUMBLOB NOT NULL,
    iv BINARY(12) NOT NULL,
    auth_tag BINARY(16) NOT NULL,
    last_four VARCHAR(8) NOT NULL DEFAULT '',
    updated_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_system_secret_settings_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON DELETE SET NULL
);
