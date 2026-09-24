CREATE TABLE IF NOT EXISTS circuit_challenges (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    target_json MEDIUMTEXT NOT NULL,
    tolerance DOUBLE NOT NULL DEFAULT 0.06,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_challenges_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_circuit_challenges_editor FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_circuit_challenges_active (is_active, id)
);

CREATE TABLE IF NOT EXISTS circuit_challenge_submissions (
    id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    challenge_id INT UNSIGNED NOT NULL,
    challenge_revision INT UNSIGNED NOT NULL,
    user_id BIGINT NOT NULL,
    component_count SMALLINT UNSIGNED NOT NULL,
    error_score DOUBLE NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_challenge_submissions_challenge FOREIGN KEY (challenge_id) REFERENCES circuit_challenges (id) ON DELETE CASCADE,
    CONSTRAINT fk_circuit_challenge_submissions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_circuit_challenge_rank (challenge_id, challenge_revision, component_count, error_score, created_at),
    INDEX idx_circuit_challenge_user (user_id, created_at)
);
