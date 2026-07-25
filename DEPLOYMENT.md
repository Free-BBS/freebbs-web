# FREE-BBS CI/CD and Deployment

本项目采用一台应用服务器 + 一台数据服务器的部署方式。

- GitHub Actions 运行在 GitHub 托管 runner 上
- GitHub Actions 通过 SSH 把发布包上传到应用服务器
- 应用服务器本地执行部署、重启服务
- 数据服务器只允许来自应用服务器 IP 的 MySQL 连接

## 1. 网络结构

建议：

- 应用服务器公网可 SSH
- 数据服务器 MySQL 仅监听内网地址或防火墙白名单
- 数据服务器只允许 `应用服务器 IP -> 3306`

MySQL 授权示例：

```sql
CREATE USER 'freebbs'@'APP_SERVER_IP' IDENTIFIED BY 'strong-password';
GRANT ALL PRIVILEGES ON free_bbs.* TO 'freebbs'@'APP_SERVER_IP';
FLUSH PRIVILEGES;
```

这里的 `APP_SERVER_IP` 必须是数据服务器实际看到的应用服务器来源 IP。

## 2. 应用服务器准备

以下假设应用服务器使用 Linux。

安装基础依赖：

```bash
sudo apt-get update
sudo apt-get install -y git rsync mysql-client
```

安装 Node.js 24 LTS 和 npm，并确认服务器实际使用的版本：

```bash
/usr/bin/node --version
/usr/bin/npm --version
```

`/usr/bin/node --version` 必须为 `v24` 或更高版本。Node 需要安装在系统路径中，不要只
安装到 `deploy` 用户的 nvm 目录。GitHub runner 与应用服务器都以仓库根目录的
`.nvmrc` 为版本基准；GitHub runner 不会自动升级应用服务器上的 Node.js。部署脚本会在
同步生产目录前检查 `/usr/bin/node` 及 systemd 的实际启动命令，避免旧运行时造成只更新
了一半的发布。

创建部署用户、彼此隔离的服务用户与 Unix Socket 共享组：

```bash
sudo useradd -m -s /bin/bash deploy || true
sudo groupadd --system freebbs-agent-config || true
sudo groupadd --system freebbs-backend || true
sudo groupadd --system freebbs-agent || true
sudo groupadd --system freebbs-frontend || true
id -u freebbs-backend >/dev/null 2>&1 || \
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin \
  --gid freebbs-agent-config --groups freebbs-backend freebbs-backend
id -u freebbs-agent >/dev/null 2>&1 || \
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin \
  --gid freebbs-agent-config --groups freebbs-agent freebbs-agent
id -u freebbs-frontend >/dev/null 2>&1 || \
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin \
  --gid freebbs-frontend freebbs-frontend
id deploy
sudo mkdir -p /data/www/free-BBS
sudo mkdir -p /etc/free-bbs
sudo chown -R deploy:deploy /data/www/free-BBS
sudo chown root:deploy /etc/free-bbs
sudo chmod 751 /etc/free-bbs
```

如果这里的 `id deploy` 报 `no such user`，说明部署用户还没创建成功，先重新执行：

```bash
sudo useradd -m -s /bin/bash deploy
```

`deploy` 只负责发布文件、执行手动数据库迁移和重启服务，不运行站点进程，也不要加入
`freebbs-agent-config` 组。这样前端进程和部署进程都无法连接内部配置 socket。

如果你不想使用 `deploy` 这个部署用户名，可以换成已有用户，但要同步修改
`/etc/sudoers.d/free-bbs-runner` 和环境文件所有者。三个服务用户建议保持独立。

## 3. 环境变量文件

在应用服务器创建仅供后端和数据库迁移读取的 `/etc/free-bbs/free-bbs.env`：

```bash
API_HOST=0.0.0.0
API_PORT=3001

BACKEND_IP=DATA_SERVER_IP
MYSQL_PORT=3306
MYSQL_USER=freebbs
MYSQL_PASSWORD=strong-password
MYSQL_DATABASE=free_bbs

UPLOAD_DIR=/data/www/free-BBS/uploads
AUTH_SECRET=replace-with-a-random-secret
AGENT_URL=http://127.0.0.1:5001
AGENT_SERVICE_TOKEN=replace-with-at-least-32-random-characters
AGENT_SETTINGS_REQUIRED=true
AGENT_SETTINGS_SOCKET=/run/free-bbs/agent-config.sock
SETTINGS_ENCRYPTION_KEY=replace-with-32-random-bytes-in-base64
LLM_BASE_URL=https://cloud.infini-ai.com/maas/v1
LLM_MODEL=glm-5.1
COURSE_MATERIALS_ALLOWED_ROOT=/data/free-bbs/courses
COURSE_MATERIALS_ROOT=/data/free-bbs/courses

BOTMAIL_SMTP=smtp.feishu.cn
BOTMAIL_SMTP_PORT=465
BOTMAIL_IMAP=imap.feishu.cn
BOTMAIL_IMAP_PORT=993
BOTMAIL_USER=bot@free-bbs.cn
BOTMAIL_FROM=bot@free-bbs.cn
BOTMAIL_PASS=your-mail-password
```

