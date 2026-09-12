-- backend/server.js also installs this column additively when absent.
ALTER TABLE discussion_posts ADD COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER is_deleted;
