# FREE-BBS CI/CD and Deployment

本项目采用一台应用服务器 + 一台数据服务器的部署方式。

- GitHub Actions runner 运行在应用服务器上
- 应用服务器拉代码、校验、部署、重启服务
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

安装 Node.js 20 和 npm。

创建部署用户与目录：

```bash
sudo useradd -m -s /bin/bash deploy || true
id deploy
sudo mkdir -p /data/www/free-BBS
sudo mkdir -p /etc/free-bbs
sudo chown -R deploy:deploy /etc/free-bbs
sudo chown -R deploy:deploy /data/www/free-BBS
```

如果这里的 `id deploy` 报 `no such user`，说明部署用户还没创建成功，先重新执行：

```bash
sudo useradd -m -s /bin/bash deploy
```

如果你不想使用 `deploy` 这个用户名，也可以换成你机器上已经存在的用户，但要同时修改：

- `deploy/systemd/free-bbs-frontend.service`
- `deploy/systemd/free-bbs-backend.service`
- `/etc/sudoers.d/free-bbs-runner`

## 3. 环境变量文件

在应用服务器创建 `/etc/free-bbs/free-bbs.env`：

```bash
HOST=0.0.0.0
PORT=3000

API_HOST=0.0.0.0
API_PORT=3001

BACKEND_IP=DATA_SERVER_IP
MYSQL_PORT=3306
MYSQL_USER=freebbs
MYSQL_PASSWORD=strong-password
MYSQL_DATABASE=free_bbs

UPLOAD_DIR=/data/www/free-BBS/uploads
AUTH_SECRET=replace-with-a-random-secret

BOTMAIL_SMTP=smtp.feishu.cn
BOTMAIL_SMTP_PORT=465
BOTMAIL_IMAP=imap.feishu.cn
BOTMAIL_IMAP_PORT=993
BOTMAIL_USER=bot@free-bbs.cn
BOTMAIL_FROM=bot@free-bbs.cn
BOTMAIL_PASS=your-mail-password
```

创建上传目录：

```bash
sudo mkdir -p /data/www/free-BBS/uploads
sudo chown -R deploy:deploy /data/www/free-BBS
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
```

注意：service 文件里默认使用 `deploy` 用户。如果你的实际部署用户不同，要同步修改。

## 5. GitHub Actions Runner

在应用服务器上，用 `deploy` 用户安装 GitHub self-hosted runner。

在 GitHub 仓库：

- `Settings`
- `Actions`
- `Runners`
- `New self-hosted runner`

按页面给出的命令在应用服务器执行即可。

Runner 需要具备：

- 读写 `/data/www/free-BBS`
- 读取 `/etc/free-bbs/free-bbs.env`
- 执行 `sudo systemctl restart free-bbs-frontend`
- 执行 `sudo systemctl restart free-bbs-backend`

建议给 runner 用户单独加 sudoers：

```bash
sudo visudo -f /etc/sudoers.d/free-bbs-runner
```

写入：

```text
deploy ALL=NOPASSWD:/bin/systemctl restart free-bbs-frontend,/bin/systemctl restart free-bbs-backend,/bin/systemctl status free-bbs-frontend,/bin/systemctl status free-bbs-backend
```

如果你的 `systemctl` 路径不同，用 `which systemctl` 确认后再写。

## 6. GitHub Workflow

仓库里已经提供：

- `.github/workflows/deploy.yml`
- `scripts/ci-validate.sh`
- `scripts/deploy.sh`
- `scripts/migrate.sh`

工作流逻辑：

1. 在应用服务器 runner 上 checkout 代码
2. 执行 `npm ci`
3. 做语法和必要文件检查
4. 同步代码到 `/data/www/free-BBS`
5. 重新安装依赖
6. 读取 `/etc/free-bbs/free-bbs.env`
7. 从应用服务器连接数据服务器执行 `schema.sql` 和 `seed.sql`
8. 重启前后端服务

## 7. 数据服务器为什么只需要放行应用服务器

因为 workflow 并不是 GitHub 云端 runner 在直接连数据库。

真实链路是：

- GitHub 触发 workflow
- 应用服务器上的 self-hosted runner 接任务
- runner 在应用服务器本机执行 `mysql -h DATA_SERVER_IP ...`

所以数据服务器只需要相信应用服务器 IP，不需要相信 GitHub 的公网 IP 段。

## 8. 首次上线建议顺序

1. 先在应用服务器上手动 `git clone`
2. 手动执行 `npm ci`
3. 手动 `source /etc/free-bbs/free-bbs.env`
4. 手动执行 `bash scripts/migrate.sh`
5. 手动启动两个 systemd 服务
6. 确认服务正常
7. 再启用 GitHub Actions 自动部署

## 9. 你刚才这类 `chown: invalid user: 'deploy:deploy'` 的处理

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
sudo chown -R deploy:deploy /etc/free-bbs
```

如果你希望直接用当前登录用户，而不是新建 `deploy`，把上面命令里的 `deploy:deploy` 改成你的用户名，并同步修改两个 systemd service 文件中的 `User=` 和 `Group=`。

这样先把环境打通，再交给 CI/CD。
