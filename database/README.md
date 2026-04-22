# Database

初始化数据库：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

或者先进入 MySQL 后执行：

```sql
SOURCE database/schema.sql;
SOURCE database/seed.sql;
```

默认数据库名为 `free_bbs`。

如果你已经跑过旧版本数据库，需要补以下结构：

```sql
ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL;
ALTER TABLE users ADD COLUMN full_name VARCHAR(64) NOT NULL DEFAULT '' AFTER username;
ALTER TABLE users ADD COLUMN student_id VARCHAR(10) NOT NULL DEFAULT '' AFTER full_name;
ALTER TABLE users ADD COLUMN electrons BIGINT NOT NULL DEFAULT 0 AFTER role;
ALTER TABLE users ADD COLUMN manetrons BIGINT NOT NULL DEFAULT 0 AFTER electrons;
ALTER TABLE users ADD COLUMN avatar_path VARCHAR(255) NULL AFTER major;
ALTER TABLE users ADD COLUMN bio TEXT NULL AFTER avatar_path;
ALTER TABLE users ADD COLUMN website_url VARCHAR(255) NULL AFTER bio;
ALTER TABLE users ADD UNIQUE KEY uniq_users_student_id (student_id);

CREATE TABLE email_verification_codes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(128) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_email_verification_codes_email (email),
  INDEX idx_email_verification_codes_expires_at (expires_at)
);
```

系统会预置管理员账户：

- 用户名：`admin`
- 密码：`free-bbs`
