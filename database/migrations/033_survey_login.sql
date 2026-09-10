ALTER TABLE surveys ADD COLUMN requires_login TINYINT NOT NULL DEFAULT 0;
ALTER TABLE survey_entries ADD COLUMN user_id BIGINT NULL;
ALTER TABLE survey_entries ADD UNIQUE KEY survey_user (survey_id, user_id);
