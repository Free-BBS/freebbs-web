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

更推荐使用增量迁移脚本：

```bash
export BACKEND_IP=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=your-password
export MYSQL_DATABASE=free_bbs
bash scripts/migrate.sh
```

系统会预置管理员账户：

- 用户名：`admin`
- 密码：`free-bbs`

## Migrations

- `database/schema.sql` 和 `database/seed.sql` 用于全新初始化
- `database/migrations/*.sql` 用于生产增量迁移
- `scripts/migrate.sh` 会自动创建 `schema_migrations` 表，并且只执行未执行过的迁移文件

新增数据库列时，新增一个按时间或顺序递增命名的迁移文件，例如：

```sql
ALTER TABLE users
  ADD COLUMN bio TEXT NULL,
  ADD COLUMN website_url VARCHAR(255) NULL;
```

建议命名格式：

- `001_init_schema.sql`
- `002_seed_admin.sql`
- `003_add_user_profile_fields.sql`
