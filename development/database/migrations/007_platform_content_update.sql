ALTER TABLE knowledge_entries
  ADD COLUMN audience ENUM('general', 'social_org') NOT NULL DEFAULT 'general' AFTER body,
  ADD COLUMN organization_id VARCHAR(64) NULL AFTER audience;

ALTER TABLE clubs
  ADD COLUMN organization_id VARCHAR(64) NULL AFTER description;

ALTER TABLE activities
  ADD COLUMN ends_at DATETIME(3) NULL AFTER starts_at,
  ADD COLUMN location VARCHAR(255) NOT NULL DEFAULT '' AFTER ends_at,
  ADD COLUMN organization_id VARCHAR(64) NULL AFTER location,
  ADD COLUMN standing_activity BOOLEAN NOT NULL DEFAULT FALSE AFTER organization_id;

ALTER TABLE finance_records
  ADD COLUMN organization_id VARCHAR(64) NULL AFTER activity_id,
  ADD COLUMN reviewer_uid VARCHAR(128) NULL AFTER organization_id,
  ADD COLUMN reviewed_at DATETIME(3) NULL AFTER reviewer_uid,
  ADD COLUMN review_decision ENUM('approved', 'rejected') NULL AFTER reviewed_at;

CREATE TABLE proposals (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  problem_description TEXT NOT NULL,
  proposed_solution TEXT NOT NULL,
  category VARCHAR(80) NOT NULL,
  submitter_uid VARCHAR(128) NOT NULL,
  assignee_uid VARCHAR(128) NULL,
  public_progress TEXT NOT NULL,
  internal_note TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_proposals_scope_status (scope_type, scope_id, status),
  INDEX idx_proposals_submitter (submitter_uid),
  INDEX idx_proposals_assignee (assignee_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE activity_milestones (
  id VARCHAR(64) PRIMARY KEY,
  activity_id VARCHAR(64) NOT NULL,
  occurs_at DATETIME(3) NOT NULL,
  title VARCHAR(255) NOT NULL,
  milestone_type VARCHAR(64) NOT NULL,
  description TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_activity_milestones_activity_order (activity_id, display_order),
  CONSTRAINT fk_activity_milestones_activity
    FOREIGN KEY (activity_id) REFERENCES activities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE competition_fixtures (
  id VARCHAR(64) PRIMARY KEY,
  activity_id VARCHAR(64) NOT NULL,
  round_name VARCHAR(128) NOT NULL,
  participant_a VARCHAR(255) NOT NULL,
  participant_b VARCHAR(255) NOT NULL,
  scheduled_at DATETIME(3) NOT NULL,
  location VARCHAR(255) NOT NULL,
  score VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_competition_fixtures_activity_time (activity_id, scheduled_at),
  CONSTRAINT fk_competition_fixtures_activity
    FOREIGN KEY (activity_id) REFERENCES activities(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
