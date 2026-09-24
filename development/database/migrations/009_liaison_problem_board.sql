CREATE TABLE IF NOT EXISTS liaison_problems (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  background TEXT NOT NULL,
  source_type ENUM('lab', 'company', 'campus', 'other') NOT NULL,
  source_name VARCHAR(255) NOT NULL,
  tags JSON NOT NULL,
  expected_outcome TEXT NOT NULL,
  constraints_text TEXT NOT NULL,
  starts_at DATETIME(3) NULL,
  deadline DATETIME(3) NULL,
  public_contact VARCHAR(500) NOT NULL,
  internal_contact_note TEXT NOT NULL,
  recorder_uid VARCHAR(128) NOT NULL,
  reviewer_uid VARCHAR(128) NULL,
  reviewed_at DATETIME(3) NULL,
  review_note TEXT NULL,
  status ENUM('draft', 'pending_review', 'rejected', 'open', 'paused', 'closed', 'archived') NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_liaison_problems_scope_status (scope_type, scope_id, status),
  INDEX idx_liaison_problems_status_deadline (status, deadline),
  INDEX idx_liaison_problems_source (source_type, source_name),
  INDEX idx_liaison_problems_recorder (recorder_uid),
  INDEX idx_liaison_problems_reviewer (reviewer_uid),
  CONSTRAINT fk_liaison_problems_recorder
    FOREIGN KEY (recorder_uid) REFERENCES subjects(uid),
  CONSTRAINT fk_liaison_problems_reviewer
    FOREIGN KEY (reviewer_uid) REFERENCES subjects(uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS liaison_teams (
  id VARCHAR(64) PRIMARY KEY,
  problem_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  proposal TEXT NOT NULL,
  maintainer_uid VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_liaison_team_problem_id (problem_id, id),
  INDEX idx_liaison_teams_problem_status (problem_id, status),
  INDEX idx_liaison_teams_maintainer (maintainer_uid),
  CONSTRAINT fk_liaison_teams_problem
    FOREIGN KEY (problem_id) REFERENCES liaison_problems(id),
  CONSTRAINT fk_liaison_teams_maintainer
    FOREIGN KEY (maintainer_uid) REFERENCES subjects(uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS liaison_team_members (
  id VARCHAR(64) PRIMARY KEY,
  problem_id VARCHAR(64) NOT NULL,
  team_id VARCHAR(64) NOT NULL,
  member_uid VARCHAR(128) NOT NULL,
  member_role ENUM('maintainer', 'member') NOT NULL,
  joined_at DATETIME(3) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_liaison_team_member (problem_id, team_id, member_uid),
  INDEX idx_liaison_team_members_team (problem_id, team_id, status),
  INDEX idx_liaison_team_members_member (member_uid, status),
  CONSTRAINT fk_liaison_team_members_team
    FOREIGN KEY (problem_id, team_id) REFERENCES liaison_teams(problem_id, id),
  CONSTRAINT fk_liaison_team_members_member
    FOREIGN KEY (member_uid) REFERENCES subjects(uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS liaison_posts (
  id VARCHAR(64) PRIMARY KEY,
  problem_id VARCHAR(64) NOT NULL,
  team_id VARCHAR(64) NULL,
  author_uid VARCHAR(128) NOT NULL,
  post_kind ENUM('discussion', 'progress') NOT NULL,
  body TEXT NOT NULL,
  hidden_at DATETIME(3) NULL,
  hidden_by_uid VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_liaison_posts_problem_created (problem_id, created_at),
  INDEX idx_liaison_posts_team_created (problem_id, team_id, created_at),
  INDEX idx_liaison_posts_author (author_uid),
  CONSTRAINT fk_liaison_posts_problem
    FOREIGN KEY (problem_id) REFERENCES liaison_problems(id),
  CONSTRAINT fk_liaison_posts_team
    FOREIGN KEY (problem_id, team_id) REFERENCES liaison_teams(problem_id, id),
  CONSTRAINT fk_liaison_posts_author
    FOREIGN KEY (author_uid) REFERENCES subjects(uid),
  CONSTRAINT fk_liaison_posts_hidden_by
    FOREIGN KEY (hidden_by_uid) REFERENCES subjects(uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS liaison_outcomes (
  id VARCHAR(64) PRIMARY KEY,
  problem_id VARCHAR(64) NOT NULL,
  team_id VARCHAR(64) NOT NULL,
  version INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  link_url VARCHAR(2048) NULL,
  attachment_ref VARCHAR(500) NULL,
  submitted_at DATETIME(3) NOT NULL,
  adopted_at DATETIME(3) NULL,
  adopted_by_uid VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_liaison_outcome_version (problem_id, team_id, version),
  INDEX idx_liaison_outcomes_problem_status (problem_id, status),
  INDEX idx_liaison_outcomes_team_version (problem_id, team_id, version),
  INDEX idx_liaison_outcomes_adopted_by (adopted_by_uid),
  CONSTRAINT chk_liaison_outcomes_positive_version CHECK (version >= 1),
  CONSTRAINT fk_liaison_outcomes_team
    FOREIGN KEY (problem_id, team_id) REFERENCES liaison_teams(problem_id, id),
  CONSTRAINT fk_liaison_outcomes_adopted_by
    FOREIGN KEY (adopted_by_uid) REFERENCES subjects(uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
