CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    recipient_user_id BIGINT NULL,
    publisher_user_id BIGINT NULL,
    category VARCHAR(32) NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
    source_reference VARCHAR(128) NULL,
    title VARCHAR(200) NOT NULL,
    body MEDIUMTEXT NULL,
    action_url VARCHAR(512) NULL,
    importance ENUM('normal', 'important', 'urgent') NOT NULL DEFAULT 'normal',
    status ENUM('draft', 'published', 'cancelled') NOT NULL DEFAULT 'draft',
    deadline_at DATETIME NULL,
    published_at DATETIME NULL,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_recipient_user
        FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_publisher_user
        FOREIGN KEY (publisher_user_id) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_notifications_recipient_status_published
        (recipient_user_id, status, published_at DESC),
    INDEX idx_notifications_category_status_published
        (category, status, published_at DESC),
    INDEX idx_notifications_source (source_type, source_reference),
    INDEX idx_notifications_status_deadline (status, deadline_at),
    INDEX idx_notifications_publisher (publisher_user_id),
    INDEX idx_notifications_deleted_at (deleted_at)
);

CREATE TABLE IF NOT EXISTS user_notification_states (
    notification_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    read_at DATETIME NULL,
    favorited_at DATETIME NULL,
    dismissed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (notification_id, user_id),
    CONSTRAINT fk_user_notification_states_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE,
    CONSTRAINT fk_user_notification_states_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_user_notification_states_user_read (user_id, read_at, notification_id),
    INDEX idx_user_notification_states_user_favorite (user_id, favorited_at),
    INDEX idx_user_notification_states_user_dismissed (user_id, dismissed_at)
);

CREATE TABLE IF NOT EXISTS important_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    notification_id BIGINT NULL,
    created_by_user_id BIGINT NULL,
    dedupe_key VARCHAR(128) NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
    source_reference VARCHAR(128) NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    due_at DATETIME NULL,
    priority ENUM('low', 'normal', 'high', 'urgent') NOT NULL DEFAULT 'normal',
    status ENUM('draft', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'draft',
    user_confirmed_at DATETIME NULL,
    user_overridden_at DATETIME NULL,
    completed_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_important_items_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_important_items_notification
        FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE SET NULL,
    CONSTRAINT fk_important_items_created_by_user
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE KEY uq_important_items_user_notification (user_id, notification_id),
    UNIQUE KEY uq_important_items_user_dedupe (user_id, dedupe_key),
    INDEX idx_important_items_user_status_due (user_id, status, due_at),
    INDEX idx_important_items_source (source_type, source_reference),
    INDEX idx_important_items_notification (notification_id),
    INDEX idx_important_items_created_by (created_by_user_id),
    INDEX idx_important_items_deleted_at (deleted_at)
);

CREATE TABLE IF NOT EXISTS schedule_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    important_item_id BIGINT NULL,
    created_by_user_id BIGINT NULL,
    dedupe_key VARCHAR(128) NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
    source_reference VARCHAR(128) NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NULL,
    start_at DATETIME NOT NULL,
    end_at DATETIME NOT NULL,
    all_day TINYINT(1) NOT NULL DEFAULT 0,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    status ENUM('draft', 'confirmed', 'cancelled') NOT NULL DEFAULT 'draft',
    user_confirmed_at DATETIME NULL,
    user_overridden_at DATETIME NULL,
    cancelled_at DATETIME NULL,
    deleted_at DATETIME NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_schedule_items_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_schedule_items_important_item
        FOREIGN KEY (important_item_id) REFERENCES important_items (id) ON DELETE SET NULL,
    CONSTRAINT fk_schedule_items_created_by_user
        FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE KEY uq_schedule_items_user_dedupe (user_id, dedupe_key),
    INDEX idx_schedule_items_user_status_start (user_id, status, start_at),
    INDEX idx_schedule_items_user_window (user_id, start_at, end_at),
    INDEX idx_schedule_items_source (source_type, source_reference),
    INDEX idx_schedule_items_important_item (important_item_id),
    INDEX idx_schedule_items_created_by (created_by_user_id),
    INDEX idx_schedule_items_deleted_at (deleted_at)
);
