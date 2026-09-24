# 服务器部署与运维

本文描述 FreeBBS 发展端的生产部署基线。仓库提供 Docker、Nginx 和 systemd 配置；实际域名、
TLS 证书、服务器账号、仓库安装目录和凭据由部署负责人填写，本文不预设这些值。

## 生产拓扑与路径

生产环境采用同源路径：

```text
https://<主站域名>/development/          -> 发展端 Web 静态文件
https://<主站域名>/api/development/v1/  -> 发展端 API（Nginx 转发到 127.0.0.1:3100）
```

主站的 `/development` 保留原施工页。白名单用户登录后，施工页会校验发展端 API，成功才跳转到
`/development/`；非白名单用户仍看到施工页，直接打开发展端深层链接也会被 API 拒绝。浏览器不应直接访问 API
容器、MySQL 或 Adminer。主站和发展端同源时，`ALLOWED_ORIGINS` 保持为空。API 支持 `HOST`；
生产 systemd unit 固定监听 `127.0.0.1:3100`，并继续用主机防火墙/安全组阻止公网访问 3100，
只允许本机 Nginx 连接。

## 发布前检查

在干净检出的待发布提交上执行：

```bash
npm ci
npm run check
docker compose config
docker compose build
```

只有上述命令通过，并完成后续发布备份或首次发布空库证据，才进入迁移和切换。保存待发布 commit SHA
与当前线上 commit SHA；后者是回滚目标，首次发布则明确记录没有上一版。

## GitHub Actions 发布前置条件

`.github/workflows/deploy.yml` 只在受保护的 `main` 分支上运行，并要求 GitHub `production` environment
批准。仓库或组织管理员必须配置：

- environment variables：`PRODUCTION_URL`、`FREEBBS_DOMAIN`（仅域名，不含协议和路径）；
- secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`。

发布工作流上传不可变的 commit SHA 归档后，只调用服务器预置的受审计入口：

```text
/usr/local/sbin/deploy-freebbs-development
```

该入口不由工作流自动创建。部署负责人必须以 root 所有、普通部署账号不可写的方式安装它，并在独立
评审中确认它会校验 `--sha` 与归档名、拒绝路径穿越、解压到新的版本目录、安装生产依赖、原子切换
`/opt/freebbs-development/current`、安装 Web 静态产物、执行 `nginx -t`、重启/重载服务、完成健康检查，
且失败时切回上一个版本。入口不得自动运行 seed，也不得把 SSH 或数据库凭据写入归档或日志。

数据库迁移使用单独的 `production-database` environment 和人工输入 `RUN` 的工作流。它需要
`MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_DATABASE`、`MYSQL_MIGRATION_USER`、`MYSQL_MIGRATION_PASSWORD`
secrets；应为 environment 配置审批人，并把迁移账号与 API 运行账号分离。普通 pull request 只运行
CI，不会触发发布或迁移。

## 生产环境文件

每次发布都从精确 `RELEASE_SHA` 的受审计检出执行非启动、环境文件非覆盖的安装器：

```bash
sudo scripts/install-server.sh
sudo stat -c '%U:%G %a %n' \
  /etc/freebbs-development/development.env \
  /etc/freebbs-development/backup.env
