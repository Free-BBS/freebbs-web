-- New counters start at zero. Never rewrite or count legacy inventory.
CREATE TABLE IF NOT EXISTS shop_purchase_progress (
    user_id BIGINT NOT NULL,
    item_key VARCHAR(64) NOT NULL,
    purchase_count INT NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, item_key),
    CONSTRAINT fk_shop_progress_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS shop_purchases (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    request_key VARCHAR(64) NOT NULL,
    item_key VARCHAR(64) NOT NULL,
    purchase_number INT NOT NULL,
    currency VARCHAR(16) NOT NULL,
    amount BIGINT NULL,
    fingerprint VARCHAR(512) NOT NULL,
    result_json JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_shop_purchase_request (user_id, request_key),
    UNIQUE KEY uq_shop_purchase_number (user_id, item_key, purchase_number),
    CONSTRAINT fk_shop_purchase_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS user_lasers (
    user_id BIGINT PRIMARY KEY,
    expires_at_ms BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_laser_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
