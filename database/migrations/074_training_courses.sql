CREATE TABLE IF NOT EXISTS training_user_access (
    user_id BIGINT PRIMARY KEY,
    staff_role ENUM('member', 'minister') NULL,
    viewing_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_batches (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    slug CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    title VARCHAR(100) NOT NULL,
    opens_at BIGINT NOT NULL,
    closes_at BIGINT NOT NULL,
    revision INT UNSIGNED NOT NULL DEFAULT 0,
    published_at BIGINT NULL,
    published_by BIGINT NULL,
    publication_signature JSON NULL,
    FOREIGN KEY (published_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS training_courses (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    batch_id BIGINT NOT NULL,
    title VARCHAR(100) NOT NULL,
    title_key VARCHAR(180) COLLATE utf8mb4_bin NOT NULL,
    teacher VARCHAR(100) NOT NULL DEFAULT '',
    offered BOOLEAN NOT NULL DEFAULT FALSE,
    capacity TINYINT UNSIGNED NOT NULL DEFAULT 0,
    starts_at BIGINT NULL,
    ends_at BIGINT NULL,
    location VARCHAR(160) NOT NULL DEFAULT '',
    feedback_questions JSON NOT NULL,
    feedback_version INT UNSIGNED NOT NULL DEFAULT 1,
    UNIQUE KEY uq_training_course_title (batch_id, title_key),
    UNIQUE KEY uq_training_course_batch (batch_id, id),
    FOREIGN KEY (batch_id) REFERENCES training_batches (id) ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS training_applications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    batch_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    full_name VARCHAR(64) NOT NULL,
    student_id VARCHAR(10) NOT NULL,
    email VARCHAR(128) NULL,
    introduction TEXT NOT NULL,
    is_lexue BOOLEAN NOT NULL,
    signature JSON NOT NULL,
    submitted_at BIGINT NOT NULL,
    UNIQUE KEY uq_training_application_user (batch_id, user_id),
    UNIQUE KEY uq_training_application_batch (batch_id, id),
    FOREIGN KEY (batch_id) REFERENCES training_batches (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_preferences (
    batch_id BIGINT NOT NULL,
    application_id BIGINT NOT NULL,
    course_id BIGINT NOT NULL,
    preference_rank TINYINT UNSIGNED NOT NULL,
    decision ENUM('accept', 'deny') NULL,
    PRIMARY KEY (application_id, course_id),
    UNIQUE KEY uq_training_preference_rank (application_id, preference_rank),
    FOREIGN KEY (batch_id, application_id) REFERENCES training_applications (batch_id, id) ON DELETE CASCADE,
    FOREIGN KEY (batch_id, course_id) REFERENCES training_courses (batch_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_assignments (
    application_id BIGINT PRIMARY KEY,
    course_id BIGINT NOT NULL,
    FOREIGN KEY (application_id, course_id) REFERENCES training_preferences (application_id, course_id) ON DELETE CASCADE,
    INDEX idx_training_assignment_course (course_id)
);

CREATE TABLE IF NOT EXISTS training_materials (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    course_id BIGINT NOT NULL,
    title VARCHAR(180) NOT NULL,
    kind ENUM('pdf', 'replay') NOT NULL,
    replay_url VARCHAR(2048) NULL,
    pdf MEDIUMBLOB NULL,
    FOREIGN KEY (course_id) REFERENCES training_courses (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS training_feedback (
    course_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    scores JSON NOT NULL,
    suggestion VARCHAR(2000) NOT NULL DEFAULT '',
    PRIMARY KEY (course_id, user_id),
    FOREIGN KEY (course_id) REFERENCES training_courses (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
