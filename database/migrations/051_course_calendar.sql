-- Legacy catalogs and snapshots stay NULL until the next authorized sync. Never backfill them
-- to the current connector generation, which may belong to a rebound identity.
ALTER TABLE campus_learn_semester_catalogs
    ADD COLUMN connector_generation INT UNSIGNED NULL AFTER user_id;

ALTER TABLE campus_learn_semester_snapshots
    ADD COLUMN connector_generation INT UNSIGNED NULL AFTER semester_id;

CREATE TABLE IF NOT EXISTS campus_course_calendar_settings (
    user_id BIGINT NOT NULL,
    semester_id VARCHAR(32) NOT NULL,
    connector_generation INT UNSIGNED NOT NULL,
    first_week_monday DATE NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, semester_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
