CREATE TABLE IF NOT EXISTS training_application_consents (
    application_id BIGINT PRIMARY KEY,
    consent_version VARCHAR(40) NOT NULL,
    accepted_at BIGINT NOT NULL,
    FOREIGN KEY (application_id) REFERENCES training_applications (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_course_group_qr (
    course_id BIGINT PRIMARY KEY,
    image MEDIUMBLOB NOT NULL,
    FOREIGN KEY (course_id) REFERENCES training_courses (id) ON DELETE CASCADE
);
