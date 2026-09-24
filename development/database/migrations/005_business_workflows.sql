SET @business_workflow_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE consultations ADD COLUMN assignee_uid VARCHAR(128) NULL AFTER requester_uid',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'consultations'
    AND column_name = 'assignee_uid'
);
PREPARE business_workflow_statement FROM @business_workflow_ddl;
EXECUTE business_workflow_statement;
DEALLOCATE PREPARE business_workflow_statement;

SET @business_workflow_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE consultations ADD COLUMN reply TEXT NULL AFTER assignee_uid',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'consultations'
    AND column_name = 'reply'
);
PREPARE business_workflow_statement FROM @business_workflow_ddl;
EXECUTE business_workflow_statement;
DEALLOCATE PREPARE business_workflow_statement;

SET @business_workflow_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE clubs ADD COLUMN technical_support_status ENUM(''not_requested'', ''requested'', ''confirmed'') NOT NULL DEFAULT ''not_requested'' AFTER description',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'clubs'
    AND column_name = 'technical_support_status'
);
PREPARE business_workflow_statement FROM @business_workflow_ddl;
EXECUTE business_workflow_statement;
DEALLOCATE PREPARE business_workflow_statement;

SET @business_workflow_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE clubs ADD COLUMN technical_support_note TEXT NULL AFTER technical_support_status',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'clubs'
    AND column_name = 'technical_support_note'
);
PREPARE business_workflow_statement FROM @business_workflow_ddl;
EXECUTE business_workflow_statement;
DEALLOCATE PREPARE business_workflow_statement;

SET @business_workflow_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE activities ADD COLUMN technical_support_status ENUM(''not_requested'', ''requested'', ''confirmed'') NOT NULL DEFAULT ''not_requested'' AFTER starts_at',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'activities'
    AND column_name = 'technical_support_status'
);
PREPARE business_workflow_statement FROM @business_workflow_ddl;
EXECUTE business_workflow_statement;
DEALLOCATE PREPARE business_workflow_statement;

SET @business_workflow_ddl = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE activities ADD COLUMN technical_support_note TEXT NULL AFTER technical_support_status',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'activities'
    AND column_name = 'technical_support_note'
);
PREPARE business_workflow_statement FROM @business_workflow_ddl;
EXECUTE business_workflow_statement;
DEALLOCATE PREPARE business_workflow_statement;

UPDATE consultations
SET status = CASE
  WHEN status = 'submitted' THEN 'open'
  WHEN status IN ('triaged', 'processing') THEN 'in_progress'
  ELSE status
END
WHERE status IN ('submitted', 'triaged', 'processing');

UPDATE activities
SET status = CASE
  WHEN status = 'open' THEN 'published'
  WHEN status IN ('closed', 'completed') THEN 'finished'
  WHEN status = 'cancelled' THEN 'archived'
  ELSE status
END
WHERE status IN ('open', 'closed', 'completed', 'cancelled');

UPDATE finance_records
SET status = 'archived'
WHERE status = 'settled';

UPDATE clubs
SET status = 'active'
WHERE status = 'draft';

UPDATE sports_teams
SET status = 'active'
WHERE status = 'draft';

