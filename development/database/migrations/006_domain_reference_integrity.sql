DROP PROCEDURE IF EXISTS freebbs_fail_domain_reference_integrity;
CREATE PROCEDURE freebbs_fail_domain_reference_integrity(IN violation_name VARCHAR(128))
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = violation_name;

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM club_memberships membership
      LEFT JOIN clubs club ON club.id = membership.club_id
      WHERE club.id IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''club_memberships.club_id'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE club_memberships
  ADD CONSTRAINT fk_club_memberships_club
  FOREIGN KEY (club_id) REFERENCES clubs(id);

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM club_memberships membership
      LEFT JOIN subjects subject ON subject.uid = membership.member_uid
      WHERE subject.uid IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''club_memberships.member_uid'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE club_memberships
  ADD CONSTRAINT fk_club_memberships_subject
  FOREIGN KEY (member_uid) REFERENCES subjects(uid);

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM activities activity
      LEFT JOIN clubs club ON club.id = activity.club_id
      WHERE activity.club_id IS NOT NULL AND club.id IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''activities.club_id'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE activities
  ADD CONSTRAINT fk_activities_club
  FOREIGN KEY (club_id) REFERENCES clubs(id);

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM activity_registrations registration
      LEFT JOIN activities activity ON activity.id = registration.activity_id
      WHERE activity.id IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''activity_registrations.activity_id'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE activity_registrations
  ADD CONSTRAINT fk_activity_registrations_activity
  FOREIGN KEY (activity_id) REFERENCES activities(id);

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM activity_registrations registration
      LEFT JOIN subjects subject ON subject.uid = registration.participant_uid
      WHERE subject.uid IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''activity_registrations.participant_uid'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE activity_registrations
  ADD CONSTRAINT fk_activity_registrations_subject
  FOREIGN KEY (participant_uid) REFERENCES subjects(uid);

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM sports_checkins checkin
      LEFT JOIN sports_teams team ON team.id = checkin.team_id
      WHERE team.id IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''sports_checkins.team_id'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE sports_checkins
  ADD CONSTRAINT fk_sports_checkins_team
  FOREIGN KEY (team_id) REFERENCES sports_teams(id);

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM sports_checkins checkin
      LEFT JOIN subjects subject ON subject.uid = checkin.member_uid
      WHERE subject.uid IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''sports_checkins.member_uid'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE sports_checkins
  ADD CONSTRAINT fk_sports_checkins_subject
  FOREIGN KEY (member_uid) REFERENCES subjects(uid);

SET @domain_reference_guard_sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM finance_records finance
      LEFT JOIN activities activity ON activity.id = finance.activity_id
      WHERE finance.activity_id IS NOT NULL AND activity.id IS NULL
    ),
    'CALL freebbs_fail_domain_reference_integrity(''finance_records.activity_id'')',
    'SELECT 1'
  )
);
PREPARE domain_reference_guard_statement FROM @domain_reference_guard_sql;
EXECUTE domain_reference_guard_statement;
DEALLOCATE PREPARE domain_reference_guard_statement;
ALTER TABLE finance_records
  ADD CONSTRAINT fk_finance_records_activity
  FOREIGN KEY (activity_id) REFERENCES activities(id);

DROP PROCEDURE IF EXISTS freebbs_fail_domain_reference_integrity;