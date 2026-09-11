CREATE TABLE IF NOT EXISTS community_notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    recipient_id BIGINT NOT NULL,
    actor_id BIGINT NULL,
    kind VARCHAR(24) NOT NULL,
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    link VARCHAR(500) NOT NULL DEFAULT '',
    event_key VARCHAR(190) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    read_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_notifications_event_recipient (event_key, recipient_id),
    INDEX idx_notifications_recipient (recipient_id, id),
    INDEX idx_notifications_unread (recipient_id, read_at, id),
    CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS notification_email_outbox (
    notification_id BIGINT PRIMARY KEY,
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts INT NOT NULL DEFAULT 0,
    available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_token VARCHAR(36) NULL,
    lease_until DATETIME NULL,
    last_error_code VARCHAR(64) NULL,
    sent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notification_outbox_ready (status, available_at),
    CONSTRAINT fk_notification_outbox_notification FOREIGN KEY (notification_id) REFERENCES community_notifications (id) ON DELETE CASCADE
);