sudoedit /etc/freebbs-development/development.env
sudoedit /etc/freebbs-development/backup.env
```

安装器只在文件不存在时从 `deploy/env/*.env.example` 创建 0640 环境文件；重复执行不会清空已有凭据。
`development.env` 使用 `freebbs_development_app`，`backup.env` 使用
`freebbs_development_backup`。生产 API unit 另外固定 `NODE_ENV=production` 和
`HOST=127.0.0.1`。逐项替换 `CHANGE_ME` 后再发布。

规则：

- 不得在生产设置 `AUTH_MODE=demo` 或 `VITE_AUTH_MODE=demo`；API 也会拒绝这种组合。
- `MAIN_SITE_API_BASE_URL` 是根地址，API 会追加 `/api/auth/me`。
- `DEVELOPMENT_PREVIEW_UIDS` 填写允许预览的主站 UID，以英文逗号分隔；留空时所有真实账号都被拒绝。
  该白名单只控制发展端准入，进入后的部门和业务权限仍由发展端服务端判断。
- 不把 `.env`、Token、数据库密码、TLS 私钥提交到 Git 或输出到日志。
- 若 Web 在构建时读取 `VITE_AUTH_MODE`，应明确设为 `main` 或不设置；Vite 变量会进入客户端产物，
  所以其中绝不能放秘密。

## 数据库准备与迁移

生产 MySQL 应只监听回环或受限私网。运行时账号只授予 DML 权限，DDL 迁移使用独立临时账号；
完整 SQL 和迁移、备份、恢复步骤见 [数据管理](./data-administration.md)。

推荐发布顺序：

1. 验证最近一次备份可读取，并记录备份文件校验和。
2. 使用迁移账号执行 `npm run db:migrate`。
3. 不在生产执行 `npm run db:seed`；当前 seed 是固定演示数据。
4. 启动新 API，先从服务器本机检查健康接口。
5. 切换 Web 静态文件或容器，再做同源路径冒烟测试。

迁移记录存放在 `schema_migrations`。已应用迁移的校验和发生变化时，脚本会失败；不要修改已发布的
`database/migrations/*.sql`，应新增下一编号迁移。

## systemd 与主站 Nginx 部署

仓库提供应用、Web 验证和数据库备份 systemd 单元：

- `deploy/systemd/freebbs-development-api.service`：持续运行 API；
- `deploy/systemd/freebbs-development-web.service`：一次性验证静态入口和系统 Nginx 配置，不启动第二个
  Nginx 进程；
- `deploy/systemd/freebbs-development-backup.service` 与 `.timer`：使用独立备份环境文件执行定时备份、
  校验和与本机保留期清理。

API 单元固定使用用户/组 `freebbs-development`、工作目录 `/opt/freebbs-development/current` 和
`/usr/bin/node`。先构建 `apps/api/dist`、`packages/contracts/dist`、`apps/web/dist`，再把经过验证的发布
目录原子切换为 `/opt/freebbs-development/current`。Web 产物应安装到
`/usr/share/nginx/html/development`。不要让服务账号拥有 Git 凭据或环境文件写权限。

### Nginx 接入边界

两个 Nginx 文件用途不同，不得混用：

- `deploy/nginx/freebbs-development.conf` 是 Docker Web 镜像使用的完整 `server { listen 8080; }` 配置；
- `deploy/nginx/freebbs-development.locations.conf` 只包含宿主机路由，应通过 `include` 嵌入主站现有的
  HTTPS `server` 块。

宿主机路由片段只负责 `/development/` 静态 SPA fallback，以及
`/api/development/v1/` 到 `127.0.0.1:3100` 的代理。它转发 Authorization header，以便 API 向主站核验
登录身份。主站原有的 `/development` 路由继续提供施工页，不能把它重定向到 `/development/`。片段不包含生产域名和 TLS 配置。

Nginx 片段只由 `sudo scripts/install-server.sh` 安装；Web 产物只由 root-owned release hook 指向不可变
release。不得手工把构建目录同步到 `/usr/share/nginx/html/development`，否则会绕过归档校验、部署锁和
失败恢复。

在主站对应的 HTTPS `server` 块中加入且只加入一次：

```nginx
include /etc/nginx/snippets/freebbs-development.locations.conf;
```

然后校验并平滑加载现有主站 Nginx。这里不启动额外 Nginx 实例：

```bash
sudo nginx -t
sudo systemctl reload nginx.service
```

### 安装与启用 systemd 单元

API、Web 验证、备份 service/timer 均由 `sudo scripts/install-server.sh` 安装。安装器只执行
`daemon-reload`，不启动任何服务。release hook 会在选择不可变版本时启动并验证 API/Web；首次发布
成功后再执行：

```bash
sudo systemctl enable freebbs-development-api.service
sudo systemctl enable freebbs-development-web.service
sudo systemctl enable --now freebbs-development-backup.timer
```

日常发布、首次/后续分支和精确验收命令统一见
[生产发布与数据恢复检查清单](./production-release-checklist.md)。不要手工复制 unit、构建目录或切换链接。

## Docker Compose 部署

`docker-compose.yml` 是仓库支持的容器化集成入口。默认栈可用于不带持久化的 demo/memory 核对；
MySQL 通过 `mysql` profile 启用，演示数据通过 `seed` profile 显式写入，Adminer 通过 `adminer`
profile 显式启用。主机只在 `127.0.0.1:${WEB_PORT:-8080}` 暴露 Web/API 入口，数据库只有容器网络内的
`expose: 3306`。`seed` profile 固定为 development 且只能用于本地/集成环境。

当前 Compose 的 `api`、`migrate` 和 `seed` 服务共用一组 `MYSQL_USER`/`MYSQL_PASSWORD`，适合本地 MySQL
集成，但不满足上文“运行时 DML 账号与迁移 DDL 账号分离”的生产基线。在部署配置支持两组独立
凭据并经过测试前，生产应采用 systemd/受控迁移流程；不要把本地 Compose 配置原样发布到公网。

执行集成检查时必须显式注入变量，并确保 `DATA_MODE=mysql`。先检查解析后的配置中没有意外的演示
认证或明文秘密：

```bash
docker compose --profile mysql config
docker compose --profile mysql up --build -d
docker compose --profile mysql ps
```

数据库不映射宿主机公网端口。Adminer 默认不启动；确需临时排障时，它只能绑定
`127.0.0.1:${ADMINER_PORT:-8081}`，并应配合 SSH 隧道，使用后立即停止。常规业务管理应使用
`/development/admin` 页面，而不是 Adminer。

## 健康检查与发布验收

至少核对：

1. `GET /api/development/v1/health` 返回 HTTP 200、`data.status=ok`、`data.databaseMode=mysql`。
2. `/development/` 的 HTML、JS、CSS 均在该子路径下成功加载。
3. 已登录主站用户可打开发展端；无效或缺失 Token 得到预期的 401 登录提示。
4. 普通同学无法打开最高权限管理操作；管理员可读取模块状态和审计日志。
5. 日志无凭据、堆栈泄露、持续 5xx 或主站身份接口超时。

## 回滚

应用回滚不能自动撤销已经执行的数据库迁移。发布前必须判断新旧代码是否都兼容迁移后的结构。
发布成功后的回滚只调用 root-owned、带部署锁和失败恢复的同一 hook：

```bash
sudo /usr/local/sbin/deploy-freebbs-development \
  --rollback-to "$PREVIOUS_RELEASE_SHA" \
  --domain "$FREEBBS_DOMAIN"
```

禁止手工分两次切 API/Web 链接或单独重启服务。目标 SHA 取得、首次发布无上一版、回滚验证和数据库
forward-only 边界见[生产发布与数据恢复检查清单](./production-release-checklist.md)。

## 故障定位

### 502 Bad Gateway

先检查 API systemd/容器状态，再从服务器本机访问端口 3100。若本机健康、域名 502，检查 Nginx
upstream 和防火墙；端口 3100 不得从公网到达。

### 401 或 503

401 通常表示没有 Token 或主站判定身份无效；503 表示主站身份服务不可用、超时或响应无效。检查
`MAIN_SITE_API_BASE_URL`、服务器到主站的 DNS/TLS/网络和 `AUTH_TIMEOUT_MS`，不要打印 Token。

### 页面刷新后 404

确认 `/development/` location 使用 SPA fallback 到 `/development/index.html`，且构建产物的 Vite base
仍是 `/development/`。

### API 健康但业务请求 500

用响应 `X-Request-Id` 关联 journal/container 日志，检查迁移状态和数据库连接。不要把数据库凭据或
原始用户数据粘贴到公开问题单。

## 当前生产执行入口

逐次生产操作统一按[生产发布与数据恢复检查清单](./production-release-checklist.md)执行。服务器配置拆分为
`/etc/freebbs-development/development.env` 与 `/etc/freebbs-development/backup.env`。首次安装执行
`sudo scripts/install-server.sh`；正式发布只使用 commit 归档和
`/usr/local/sbin/deploy-freebbs-development`，不手工复制构建目录。数据库迁移在私网 self-hosted
runner 或服务器本地执行，Adminer 只能通过回环端口和 SSH 隧道访问。