另建不含任何数据库密码、服务 token 或加密密钥的 `/etc/free-bbs/frontend.env`：

```bash
HOST=0.0.0.0
PORT=3000
```

生成服务令牌与设置加密密钥：

```bash
openssl rand -base64 48
openssl rand -base64 32
```

第一条输出填写到 `AGENT_SERVICE_TOKEN`，第二条输出填写到
`SETTINGS_ENCRYPTION_KEY`。后端环境文件由部署用户维护，仅后端服务组可读；前端使用完全
独立的无密钥环境文件：

```bash
sudo chown deploy:freebbs-backend /etc/free-bbs/free-bbs.env
sudo chmod 640 /etc/free-bbs/free-bbs.env
sudo chown deploy:freebbs-frontend /etc/free-bbs/frontend.env
sudo chmod 640 /etc/free-bbs/frontend.env
sudo mkdir -p /data/free-bbs/courses
sudo chown -R freebbs-agent:freebbs-agent-config /data/free-bbs/courses
sudo chmod 750 /data/free-bbs/courses
```

后端会在 `AGENT_SETTINGS_SOCKET` 上启动独立的 Unix Socket API。该接口不挂载到公网
Express 应用，并要求 `Authorization: Bearer <AGENT_SERVICE_TOKEN>`。不要在 Nginx 或其它
反向代理中暴露此 socket。socket 为 `0660`，运行目录为 `0750`，只有后端与 Agent 的
`freebbs-agent-config` 共享组能够连接；前端和 `deploy` 用户不在该组。
生产 systemd 单元强制设置 `AGENT_SETTINGS_REQUIRED=true`：服务令牌缺失、内部 API
启动失败或运行时失效时，后端会启动失败或让 `/api/health` 返回 `503`。本地开发未显式
开启该变量时仍可不启用内部 API。

创建上传目录：

```bash
sudo mkdir -p /data/www/free-BBS/uploads
sudo chown -R deploy:deploy /data/www/free-BBS
sudo chown -R freebbs-backend:freebbs-backend /data/www/free-BBS/uploads
```

## 4. systemd 服务

将以下文件复制到系统目录：

- `deploy/systemd/free-bbs-frontend.service`
- `deploy/systemd/free-bbs-backend.service`

然后：

```bash
sudo cp deploy/systemd/free-bbs-frontend.service /etc/systemd/system/
sudo cp deploy/systemd/free-bbs-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable free-bbs-frontend
sudo systemctl enable free-bbs-backend
sudo systemctl show free-bbs-frontend free-bbs-backend --property=ExecStart
```

service 文件分别使用 `freebbs-frontend` 与 `freebbs-backend`。不要为了省事改回同一个
`deploy` 用户，否则前端进程将重新获得读取后端密钥环境和连接内部 socket 的机会。

## 5. GitHub Actions SSH 部署

GitHub Actions 不再需要安装 self-hosted runner。

应用服务器需要具备：

- 读写 `/data/www/free-BBS`
- 手动执行数据库迁移工作流时，读取 `/etc/free-bbs/free-bbs.env`
- 执行 `sudo systemctl restart free-bbs-frontend`
- 执行 `sudo systemctl restart free-bbs-backend`

建议给部署用户单独加 sudoers：

```bash
sudo visudo -f /etc/sudoers.d/free-bbs-runner
```

写入：

```text
deploy ALL=NOPASSWD:/bin/systemctl restart free-bbs-frontend,/bin/systemctl restart free-bbs-backend,/bin/systemctl status free-bbs-frontend,/bin/systemctl status free-bbs-backend
```

如果你的 `systemctl` 路径不同，用 `which systemctl` 确认后再写。

然后为 GitHub Actions 准备 SSH 登录：

```bash
sudo -u deploy mkdir -p /home/deploy/.ssh
sudo -u deploy chmod 700 /home/deploy/.ssh
sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/github-actions -C "github-actions@free-bbs"
sudo -u deploy cat /home/deploy/.ssh/github-actions.pub
```

把公钥追加到服务器上的 `~deploy/.ssh/authorized_keys`：

