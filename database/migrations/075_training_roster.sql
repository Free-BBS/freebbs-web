CREATE TABLE IF NOT EXISTS training_roster (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    full_name VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
    staff_role ENUM('member', 'minister') NOT NULL,
    token_hash BINARY(32) NOT NULL UNIQUE,
    created_by BIGINT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_by BIGINT NULL,
    claimed_at TIMESTAMP NULL,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (claimed_by) REFERENCES users (id) ON DELETE SET NULL
) DEFAULT CHARSET=utf8mb4;
