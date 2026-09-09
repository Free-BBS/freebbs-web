CREATE TABLE IF NOT EXISTS registration_challenge_circuits (
    challenge_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
    parameters JSON NOT NULL,
    CONSTRAINT fk_registration_challenge_circuits_challenge
        FOREIGN KEY (challenge_id) REFERENCES registration_challenges (id) ON DELETE CASCADE
);
