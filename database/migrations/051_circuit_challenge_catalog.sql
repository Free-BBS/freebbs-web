CREATE TABLE IF NOT EXISTS circuit_challenge_catalog_seeds (
    seed_key VARCHAR(80) PRIMARY KEY,
    challenge_id INT UNSIGNED NOT NULL UNIQUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_challenge_seed_challenge
      FOREIGN KEY (challenge_id) REFERENCES circuit_challenges (id) ON DELETE CASCADE
);
