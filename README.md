# FREE-BBS

FREE-BBS 是一个学习社区原型仓库，当前采用 Node.js 静态前端服务 + Express API 后端 + MySQL 数据库的结构。前端包含首页、学习世界、讨论区、登录注册、个人资料、AI 对话、签到/资产玩法等页面。

> 当前重要状态：`backend/server.js` 已包含后端入口和主要业务 API，但文件体量较大，认证、讨论区、签到/资产、上传和 AI 转发等逻辑集中在一个文件中。后续重构应优先拆分后端模块，而不是继续堆叠单文件实现。

## 技术栈现状

| 层级                 | 当前技术                                 | 说明                                                                                              |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 前端页面             | 原生 HTML / CSS / JavaScript             | 页面在 `public/`，主要逻辑集中在 `public/app.js`，样式集中在 `public/styles.css`。                |
| 静态服务             | Node.js `http` 模块                      | `server.js` 提供静态资源、无 `.html` 路由和 `/vendor/*` 依赖资源访问。                            |
| 后端 API             | Node.js / Express                        | `backend/server.js` 提供认证、用户、讨论区、签到/资产、上传和 AI 转发等 API。                     |
| 数据库               | MySQL 8 兼容 SQL                         | `database/schema.sql`、`database/seed.sql` 用于初始化；`database/migrations/*.sql` 用于增量迁移。 |
| 富文本/公式/代码渲染 | `marked`、KaTeX、Highlight.js CDN assets | 前端用于讨论区 Markdown、公式和代码内容展示。                                                     |
| 3D/视觉              | Three.js、WebP/PNG 静态资源              | 资源位于 `public/assets/`。                                                                       |
| 邮件与认证预留       | nodemailer、jsonwebtoken、密码工具       | 配置在 `backend/config.js`、`backend/mailer.js`、`backend/password.js`、`backend/token.js`。      |
| 部署                 | GitHub Actions + SSH + systemd           | 说明见 `DEPLOYMENT.md`，脚本在 `.github/workflows/`、`scripts/`、`deploy/systemd/`。              |

## 目录结构

```text
.
├── server.js                 # 当前可用的静态前端服务入口
├── package.json              # Node.js 依赖与脚本
├── public/                   # 前端页面、样式、脚本、图片、图标和静态数据
├── backend/                  # Express API 入口、配置、数据库、邮件、密码与 token 工具
├── database/                 # 初始化 SQL、种子数据和迁移脚本
├── scripts/                  # CI、部署、迁移、安全检查脚本
├── deploy/systemd/           # systemd service 模板
├── DEPLOYMENT.md             # 生产部署说明
└── test/                     # 本地 testbench 输出目录，已在 .gitignore 中忽略
```

## 本地启动

### 1. 安装依赖

```bash
npm install
```

生产/CI 环境建议使用：

```bash
npm ci
```

### 2. 一键启动本地前后端

```bash
npm run start:local
```

脚本会优先加载 `backend/.env`，其次加载本地 `envs.sh`，然后同时启动前端静态服务和后端 API。

### 3. 单独启动前端静态服务

```bash
npm run start:frontend
```

默认地址：

```text
http://127.0.0.1:3000
```

也可以指定监听地址和端口：

```bash
HOST=0.0.0.0 PORT=3000 npm run start:frontend
```

### 4. 单独启动后端 API

前端会按当前浏览器地址推导 API 地址：本地开发时通常请求 `http://127.0.0.1:3001/api` 或同主机 `3001` 端口；生产同域访问时请求 `/api`。

```bash
npm run start:backend
```

默认地址：

```text
http://127.0.0.1:3001/api/health
```

后端需要 MySQL 和必要环境变量。首次启动前建议先复制 `backend/.env.example` 并完成数据库初始化或迁移。

## 环境变量

后端相关环境变量模板在 `backend/.env.example`。常用字段：

| 变量             | 默认值                  | 用途                                   |
| ---------------- | ----------------------- | -------------------------------------- |
| `API_HOST`       | `127.0.0.1`             | 后端监听地址。                         |
| `API_PORT`       | `3001`                  | 后端监听端口。                         |
| `BACKEND_IP`     | `127.0.0.1`             | MySQL 主机地址。                       |
| `MYSQL_PORT`     | `3306`                  | MySQL 端口。                           |
| `MYSQL_USER`     | `root`                  | MySQL 用户名。                         |
| `MYSQL_PASSWORD` | 空                      | MySQL 密码。                           |
| `MYSQL_DATABASE` | `free_bbs`              | 数据库名。                             |
| `AUTH_SECRET`    | `free-bbs-dev-secret`   | JWT 签名密钥，生产环境必须替换。       |
| `UPLOAD_DIR`     | `database/uploads`      | 上传文件目录，生产环境应放在持久目录。 |
| `AGENT_URL`      | `http://127.0.0.1:5001` | 预留 AI agent 服务地址。               |
| `SANDBOX_URL`    | `http://127.0.0.1:8000` | 预留代码运行/沙箱服务地址。            |

本地可以复制模板后自行填写：

```bash
cp backend/.env.example backend/.env
```

`.env`、`.env.*`、`envs.sh` 都是本地配置文件，不应提交。

## 数据库

全新初始化 MySQL：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

更推荐使用增量迁移脚本：

```bash
export BACKEND_IP=127.0.0.1
export MYSQL_PORT=3306
export MYSQL_USER=root
export MYSQL_PASSWORD=your-password
export MYSQL_DATABASE=free_bbs
bash scripts/migrate.sh
```

迁移规则：

- 新增数据库变更时，新建 `database/migrations/*.sql`，不要直接改生产已依赖的历史迁移。
- `scripts/migrate.sh` 会维护 `schema_migrations` 表，只执行尚未执行过的迁移文件。
- `scripts/assert-safe-sql.sh` 会检查危险 SQL，CI 会调用它。

