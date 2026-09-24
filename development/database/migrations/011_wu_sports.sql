CREATE TABLE IF NOT EXISTS sports_matches (
  id VARCHAR(128) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  cover_url TEXT NULL,
  starts_at DATETIME(3) NOT NULL,
  ends_at DATETIME(3) NOT NULL,
  location VARCHAR(300) NOT NULL,
  live_url TEXT NULL,
  replay_url TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_sports_matches_time (starts_at, ends_at),
  INDEX idx_sports_matches_owner (owner_uid)
);

CREATE TABLE IF NOT EXISTS sports_team_showcases (
  id VARCHAR(128) PRIMARY KEY,
  team_id VARCHAR(128) NOT NULL,
  markdown MEDIUMTEXT NOT NULL,
  updated_by_uid VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_sports_team_showcase_team (team_id),
  CONSTRAINT fk_sports_team_showcase_team FOREIGN KEY (team_id) REFERENCES sports_teams(id)
);
