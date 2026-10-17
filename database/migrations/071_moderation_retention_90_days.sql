START TRANSACTION;

SET @moderation_retention_cutoff = NOW(3);

UPDATE moderation_attachments a
JOIN moderation_submissions s ON s.id = a.submission_id
SET a.expires_at = DATE_ADD(s.created_at, INTERVAL 90 DAY)
WHERE s.expires_at > @moderation_retention_cutoff
  AND s.evidence_purged_at IS NULL AND s.payload_json IS NOT NULL AND s.status <> 'expired'
  AND a.expires_at > @moderation_retention_cutoff AND a.purged_at IS NULL
  AND a.expires_at < DATE_ADD(s.created_at, INTERVAL 90 DAY);

UPDATE moderation_attachments
SET expires_at = DATE_ADD(created_at, INTERVAL 90 DAY)
WHERE submission_id IS NULL AND bound_content_hash IS NULL AND published_id IS NULL
  AND expires_at > @moderation_retention_cutoff AND purged_at IS NULL
  AND expires_at < DATE_ADD(created_at, INTERVAL 90 DAY);

UPDATE moderation_regression_cases c
JOIN moderation_ai_runs r ON r.id = c.run_id
JOIN moderation_submissions s ON s.id = r.submission_id
SET c.expires_at = DATE_ADD(s.created_at, INTERVAL 90 DAY)
WHERE s.expires_at > @moderation_retention_cutoff
  AND s.evidence_purged_at IS NULL AND s.payload_json IS NOT NULL AND s.status <> 'expired'
  AND r.expires_at > @moderation_retention_cutoff
  AND c.expires_at > @moderation_retention_cutoff
  AND c.expires_at < DATE_ADD(s.created_at, INTERVAL 90 DAY);

UPDATE moderation_ai_runs r
JOIN moderation_submissions s ON s.id = r.submission_id
SET r.expires_at = DATE_ADD(s.created_at, INTERVAL 90 DAY)
WHERE s.expires_at > @moderation_retention_cutoff
  AND s.evidence_purged_at IS NULL AND s.payload_json IS NOT NULL AND s.status <> 'expired'
  AND r.expires_at > @moderation_retention_cutoff
  AND r.expires_at < DATE_ADD(s.created_at, INTERVAL 90 DAY);

UPDATE moderation_image_reviews i
JOIN moderation_auto_jobs j ON j.id = i.job_id
JOIN moderation_submissions s ON s.id = i.submission_id AND s.id = j.submission_id
SET i.expires_at = DATE_ADD(s.created_at, INTERVAL 90 DAY)
WHERE s.expires_at > @moderation_retention_cutoff
  AND s.evidence_purged_at IS NULL AND s.payload_json IS NOT NULL AND s.status <> 'expired'
  AND j.expires_at > @moderation_retention_cutoff AND j.purged_at IS NULL
  AND i.expires_at > @moderation_retention_cutoff
  AND i.expires_at < DATE_ADD(s.created_at, INTERVAL 90 DAY);

UPDATE moderation_auto_jobs j
JOIN moderation_submissions s ON s.id = j.submission_id
SET j.expires_at = DATE_ADD(s.created_at, INTERVAL 90 DAY)
WHERE s.expires_at > @moderation_retention_cutoff
  AND s.evidence_purged_at IS NULL AND s.payload_json IS NOT NULL AND s.status <> 'expired'
  AND j.expires_at > @moderation_retention_cutoff AND j.purged_at IS NULL
  AND j.expires_at < DATE_ADD(s.created_at, INTERVAL 90 DAY);

UPDATE moderation_submissions
SET expires_at = DATE_ADD(created_at, INTERVAL 90 DAY)
WHERE expires_at > @moderation_retention_cutoff
  AND evidence_purged_at IS NULL AND payload_json IS NOT NULL AND status <> 'expired'
  AND expires_at < DATE_ADD(created_at, INTERVAL 90 DAY);

SET @moderation_retention_cutoff = NULL;

COMMIT;
