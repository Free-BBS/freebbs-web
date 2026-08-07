ALTER TABLE campus_connector_sync_runs
    ADD COLUMN target_semester_id VARCHAR(32) NULL AFTER trigger_type;

CREATE TABLE IF NOT EXISTS campus_learn_semester_catalogs (
    user_id BIGINT PRIMARY KEY,
    current_semester_id VARCHAR(32) NULL,
    semesters_json JSON NOT NULL,
    fetched_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_learn_semester_catalogs_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
