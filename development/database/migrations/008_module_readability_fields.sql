-- Backfill before requiring JSON so existing rows work on all MySQL 8.x versions.
-- Writers supply tags explicitly; no version-specific JSON expression default is needed.
ALTER TABLE knowledge_entries
  ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'general',
  ADD COLUMN tags JSON NULL,
  ADD COLUMN summary VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN maintained_at DATETIME(3) NULL,
  ADD COLUMN maintainer_uid VARCHAR(128) NULL;

UPDATE knowledge_entries SET tags = JSON_ARRAY() WHERE tags IS NULL;
ALTER TABLE knowledge_entries MODIFY COLUMN tags JSON NOT NULL;

ALTER TABLE consultations ADD COLUMN due_at DATETIME(3) NULL;
ALTER TABLE proposals ADD COLUMN due_at DATETIME(3) NULL;

ALTER TABLE clubs
  ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'general',
  ADD COLUMN contact_name VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN public_contact VARCHAR(500) NOT NULL DEFAULT '';

ALTER TABLE activities
  ADD COLUMN registration_deadline DATETIME(3) NULL,
  ADD COLUMN capacity INT NULL,
  ADD COLUMN contact VARCHAR(500) NOT NULL DEFAULT '';

ALTER TABLE sports_teams
  ADD COLUMN season VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN training_schedule VARCHAR(500) NOT NULL DEFAULT '';
