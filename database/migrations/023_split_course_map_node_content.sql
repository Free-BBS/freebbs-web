CREATE TABLE IF NOT EXISTS course_map_node_sections (
    course_id BIGINT NOT NULL,
    node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    knowledge_markdown MEDIUMTEXT NULL,
    basic_info_markdown MEDIUMTEXT NULL,
    applications_markdown MEDIUMTEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, node_id),
    CONSTRAINT fk_course_map_node_sections_node
        FOREIGN KEY (course_id, node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE
);
