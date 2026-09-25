CREATE TABLE IF NOT EXISTS development_schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(64) PRIMARY KEY,
  uid VARCHAR(128) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  avatar_url TEXT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_subjects_scope (scope_type, scope_id),
  INDEX idx_subjects_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(64) PRIMARY KEY,
  role_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(64) PRIMARY KEY,
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_permission_action_resource (action, resource)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id VARCHAR(64) PRIMARY KEY,
  role_key VARCHAR(128) NOT NULL,
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  effect ENUM('allow', 'deny') NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_role_permission (role_key, action, resource, scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS role_assignments (
  id VARCHAR(64) PRIMARY KEY,
  subject_uid VARCHAR(128) NOT NULL,
  role_key VARCHAR(128) NOT NULL,
  expires_at DATETIME(3) NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_role_assignments_subject (subject_uid),
  INDEX idx_role_assignments_role (role_key),
  UNIQUE KEY uq_role_assignment (subject_uid, role_key, scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tag_definitions (
  id VARCHAR(64) PRIMARY KEY,
  tag_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS tag_assignments (
  id VARCHAR(64) PRIMARY KEY,
  subject_uid VARCHAR(128) NOT NULL,
  tag_key VARCHAR(128) NOT NULL,
  expires_at DATETIME(3) NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_tag_assignments_subject (subject_uid),
  UNIQUE KEY uq_tag_assignment (subject_uid, tag_key, scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS modules (
  id VARCHAR(64) PRIMARY KEY,
  module_id VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS module_owners (
  id VARCHAR(64) PRIMARY KEY,
  module_id VARCHAR(64) NOT NULL,
  owner_type ENUM('role', 'subject', 'team') NOT NULL,
  owner_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_module_owner (module_id, owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS audit_logs (
  id VARCHAR(64) PRIMARY KEY,
  actor_uid VARCHAR(128) NOT NULL,
  action VARCHAR(255) NOT NULL,
  resource_type VARCHAR(128) NOT NULL,
  resource_id VARCHAR(128) NOT NULL,
  details JSON NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_audit_actor (actor_uid),
  INDEX idx_audit_resource (resource_type, resource_id),
  INDEX idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
