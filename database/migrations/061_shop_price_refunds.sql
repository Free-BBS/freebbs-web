-- A receipt can receive each price adjustment once, even across server restarts.
CREATE TABLE IF NOT EXISTS shop_price_refunds (
    campaign_key VARCHAR(64) NOT NULL,
    purchase_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    magnetic_amount BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (campaign_key, purchase_id),
    KEY idx_shop_refund_user (user_id),
    CONSTRAINT fk_shop_refund_purchase FOREIGN KEY (purchase_id) REFERENCES shop_purchases (id) ON DELETE CASCADE,
    CONSTRAINT fk_shop_refund_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB;
