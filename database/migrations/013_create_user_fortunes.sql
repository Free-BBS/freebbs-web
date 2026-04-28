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
