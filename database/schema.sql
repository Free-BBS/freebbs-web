CREATE DATABASE IF NOT EXISTS free_bbs
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE free_bbs;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    uid VARCHAR(32) UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    full_name VARCHAR(64) NOT NULL,
    student_id VARCHAR(10) NOT NULL UNIQUE,
    email VARCHAR(128) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    email_verified_at DATETIME NULL,
    role ENUM('student', 'ta', 'teacher', 'admin') DEFAULT 'student',
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    electrons BIGINT NOT NULL DEFAULT 0,
    manetrons BIGINT NOT NULL DEFAULT 0,
    heat BIGINT NOT NULL DEFAULT 0,
    grade VARCHAR(16),
    major VARCHAR(64),
    avatar_path VARCHAR(255) NULL,
    bio TEXT NULL,
    website_url VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(128) NOT NULL,
    code_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_verification_codes_email (email),
    INDEX idx_email_verification_codes_expires_at (expires_at)
);

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS courses (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(96) NOT NULL,
    code VARCHAR(128) NULL,
    board_slug VARCHAR(64) NULL,
    description TEXT NULL,
    summary TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course_material_managers (
    course_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, user_id),
    CONSTRAINT fk_course_material_managers_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_material_managers_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_course_material_managers_user (user_id)
);

CREATE TABLE IF NOT EXISTS course_map_settings (
    course_id BIGINT PRIMARY KEY,
    background_url VARCHAR(512) NULL,
    updated_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_course_map_settings_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_settings_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS course_map_nodes (
    course_id BIGINT NOT NULL,
    node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL,
    summary VARCHAR(500) NULL,
    position_x INT NOT NULL DEFAULT 0,
    position_y INT NOT NULL DEFAULT 0,
    document_markdown MEDIUMTEXT NULL,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, node_id),
    CONSTRAINT fk_course_map_nodes_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_nodes_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_course_map_nodes_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_course_map_nodes_course_position (course_id, position_y, position_x)
);

CREATE TABLE IF NOT EXISTS course_map_edges (
    course_id BIGINT NOT NULL,
    source_node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    relation_type ENUM('ordered', 'related') NOT NULL,
    created_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, source_node_id, target_node_id, relation_type),
    CONSTRAINT fk_course_map_edges_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_edges_source
        FOREIGN KEY (course_id, source_node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_edges_target
        FOREIGN KEY (course_id, target_node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_edges_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_course_map_edges_target (course_id, target_node_id)
);

CREATE TABLE IF NOT EXISTS course_map_node_sections (
    course_id BIGINT NOT NULL,
    node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    knowledge_markdown MEDIUMTEXT NULL,
    basic_info_markdown MEDIUMTEXT NULL,
    applications_markdown MEDIUMTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, node_id),
    CONSTRAINT fk_course_map_node_sections_node
        FOREIGN KEY (course_id, node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_secret_settings (
    setting_key VARCHAR(64) PRIMARY KEY,
    ciphertext MEDIUMBLOB NOT NULL,
    iv BINARY(12) NOT NULL,
    auth_tag BINARY(16) NOT NULL,
    last_four VARCHAR(8) NOT NULL DEFAULT '',
    updated_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_system_secret_settings_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id)
        ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_fortunes (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    fortune_date DATE NOT NULL,
    score INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_fortunes_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    UNIQUE KEY uq_user_fortunes_user_date (user_id, fortune_date),
    INDEX idx_user_fortunes_user_date (user_id, fortune_date)
);

CREATE TABLE IF NOT EXISTS user_assets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    asset_key VARCHAR(64) NOT NULL,
    quantity BIGINT NOT NULL DEFAULT 0,
    metadata_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_assets_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    UNIQUE KEY uq_user_assets_user_asset (user_id, asset_key),
    INDEX idx_user_assets_asset_key (asset_key)
);

CREATE TABLE IF NOT EXISTS user_checkins (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    checkin_date DATE NOT NULL,
    streak_count INT NOT NULL DEFAULT 1,
    reward_electrons INT NOT NULL DEFAULT 1,
    fortune_score INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_checkins_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    UNIQUE KEY uq_user_checkins_user_date (user_id, checkin_date),
    INDEX idx_user_checkins_user_date (user_id, checkin_date)
);

CREATE TABLE IF NOT EXISTS ai_dialogs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    did VARCHAR(36) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    title VARCHAR(120) NOT NULL,
    messages_json LONGTEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_ai_dialogs_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE,
    INDEX idx_ai_dialogs_user_updated_at (user_id, updated_at DESC)
);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    recipient_user_id BIGINT NULL,
    publisher_user_id BIGINT NULL,
    category VARCHAR(32) NOT NULL,
    source_type VARCHAR(32) NOT NULL DEFAULT 'manual',
    source_reference VARCHAR(128) NULL,
    dedupe_key VARCHAR(128) NULL,
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
    UNIQUE KEY uq_notifications_recipient_dedupe (recipient_user_id, dedupe_key),
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
    action_url VARCHAR(512) NULL,
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