CREATE TABLE IF NOT EXISTS sports_team_members (
  id VARCHAR(64) PRIMARY KEY,
  team_id VARCHAR(64) NOT NULL,
  member_uid VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  owner_uid VARCHAR(128) NOT NULL,
  scope_type VARCHAR(64) NOT NULL,
  scope_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_sports_team_member (team_id, member_uid),
  INDEX idx_sports_team_members_member (member_uid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

DROP TEMPORARY TABLE IF EXISTS business_workflow_schema_guard;

CREATE TEMPORARY TABLE business_workflow_schema_guard (
  requirement_name VARCHAR(128) NOT NULL,
  violation_count BIGINT NOT NULL,
  CONSTRAINT chk_business_workflow_schema CHECK (violation_count = 0)
) ENGINE=InnoDB;

INSERT INTO business_workflow_schema_guard (requirement_name, violation_count)
SELECT 'consultations.assignee_uid', 1 - COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'consultations'
  AND column_name = 'assignee_uid'
  AND data_type = 'varchar'
  AND character_maximum_length = 128
  AND is_nullable = 'YES'
UNION ALL
SELECT 'consultations.reply', 1 - COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'consultations'
  AND column_name = 'reply'
  AND data_type = 'text'
  AND is_nullable = 'YES'
UNION ALL
SELECT 'clubs.technical_support_status', 1 - COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'clubs'
  AND column_name = 'technical_support_status'
  AND column_type = 'enum(''not_requested'',''requested'',''confirmed'')'
  AND is_nullable = 'NO'
  AND column_default = 'not_requested'
UNION ALL
SELECT 'clubs.technical_support_note', 1 - COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'clubs'
  AND column_name = 'technical_support_note'
  AND data_type = 'text'
  AND is_nullable = 'YES'
UNION ALL
SELECT 'activities.technical_support_status', 1 - COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'activities'
  AND column_name = 'technical_support_status'
  AND column_type = 'enum(''not_requested'',''requested'',''confirmed'')'
  AND is_nullable = 'NO'
  AND column_default = 'not_requested'
UNION ALL
SELECT 'activities.technical_support_note', 1 - COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'activities'
  AND column_name = 'technical_support_note'
  AND data_type = 'text'
  AND is_nullable = 'YES'
UNION ALL
SELECT 'sports_team_members.columns', 9 - COUNT(*)
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'sports_team_members'
  AND (
    (column_name = 'id' AND data_type = 'varchar' AND character_maximum_length = 64 AND is_nullable = 'NO')
    OR (column_name = 'team_id' AND data_type = 'varchar' AND character_maximum_length = 64 AND is_nullable = 'NO')
    OR (column_name = 'member_uid' AND data_type = 'varchar' AND character_maximum_length = 128 AND is_nullable = 'NO')
    OR (column_name = 'status' AND data_type = 'varchar' AND character_maximum_length = 32 AND is_nullable = 'NO')
    OR (column_name = 'owner_uid' AND data_type = 'varchar' AND character_maximum_length = 128 AND is_nullable = 'NO')
    OR (column_name = 'scope_type' AND data_type = 'varchar' AND character_maximum_length = 64 AND is_nullable = 'NO')
    OR (column_name = 'scope_id' AND data_type = 'varchar' AND character_maximum_length = 128 AND is_nullable = 'NO')
    OR (column_name = 'created_at' AND data_type = 'datetime' AND datetime_precision = 3 AND is_nullable = 'NO')
    OR (column_name = 'updated_at' AND data_type = 'datetime' AND datetime_precision = 3 AND is_nullable = 'NO')
  )
UNION ALL
SELECT 'sports_team_members.unique.team', 1 - COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'sports_team_members'
  AND index_name = 'uq_sports_team_member'
  AND non_unique = 0
  AND seq_in_index = 1
  AND column_name = 'team_id'
UNION ALL
SELECT 'sports_team_members.unique.member', 1 - COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'sports_team_members'
  AND index_name = 'uq_sports_team_member'
  AND non_unique = 0
  AND seq_in_index = 2
  AND column_name = 'member_uid'
UNION ALL
SELECT 'sports_team_members.unique.arity', ABS(2 - COUNT(*))
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'sports_team_members'
  AND index_name = 'uq_sports_team_member'
UNION ALL
SELECT 'sports_team_members.member_index', 1 - COUNT(*)
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'sports_team_members'
  AND index_name = 'idx_sports_team_members_member'
  AND seq_in_index = 1
  AND column_name = 'member_uid'
UNION ALL
SELECT 'consultations.assignee_uid.orphans', COUNT(*)
FROM consultations c
LEFT JOIN subjects s ON s.uid = c.assignee_uid
WHERE c.assignee_uid IS NOT NULL
  AND s.uid IS NULL
UNION ALL
SELECT 'sports_team_members.team_id.orphans', COUNT(*)
FROM sports_team_members stm
LEFT JOIN sports_teams st ON st.id = stm.team_id
WHERE st.id IS NULL
UNION ALL
SELECT 'sports_team_members.member_uid.orphans', COUNT(*)
FROM sports_team_members stm
LEFT JOIN subjects s ON s.uid = stm.member_uid
WHERE s.uid IS NULL;

DROP TEMPORARY TABLE business_workflow_schema_guard;

ALTER TABLE consultations
  ADD CONSTRAINT fk_consultations_assignee
    FOREIGN KEY (assignee_uid) REFERENCES subjects(uid);

ALTER TABLE sports_team_members
  ADD CONSTRAINT fk_sports_team_members_team
    FOREIGN KEY (team_id) REFERENCES sports_teams(id);

ALTER TABLE sports_team_members
  ADD CONSTRAINT fk_sports_team_members_subject
    FOREIGN KEY (member_uid) REFERENCES subjects(uid);
