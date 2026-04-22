# FREE-BBS

FREE-BBS web frontend and backend.

## Structure

- `public/`: 首页与前端静态资源
- `backend/`: Node.js 认证后端与 MySQL 访问
- `database/`: 建库建表与管理员种子数据

## Run

前端静态页：

```bash
npm install
npm run start:frontend
```

后端 API：

```bash
npm run start:backend
```

## Database

初始化 MySQL：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

或者使用增量迁移脚本：

```bash
export BACKEND_IP=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=your-password
export MYSQL_DATABASE=free_bbs
bash scripts/migrate.sh
```

后续数据库变更请新增 `database/migrations/*.sql`，不要直接依赖重复执行整份 `schema.sql` / `seed.sql`。

管理员默认账户：

- username: `admin`
- password: `free-bbs`

## CI/CD

仓库内已提供 GitHub Actions 远程部署方案：

- `.github/workflows/deploy.yml`
- `.github/workflows/db-migrate.yml`
- `scripts/ci-validate.sh`
- `scripts/deploy.sh`
- `scripts/migrate.sh`
- `deploy/systemd/`

完整部署说明见 `DEPLOYMENT.md`。

默认自动部署不会执行数据库 SQL。只有手动触发 `Database Migration` workflow，并明确输入 `RUN`，才会执行数据库脚本。

部署工作流运行在 GitHub 托管 runner 上，通过 SSH 将发布包上传到应用服务器后再执行部署脚本，因此应用服务器不需要再直接从 GitHub 拉代码。
