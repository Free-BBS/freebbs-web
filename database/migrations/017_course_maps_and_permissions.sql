SET @is_admin_column_exists := (
    SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'is_admin'
);

SET @add_is_admin_column_sql := IF(
    @is_admin_column_exists = 0,
    'ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER role',
    'SELECT 1'
);

PREPARE add_is_admin_column_stmt FROM @add_is_admin_column_sql;
EXECUTE add_is_admin_column_stmt;
DEALLOCATE PREPARE add_is_admin_column_stmt;

UPDATE users SET is_admin = 1 WHERE role = 'admin';

CREATE TABLE IF NOT EXISTS courses (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(96) NOT NULL,
    code VARCHAR(128) NULL,
    board_slug VARCHAR(64) NULL,
    description TEXT NULL,
    summary TEXT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course_material_managers (
    course_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, user_id),
    CONSTRAINT fk_course_material_managers_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_material_managers_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_course_material_managers_user (user_id)
);

CREATE TABLE IF NOT EXISTS course_map_nodes (
    course_id BIGINT NOT NULL,
    node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    title VARCHAR(160) NOT NULL,
    summary VARCHAR(500) NULL,
    position_x INT NOT NULL DEFAULT 0,
    position_y INT NOT NULL DEFAULT 0,
    document_markdown MEDIUMTEXT NULL,
    created_by BIGINT NULL,
    updated_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, node_id),
    CONSTRAINT fk_course_map_nodes_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_nodes_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_course_map_nodes_updated_by
        FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_course_map_nodes_course_position (course_id, position_y, position_x)
);

CREATE TABLE IF NOT EXISTS course_map_edges (
    course_id BIGINT NOT NULL,
    source_node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_node_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    relation_type ENUM('ordered', 'related') NOT NULL,
    created_by BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (course_id, source_node_id, target_node_id, relation_type),
    CONSTRAINT fk_course_map_edges_course
        FOREIGN KEY (course_id) REFERENCES courses (id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_edges_source
        FOREIGN KEY (course_id, source_node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_edges_target
        FOREIGN KEY (course_id, target_node_id)
        REFERENCES course_map_nodes (course_id, node_id) ON DELETE CASCADE,
    CONSTRAINT fk_course_map_edges_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
    INDEX idx_course_map_edges_target (course_id, target_node_id)
);

INSERT INTO courses (slug, name, code, board_slug, description, summary, sort_order, is_active)
VALUES
    ('math', '数理基础', 'Mathematical Foundations', 'math',
     '从微积分、线性代数、复指数到概率统计，建立电子信息课程需要的数学基础。',
     '用一张可探索的地图串联数理工具、典型结论与后续课程中的应用。', 10, 1),
    ('signals', '信号系统', 'Signals and Systems', 'signal',
     '从信号描述、线性时不变系统到傅里叶分析和采样定理，建立时域与频域之间的基本语言。',
     '先描述信号，再描述系统如何改变信号，最后用频域工具看清结构。', 20, 1),
    ('circuits', '电子电路与系统', 'Electronic Circuits and Systems', 'circuit',
     '从基本定律、运算放大器、滤波器到反馈系统，逐步进入模拟电路与系统设计。',
     '沿着器件、单元电路和系统分析三条线建立电路设计知识网络。', 30, 1),
    ('digital', '数字电路', 'Digital Logic', 'circuit',
     '用布尔代数、逻辑门、有限状态机与 Verilog 建模，搭建数字系统设计思维。',
     '从组合逻辑出发，进入时序系统、状态机与硬件描述语言。', 40, 1)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    code = VALUES(code),
    board_slug = VALUES(board_slug),
    sort_order = VALUES(sort_order),
    is_active = VALUES(is_active);
