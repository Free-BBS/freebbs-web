CREATE TABLE IF NOT EXISTS development_access_grants (
  id VARCHAR(64) PRIMARY KEY,
  subject_uid VARCHAR(128) NULL,
  student_id VARCHAR(32) NULL,
  username VARCHAR(128) NULL,
  access_level ENUM('member', 'lead') NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_development_access_subject (subject_uid),
  UNIQUE KEY uq_development_access_student (student_id),
  INDEX idx_development_access_status_level (status, access_level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO development_access_grants (
  id, subject_uid, student_id, username, access_level, status,
  owner_uid, scope_type, scope_id, created_at, updated_at
) VALUES (
  'development-lead-2023010567', NULL, '2023010567', 'Yuchong', 'lead', 'active',
  'system', 'public', '*', NOW(3), NOW(3)
) ON DUPLICATE KEY UPDATE
  username = VALUES(username),
  access_level = 'lead',
  status = 'active',
  updated_at = NOW(3);
