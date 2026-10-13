CREATE TABLE IF NOT EXISTS privacy_policy_acceptances (
    user_id BIGINT NOT NULL,
    policy_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    content_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    accepted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_confirmed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (user_id, policy_version),
    CONSTRAINT fk_privacy_policy_acceptance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
