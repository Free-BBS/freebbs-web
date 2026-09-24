# 本地开发与完整预览

本文说明如何在本机运行 FreeBBS 发展端。命令均从仓库根目录执行；仓库要求
Node.js `>=20.19.0`，依赖版本由根目录的 `package-lock.json` 锁定。

## 当前支持的运行方式

| 用途               | 数据               | 认证              | 启动命令                                              |
| ------------------ | ------------------ | ----------------- | ----------------------------------------------------- |
| 日常界面和接口开发 | 进程内存，重启清空 | 固定演示身份      | `npm run dev`                                         |
| MySQL 联调         | MySQL 持久化       | 默认仍为演示身份  | Docker Compose，见下文                                |
| 生产行为核对       | MySQL 持久化       | 主站 Bearer Token | 使用生产配置，见 [服务器部署](./server-deployment.md) |

`memory + demo` 仅用于本地开发和端到端测试。API 在 `NODE_ENV=production` 时会拒绝
`AUTH_MODE=demo`，不要通过修改代码或伪造环境来绕过这项保护。

## 首次安装

```powershell
node --version
npm --version
npm ci
```

`npm ci` 必须在仓库根目录执行。它会严格使用锁文件，并安装根工作区、
`apps/api`、`apps/web` 和 `packages/contracts` 的依赖。

## 最快预览：内存数据与演示认证

```powershell
npm run dev
```

当前默认值已经是：

- API：`http://127.0.0.1:3100`；
- Web：`http://localhost:5173/development/`；
- API 前缀：`/api/development/v1`；
- `DATA_MODE=memory`；
- `AUTH_MODE=demo`；
- 前端开发代理把 `/api/development/v1` 转发到 `127.0.0.1:3100`。

发展端顶部的仓库、商店和个人主页入口在本地指向 `http://localhost:3000`；真实账号模式下，余额、签到与通知通过前端开发代理请求主站的 `/api/auth/me`、`/api/checkin` 和 `/api/notifications`。如果主站在其他地址运行，可在启动 Web 前设置 `VITE_MAIN_SITE_ORIGIN`。演示身份不会调用这些主站接口，也不会生成虚构余额或通知数。

打开 `http://localhost:5173/development/`。演示模式可切换十六个固定身份，四个中心各有部员、部长、负责人三个层级：

- `demo-student`：普通同学；
- `demo-admin`：最高权限；
- `demo-arts-member`、`demo-arts-director`、`demo-arts-lead`：文艺中心部员、部长、负责人；
- `demo-sports-member`、`demo-sports-director`、`demo-sports-lead`：体育中心部员、部长、负责人；
- `demo-liaison-member`、`demo-liaison-director`、`demo-liaison-lead`：联络中心部员、部长、负责人；
- `demo-rights-member`、`demo-rights-director`、`demo-rights-lead`：权发中心部员、部长、负责人；
- `demo-captain`：篮球队范围内的代表队队长；
- `demo-tuanwei-lead`：团委负责人和财务审核人。

学生节特别栏目在文艺中心三个层级、团委负责人和平台管理员身份下显示顶部「审核投稿」按钮。其他中心身份不自动获得私密作品权限。身份目录集中定义在 `packages/contracts/src/demo.ts`，实际角色和组织标签由服务端授权存储加载。

可用下面的命令检查 API：

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/development/v1/health
Invoke-RestMethod `
  -Headers @{ 'X-Demo-User' = 'demo-admin' } `
  http://127.0.0.1:3100/api/development/v1/me
```

内存模式不会读取 `database/seeds/001_demo.sql`，也不会跨进程重启保留业务数据。
需要核对预置业务记录、迁移或持久化行为时，请改用 MySQL 模式。

## 环境变量

API 示例位于 `apps/api/.env.example`，Web 示例位于 `apps/web/.env.example`。根目录
`.gitignore` 会忽略真实 `.env` 文件。当前 API 启动脚本不会自动加载
`apps/api/.env`，因此直接运行 Node 进程时，应在启动它的 shell 或进程管理器中设置变量。

| 变量                     | 本地默认值              | 说明                                  |
| ------------------------ | ----------------------- | ------------------------------------- |
| `NODE_ENV`               | `development`           | `development`、`test` 或 `production` |
| `PORT`                   | `3100`                  | API 监听端口                          |
| `DATA_MODE`              | `memory`                | `memory` 或 `mysql`                   |
| `AUTH_MODE`              | 非生产为 `demo`         | `demo` 或 `main`                      |
| `DEMO_USER_IDS`          | 四个固定演示 UID        | 只会保留代码内允许的演示 UID          |
| `MAIN_SITE_API_BASE_URL` | `http://localhost:3000` | 主站根地址；服务端追加 `/api/auth/me` |
| `AUTH_TIMEOUT_MS`        | `3000`                  | 主站身份接口超时，单位毫秒            |
| `ALLOWED_ORIGINS`        | 空                      | 逗号分隔；同源生产环境应保持为空      |
| `MYSQL_HOST`             | 无                      | `DATA_MODE=mysql` 时必填              |
| `MYSQL_PORT`             | `3306`                  | MySQL 端口                            |
| `MYSQL_USER`             | 无                      | MySQL 用户                            |
| `MYSQL_PASSWORD`         | 无                      | MySQL 密码，禁止提交                  |
| `MYSQL_DATABASE`         | 无                      | MySQL 数据库名                        |
| `VITE_AUTH_MODE`         | 开发文件设为 `demo`     | 生产构建必须为 `main` 或不设置        |