```bash
sudo -u deploy sh -c 'cat /home/deploy/.ssh/github-actions.pub >> /home/deploy/.ssh/authorized_keys'
sudo -u deploy chmod 600 /home/deploy/.ssh/authorized_keys
```

把私钥内容保存到 GitHub 仓库的 `Settings -> Secrets and variables -> Actions`：

- `DEPLOY_HOST`: 应用服务器 IP 或域名
- `DEPLOY_USER`: `deploy`
- `DEPLOY_SSH_KEY`: `/home/deploy/.ssh/github-actions` 私钥全文

建议再配置以下 repository variables：

- `DEPLOY_PORT`: `22`
- `DEPLOY_PATH`: `/data/www/free-BBS`
- `FREE_BBS_ENV_FILE`: `/etc/free-bbs/free-bbs.env`
- `FRONTEND_SERVICE_NAME`: `free-bbs-frontend`
- `BACKEND_SERVICE_NAME`: `free-bbs-backend`
- `HEALTHCHECK_URL`: `http://127.0.0.1:3001/api/health`

## 6. GitHub Workflow

仓库里已经提供：

- `.github/workflows/deploy.yml`
- `.github/workflows/db-migrate.yml`
- `scripts/ci-validate.sh`
- `scripts/deploy.sh`
- `scripts/migrate.sh`

工作流逻辑：

1. GitHub 托管 runner checkout 代码
2. 执行 `npm ci`
3. 做语法和必要文件检查
4. 打包代码并通过 SSH 上传到应用服务器
5. 应用服务器解压发布包并同步到 `/data/www/free-BBS`
6. 仅安装生产依赖
7. 重启前后端服务并做健康检查

头像和其它上传文件不会放进 Git。生产环境的 `UPLOAD_DIR=/data/www/free-BBS/uploads` 是运行期持久目录，`scripts/deploy.sh` 会在同步代码时排除 `uploads` 和 `database/uploads`，避免 `rsync --delete` 在每次部署时删除用户头像。

普通代码部署不会读取 `/etc/free-bbs/free-bbs.env`，避免让 SSH 发布流程接触数据库密码、
Agent token 和设置加密密钥。只有明确填写 `RUN` 的数据库迁移工作流会加载该文件。

数据库变更需要手动触发 `.github/workflows/db-migrate.yml`，并在输入框里明确填写 `RUN`。迁移脚本会执行 `database/migrations/*.sql` 中尚未执行过的文件，而不是反复重跑整份初始化 SQL。

如果数据库迁移提示环境文件不可读，保持文件为 `0640`，不要改成 `0644`：

```bash
sudo chown deploy:freebbs-backend /etc/free-bbs/free-bbs.env
sudo chmod 0640 /etc/free-bbs/free-bbs.env
sudo -u deploy test -r /etc/free-bbs/free-bbs.env
```

系统设置功能依赖 `016_create_system_secret_settings.sql`。部署包含该功能的版本前，先手动
运行数据库迁移工作流；否则管理员保存模型 API key 时会失败。

## 7. 数据服务器为什么只需要放行应用服务器

因为数据库迁移仍然是在应用服务器上执行。

真实链路是：

- GitHub 触发 workflow
- GitHub 托管 runner 通过 SSH 登录应用服务器
- 应用服务器本机执行 `mysql -h DATA_SERVER_IP ...`

所以数据服务器只需要相信应用服务器 IP，不需要相信 GitHub 的公网 IP 段。

## 8. 首次上线建议顺序

1. 先在应用服务器上手动 `git clone`
2. 手动执行 `npm ci`
3. 以 `deploy` 用户手动 `source /etc/free-bbs/free-bbs.env`
4. 手动执行 `bash scripts/migrate.sh`
5. 手动启动两个 systemd 服务
6. 确认服务正常
7. 再启用 GitHub Actions 自动部署

## 9. `chown: invalid user` 的处理

报这个错只有一个原因：系统中不存在 `deploy` 用户。

先执行：

```bash
id deploy
```

如果输出 `no such user`，执行：

```bash
sudo useradd -m -s /bin/bash deploy
sudo mkdir -p /data/www/free-BBS/uploads
sudo mkdir -p /etc/free-bbs
sudo chown -R deploy:deploy /data/www/free-BBS
sudo chown root:deploy /etc/free-bbs
sudo chmod 751 /etc/free-bbs
```

如果报错对象是 `freebbs-backend`、`freebbs-agent` 或 `freebbs-frontend`，重新执行第 2 节的
系统组和无登录服务用户创建命令。不要把三个 service 的 `User=` 统一改成 `deploy`。

这样先把环境打通，再交给 CI/CD。
