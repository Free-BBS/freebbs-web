CREATE TABLE IF NOT EXISTS course_teaching_memberships (
    course_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    assigned_by BIGINT NULL,
    assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (course_id, user_id),
    INDEX idx_teaching_memberships_user (user_id),
    CONSTRAINT fk_teaching_membership_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
    CONSTRAINT fk_teaching_membership_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_teaching_membership_assigner FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
