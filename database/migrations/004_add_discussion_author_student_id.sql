SET @author_student_id_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'discussion_posts'
      AND COLUMN_NAME = 'author_student_id'
);

SET @add_author_student_id_column_sql := IF(
    @author_student_id_column_exists = 0,
    'ALTER TABLE discussion_posts ADD COLUMN author_student_id VARCHAR(10) NULL AFTER user_id',
    'SELECT 1'
);

PREPARE add_author_student_id_column_stmt FROM @add_author_student_id_column_sql;
EXECUTE add_author_student_id_column_stmt;
DEALLOCATE PREPARE add_author_student_id_column_stmt;

UPDATE discussion_posts p
INNER JOIN users u ON u.id = p.user_id
SET p.author_student_id = u.student_id
WHERE p.author_student_id IS NULL;
