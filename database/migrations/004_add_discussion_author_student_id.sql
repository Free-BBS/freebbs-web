ALTER TABLE discussion_posts
    ADD COLUMN author_student_id VARCHAR(10) NULL AFTER user_id;

UPDATE discussion_posts p
INNER JOIN users u ON u.id = p.user_id
SET p.author_student_id = u.student_id
WHERE p.author_student_id IS NULL;

