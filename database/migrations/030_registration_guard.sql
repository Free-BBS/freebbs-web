CREATE TABLE IF NOT EXISTS registration_challenges (
    id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    email VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    purpose ENUM('register', 'login') NOT NULL DEFAULT 'register',
    answer_k DOUBLE NOT NULL,
    tolerance DOUBLE NOT NULL,
    expires_at DATETIME NOT NULL,
    consumed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_registration_challenges_expiry (expires_at)
);

CREATE TABLE IF NOT EXISTS registration_challenge_rates (
    scope_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    window_start BIGINT UNSIGNED NOT NULL,
    issued_count INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (scope_hash, window_start),
    INDEX idx_registration_challenge_rates_window (window_start)
);

CREATE TABLE IF NOT EXISTS user_community_agreements (
    user_id BIGINT NOT NULL,
    agreement_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, agreement_version),
    CONSTRAINT fk_user_community_agreements_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