默认管理员种子账户：

```text
username: admin
password: free-bbs
```

## 当前功能分布

| 功能                   | 前端位置                                                                                               | 后端/数据依赖                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| 首页与导航             | `public/index.html`、`public/app.js`、`public/styles.css`                                              | 静态服务即可展示。                        |
| 学习世界               | `public/world.html`、`public/world.js`、`public/world.css`                                             | 静态服务即可展示，版块跳转到讨论区。      |
| 登录 / 注册 / 个人资料 | `public/login.html`、`public/register.html`、`public/profile.html`、`public/auth.js`、`public/app.js`  | 需要认证 API、用户表和 JWT。              |
| 讨论区                 | `public/discussion.html`、`public/app.js`                                                              | 需要讨论区 API、MySQL 表、上传目录。      |
| AI 对话                | `public/aichat.html`、`public/app.js`                                                                  | 需要后端 API 转发到 `AGENT_URL`。         |
| 签到 / 资产玩法        | `public/electromagnetic.html`、`public/inventory.html`、`public/data/shop-items.json`、`public/app.js` | 需要用户、签到、资产相关 API 和数据库表。 |
| 管理用户               | `public/adminusers.html`                                                                               | 需要管理员鉴权和用户管理 API。            |

## CI/CD 和部署

仓库内已有 GitHub Actions 远程部署方案：

- `.github/workflows/deploy.yml`
- `.github/workflows/db-migrate.yml`
- `scripts/ci-validate.sh`
- `scripts/deploy.sh`
- `scripts/migrate.sh`
- `deploy/systemd/`

完整部署流程见 `DEPLOYMENT.md`。

注意：

- 默认自动部署不会执行数据库 SQL。
- 数据库迁移需要手动触发 `Database Migration` workflow，并明确输入 `RUN`。
- 上传文件不应提交到 Git，生产环境建议使用 `UPLOAD_DIR=/data/www/free-BBS/uploads` 这类持久目录。

## 协作约定

- 不提交 `node_modules/`、`.env`、`envs.sh`、`.DS_Store`、本地上传文件和 testbench 输出。
- 前端新增页面时，同步更新 `server.js` 的 `pageRoutes` 和 `htmlRedirects`。
- 新增 API 功能时，同步补数据库迁移、环境变量说明和 README 功能表。
- 数据库结构变更走 `database/migrations/`，不要只改 `schema.sql`。
- 大型图片优先使用 WebP；是否删除 PNG 源图需要先确认页面引用和设计源文件用途。

## 代码规范

FREE-BBS 采用成熟规范组合，不单独发明一套项目风格：

- JavaScript 风格：Airbnb Base。
- 自动格式化：Prettier。
- 编辑器基础风格：EditorConfig。
- 提交信息：Conventional Commits。

提交前运行：

```bash
npm run check
```

自动修复格式和可修复 lint 问题：

```bash
npm run lint:fix
npm run format
```

当前 ESLint 配置基于 Airbnb Base，但为了兼容现有原型代码，部分历史模式暂时降级为 warning，例如参数属性赋值、`alert` / `confirm`、嵌套三元表达式、未使用的遗留函数等。后续拆分 `backend/server.js` 和 `public/app.js` 时应逐步收紧这些规则。

Commit message 使用 Conventional Commits：

```text
feat: add discussion post api
fix: correct login token validation
refactor: split backend server routes
docs: update local setup guide
style: format frontend files
test: add auth api test
chore: update dependencies
```

## 后续重构建议

1. 先拆分后端单文件：当前 `backend/server.js` 已恢复，但业务逻辑过于集中。建议按认证、用户、讨论区、签到/资产、上传、AI 转发、数据库访问分模块。
2. 拆分前后端职责：把静态服务、API 服务、数据库访问、上传文件、AI agent 转发拆成清晰模块，避免所有业务继续堆在一个大脚本中。
3. 升级到 TypeScript：后端优先 TypeScript 化，定义用户、帖子、评论、资产、签到等领域类型；前端后续再逐步迁移。
4. 引入现代前端构建：如果要继续升级 UI，建议从原生 HTML/JS 迁到 Vite + React 或 Vue，并把页面拆成组件、路由和状态管理。
5. 规范 API 合同：使用 OpenAPI 或至少维护 `docs/api.md`，让前端、后端、数据库变更不再靠隐式约定。
6. 加数据库访问层：继续使用 MySQL 时可以引入 Prisma、Drizzle 或 Knex，减少手写 SQL 分散在业务代码里的风险。
7. 完善认证与权限模型：把普通用户、版主、管理员、帖子作者权限统一建模，避免前端只靠按钮隐藏表达权限。
8. 建立测试分层：先补后端 API 集成测试和迁移脚本测试，再补关键前端流程的 Playwright 测试。
9. 处理资源和上传策略：把设计源图、生产 WebP、用户上传文件分开；生产上传目录不要跟代码发布目录混用。
10. 统一开发环境：建议补 `docker-compose.yml`，包含 MySQL、后端 API、前端服务和可选 agent/sandbox mock，降低新合作者启动成本。

## 推荐重构路线

短期目标是让合作者能跑起来，中期目标是技术栈可维护，长期目标是可持续迭代。

1. 盘点前端 API 调用并生成接口清单。
2. 梳理前端真实调用的 `/api/*` 路径，生成接口清单并标注哪些已经稳定、哪些准备重写。
3. 把数据库迁移跑通，补充本地开发种子数据。
4. 将后端迁到 TypeScript + Express/Fastify/NestJS 三选一。
5. 将前端迁到 Vite 应用，先保留视觉和功能，再拆组件。
6. 引入 API 文档、测试、lint/format、Docker Compose。
