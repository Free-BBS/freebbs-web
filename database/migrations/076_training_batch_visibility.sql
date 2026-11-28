CREATE TABLE IF NOT EXISTS training_batch_visibility (
    batch_id BIGINT PRIMARY KEY,
    visibility ENUM('hidden', 'public') NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES training_batches (id) ON DELETE CASCADE
);
