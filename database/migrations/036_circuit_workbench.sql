CREATE TABLE IF NOT EXISTS circuit_revision_events (
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    revision INT UNSIGNED NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'save',
    message VARCHAR(240) NOT NULL DEFAULT '',
    source_cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
    source_revision INT UNSIGNED NULL,
    PRIMARY KEY (cid, revision),
    FOREIGN KEY (cid, revision) REFERENCES circuit_revisions(cid, revision) ON DELETE CASCADE
  );

CREATE TABLE IF NOT EXISTS circuit_reports (
    id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    owner_id BIGINT NOT NULL,
    cid CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    circuit_revision INT UNSIGNED NOT NULL,
    title VARCHAR(120) NOT NULL,
    markdown MEDIUMTEXT NOT NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (cid) REFERENCES circuits(cid) ON DELETE CASCADE,
    INDEX idx_circuit_reports_owner (owner_id, cid, updated_at)
  );
