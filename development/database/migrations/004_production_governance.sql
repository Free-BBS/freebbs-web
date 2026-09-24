CREATE TABLE IF NOT EXISTS tag_permissions (
  id VARCHAR(64) PRIMARY KEY,
  tag_key VARCHAR(128) NOT NULL,
  action VARCHAR(255) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  effect ENUM('allow', 'deny') NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_tag_permission (tag_key, action, resource, scope_type, scope_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TEMPORARY TABLE IF EXISTS production_governance_orphan_guard;

CREATE TEMPORARY TABLE production_governance_orphan_guard (
  orphan_type VARCHAR(64) NOT NULL,
  orphan_count BIGINT NOT NULL,
  CONSTRAINT chk_production_governance_no_orphans CHECK (orphan_count = 0)
) ENGINE=InnoDB;

INSERT INTO production_governance_orphan_guard (orphan_type, orphan_count)
SELECT 'orphan role_permissions', COUNT(*)
FROM role_permissions rp
LEFT JOIN roles r ON r.role_key = rp.role_key
LEFT JOIN permissions p ON p.action = rp.action AND p.resource = rp.resource
WHERE r.role_key IS NULL OR p.id IS NULL
UNION ALL
SELECT 'orphan role_assignments', COUNT(*)
FROM role_assignments ra
LEFT JOIN subjects s ON s.uid = ra.subject_uid
LEFT JOIN roles r ON r.role_key = ra.role_key
WHERE s.uid IS NULL OR r.role_key IS NULL
UNION ALL
SELECT 'orphan tag_permissions', COUNT(*)
FROM tag_permissions tp
LEFT JOIN tag_definitions td ON td.tag_key = tp.tag_key
LEFT JOIN permissions p ON p.action = tp.action AND p.resource = tp.resource
WHERE td.tag_key IS NULL OR p.id IS NULL
UNION ALL
SELECT 'orphan tag_assignments', COUNT(*)
FROM tag_assignments ta
LEFT JOIN subjects s ON s.uid = ta.subject_uid
LEFT JOIN tag_definitions td ON td.tag_key = ta.tag_key
WHERE s.uid IS NULL OR td.tag_key IS NULL
UNION ALL
SELECT 'orphan module_owners', COUNT(*)
FROM module_owners mo
LEFT JOIN modules m ON m.module_id = mo.module_id
WHERE m.module_id IS NULL;

DROP TEMPORARY TABLE production_governance_orphan_guard;

ALTER TABLE role_permissions
  ADD CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_key) REFERENCES roles(role_key);

ALTER TABLE role_permissions
  ADD CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (action, resource) REFERENCES permissions(action, resource);

ALTER TABLE role_assignments
  ADD CONSTRAINT fk_role_assignments_subject
    FOREIGN KEY (subject_uid) REFERENCES subjects(uid);

ALTER TABLE role_assignments
  ADD CONSTRAINT fk_role_assignments_role
    FOREIGN KEY (role_key) REFERENCES roles(role_key);

ALTER TABLE tag_permissions
  ADD CONSTRAINT fk_tag_permissions_tag
    FOREIGN KEY (tag_key) REFERENCES tag_definitions(tag_key);

ALTER TABLE tag_permissions
  ADD CONSTRAINT fk_tag_permissions_permission
    FOREIGN KEY (action, resource) REFERENCES permissions(action, resource);

ALTER TABLE tag_assignments
  ADD CONSTRAINT fk_tag_assignments_subject
    FOREIGN KEY (subject_uid) REFERENCES subjects(uid);

ALTER TABLE tag_assignments
  ADD CONSTRAINT fk_tag_assignments_tag
    FOREIGN KEY (tag_key) REFERENCES tag_definitions(tag_key);

ALTER TABLE module_owners
  ADD CONSTRAINT fk_module_owners_module
    FOREIGN KEY (module_id) REFERENCES modules(module_id);