CREATE TABLE IF NOT EXISTS campus_learn_semester_catalogs (
    user_id BIGINT PRIMARY KEY,
    current_semester_id VARCHAR(32) NULL,
    semesters_json JSON NOT NULL,
    fetched_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_learn_semester_catalogs_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS campus_learn_semester_snapshots (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    semester_id VARCHAR(32) NOT NULL,
    courses_json JSON NOT NULL,
    notifications_json JSON NOT NULL,
    sync_status ENUM('complete', 'partial') NOT NULL DEFAULT 'complete',
    fetched_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_learn_semester_snapshots_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE KEY uq_campus_learn_semester_user (user_id, semester_id),
    INDEX idx_campus_learn_semester_user_fetched (user_id, fetched_at DESC)
);

CREATE TABLE IF NOT EXISTS user_campus_connectors (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM(
        'active_unverified',
        'active_verified',
        'reauthorization_required',
        'revoked',
        'error'
    ) NOT NULL DEFAULT 'active_unverified',
    generation INT UNSIGNED NOT NULL DEFAULT 1,
    identity_fingerprint BINARY(32) NULL,
    granted_scopes JSON NULL,
    credential_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    credential_ciphertext MEDIUMBLOB NULL,
    credential_iv BINARY(12) NULL,
    credential_auth_tag BINARY(16) NULL,
    credential_key_version INT UNSIGNED NOT NULL DEFAULT 1,
    credential_expires_at DATETIME NULL,
    connected_at DATETIME NULL,
    reauthorization_required_at DATETIME NULL,
    revoked_at DATETIME NULL,
    last_successful_sync_at DATETIME NULL,
    last_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_campus_connectors_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_campus_connectors_user_provider (user_id, provider),
    UNIQUE KEY uq_user_campus_connectors_provider_identity
        (provider, identity_fingerprint),
    INDEX idx_user_campus_connectors_user_status (user_id, status),
    INDEX idx_user_campus_connectors_status_expiry (status, credential_expires_at)
);

CREATE TABLE IF NOT EXISTS campus_connector_auth_flows (
    state_hash BINARY(32) PRIMARY KEY,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    adapter_version VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM(
        'redirect_issued',
        'callback_received',
        'succeeded',
        'failed',
        'expired',
        'invalidated'
    ) NOT NULL DEFAULT 'redirect_issued',
    return_path VARCHAR(255) NOT NULL DEFAULT '/workbench',
    flow_secret_ciphertext MEDIUMBLOB NULL,
    flow_secret_iv BINARY(12) NULL,
    flow_secret_auth_tag BINARY(16) NULL,
    flow_secret_key_version INT UNSIGNED NOT NULL DEFAULT 1,
    expires_at DATETIME NOT NULL,
    claimed_at DATETIME NULL,
    consumed_at DATETIME NULL,
    active_slot TINYINT
        GENERATED ALWAYS AS (
            CASE
                WHEN status = 'redirect_issued' AND consumed_at IS NULL THEN 1
                ELSE NULL
            END
        ) STORED,
    safe_error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_connector_auth_flows_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE KEY uq_campus_connector_auth_flows_active (user_id, provider, active_slot),
    INDEX idx_campus_connector_auth_flows_user_provider
        (user_id, provider, created_at DESC),
    INDEX idx_campus_connector_auth_flows_consumed_expiry (consumed_at, expires_at)
);

CREATE TABLE IF NOT EXISTS campus_connector_sync_runs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    public_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    trace_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
    connector_id BIGINT NOT NULL,
    connector_generation INT UNSIGNED NOT NULL,
    requested_by_user_id BIGINT NULL,
    trigger_type ENUM('manual', 'scheduled', 'retry') NOT NULL DEFAULT 'manual',
    target_semester_id VARCHAR(32) NULL,
    status ENUM('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')
        NOT NULL DEFAULT 'queued',
    active_slot TINYINT
        GENERATED ALWAYS AS (
            CASE WHEN status IN ('queued', 'running') THEN 1 ELSE NULL END
        ) STORED,
    attempt_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    started_at DATETIME NULL,
    finished_at DATETIME NULL,
    heartbeat_at DATETIME NULL,
    lease_expires_at DATETIME NULL,
    lease_owner VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    parser_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    schema_version VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    request_count INT UNSIGNED NOT NULL DEFAULT 0,
    result_counts JSON NULL,
    evidence_json JSON NULL,
    error_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    error_context JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_campus_connector_sync_runs_connector
        FOREIGN KEY (connector_id) REFERENCES user_campus_connectors (id) ON DELETE CASCADE,
    CONSTRAINT fk_campus_connector_sync_runs_requested_by
        FOREIGN KEY (requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
    UNIQUE KEY uq_campus_connector_sync_runs_active (connector_id, active_slot),
    INDEX idx_campus_connector_sync_runs_connector_created (connector_id, created_at DESC),
    INDEX idx_campus_connector_sync_runs_connector_status
        (connector_id, status, created_at DESC),
    INDEX idx_campus_connector_sync_runs_queue_lease (status, lease_expires_at),
    INDEX idx_campus_connector_sync_runs_requested_by
        (requested_by_user_id, created_at DESC)
);
