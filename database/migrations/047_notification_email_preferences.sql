CREATE TABLE IF NOT EXISTS user_notification_email_preferences (
    user_id BIGINT PRIMARY KEY,
    email_reply TINYINT(1) NOT NULL DEFAULT 1,
    email_reaction TINYINT(1) NOT NULL DEFAULT 1,
    email_comment_like TINYINT(1) NOT NULL DEFAULT 1,
    email_announcement TINYINT(1) NOT NULL DEFAULT 1,
    email_weekly_digest TINYINT(1) NOT NULL DEFAULT 1,
    email_ai_task TINYINT(1) NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_email_preferences_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
