-- Public circuit IDs and immutable revision snapshots. Account deletion retains citations.
CREATE TABLE IF NOT EXISTS circuits (
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    owner_id BIGINT NULL,
    current_revision INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuits_owner FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_circuits_owner_updated (owner_id, updated_at, cid)
);

CREATE TABLE IF NOT EXISTS circuit_revisions (
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision INT UNSIGNED NOT NULL,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    created_by BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (cid, revision),
    CONSTRAINT fk_circuit_revisions_circuit FOREIGN KEY (cid) REFERENCES circuits (cid) ON DELETE CASCADE,
    CONSTRAINT fk_circuit_revisions_author FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
);
