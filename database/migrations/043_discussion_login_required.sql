-- Existing and new posts require login by default. The author or an administrator can opt out.
-- The backend also ensures this column during startup for deployments without migration jobs.
ALTER TABLE discussion_posts ADD COLUMN login_required TINYINT(1) NOT NULL DEFAULT 1;