手工以 MySQL 模式启动 API 的 PowerShell 示例：

```powershell
$env:DATA_MODE = 'mysql'
$env:MYSQL_HOST = '127.0.0.1'
$env:MYSQL_PORT = '3306'
$env:MYSQL_DATABASE = 'free_bbs_development'
$env:MYSQL_USER = 'freebbs_development'
$env:MYSQL_PASSWORD = '<从本机密钥存储读取>'
npm run dev:api
```

不要把真实密码写进 shell 历史、仓库文件或聊天记录。团队应使用本机密钥存储或临时注入。

## MySQL 集成预览

Docker Compose 配置和数据库脚本属于当前仓库的受支持运维入口。先阅读
`docker-compose.yml` 中的变量和 profile，再从仓库根目录启动：

```powershell
$env:NODE_ENV = 'development'
$env:AUTH_MODE = 'demo'
$env:DATA_MODE = 'mysql'
$env:MYSQL_PASSWORD = '<本地应用库强密码>'
$env:MYSQL_ROOT_PASSWORD = '<本地 root 强密码>'
docker compose config
docker compose --profile mysql up --build
```

不要把真实值写回 Compose 文件。`mysql` profile 会启动 `database` 和一次性的 `migrate` 服务；API
只有在数据库健康且迁移成功后才启动，所以无需再从宿主机重复执行迁移。`database` 只在 Compose
网络内暴露 3306，不映射到宿主机。

需要固定演示业务数据时，使用受门禁保护的 `seed` profile。它会依次启动数据库、迁移和一次性的
seed 服务，seed 容器固定为 `NODE_ENV=development`、`DATA_MODE=mysql`、
`ALLOW_DEMO_SEED=true`：

```powershell
docker compose --profile seed run --rm seed
```

seed 只接受 INSERT，并将重复记录转换为幂等 no-op。不要在生产运行该 profile。对另一个可从宿主机
访问的本地 MySQL，也可以在显式设置 `NODE_ENV=development`、`DATA_MODE=mysql`、`ALLOW_DEMO_SEED=true` 和全部
`MYSQL_*` 后运行 `npm run db:migrate` 与 `npm run db:seed`。脚本参数及安全用法见
[数据管理](./data-administration.md)。

停止服务：

```powershell
docker compose --profile mysql down
```

不要随意附加 `--volumes`：它会删除本地数据库卷和其中的数据。

## 质量检查

提交前从根目录运行完整门禁：

```powershell
npm run check
```

常用的局部命令：

```powershell
npm test
npm run test:operations
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## 常见问题

### `/development` 打不开或静态资源 404

本地入口必须包含尾斜杠：`http://localhost:5173/development/`。Vite 的 `base` 和 React
Router 的 basename 都是 `/development/`；不要从站点根 `/` 访问。

### 页面能打开，但所有接口失败

确认 API 进程仍在运行，并检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3100/api/development/v1/health
```

若单独启动 Web，仍需单独运行 `npm run dev:api`。浏览器请求必须使用版本化前缀
`/api/development/v1`。

### 演示身份返回 401

仅上述八个固定 UID 受支持。`DEMO_USER_IDS` 只能从固定集合中缩小允许列表，不能新增任意管理员。
同时确认 API 与 Web 都处于 demo 模式。

### 主站认证返回 503

`AUTH_MODE=main` 会把浏览器 Bearer Token 服务端转发到
`MAIN_SITE_API_BASE_URL/api/auth/me`。检查主站地址、网络、TLS 和 `AUTH_TIMEOUT_MS`，不得在日志中
输出 Token。

### MySQL 启动失败

先检查五个 `MYSQL_*` 变量，再检查迁移是否成功。健康接口只报告 `databaseMode`，不会泄露数据库
主机或凭据。更详细的迁移、备份和恢复步骤见 [数据管理](./data-administration.md)。

## 本地与生产的强制边界（2026-07）

`memory + demo` is only for local development and automated tests（仅用于本地开发和自动化测试）。`docker compose --profile seed` 与 `npm run db:seed` 也只处理可丢弃的本地数据；production 环境不得运行 `npm run db:seed`，不得使用 demo 身份或把本地 Compose 密码复制到服务器。生产操作统一转到[生产发布与数据恢复检查清单](./production-release-checklist.md)。
