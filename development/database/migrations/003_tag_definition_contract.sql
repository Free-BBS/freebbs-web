ALTER TABLE tag_definitions
  ADD COLUMN required_scope_type VARCHAR(64) NULL AFTER description,
  ADD COLUMN metadata JSON NULL AFTER required_scope_type;

UPDATE tag_definitions
SET required_scope_type = 'sports_team',
    metadata = JSON_OBJECT('resourceTypes', JSON_ARRAY('sports_team'))
WHERE tag_key = 'sports.team_captain';

UPDATE tag_definitions
SET metadata = JSON_OBJECT()
WHERE metadata IS NULL;

ALTER TABLE tag_definitions
  MODIFY COLUMN metadata JSON NOT NULL;
