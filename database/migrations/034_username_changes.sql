-- Additive and repeatable. Run against the selected FREE-BBS database.
CREATE TABLE IF NOT EXISTS username_change_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    old_username VARCHAR(64) NOT NULL,
    new_username VARCHAR(64) NOT NULL,
    change_kind ENUM('free', 'paid', 'required') NOT NULL,
    magnetic_cost INT NOT NULL DEFAULT 0,
    changed_at DATETIME(3) NOT NULL,
    INDEX idx_username_changes_user_kind (user_id, change_kind, changed_at),
    CONSTRAINT fk_username_changes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
