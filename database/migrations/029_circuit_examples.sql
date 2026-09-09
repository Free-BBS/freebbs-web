-- Seed keys remain present after soft deletion so removed built-in examples stay removed.
CREATE TABLE IF NOT EXISTS circuit_examples (
    id INT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    seed_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL,
    document_json MEDIUMTEXT NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 1,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_circuit_examples_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_circuit_examples_editor FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_circuit_examples_visible (is_deleted, id)
);
