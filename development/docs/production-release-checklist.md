# 生产发布与数据恢复检查清单

本清单是 FreeBBS 发展端生产变更的执行入口。命令从仓库根目录执行；任何密码、Token 和 SSH 私钥都只能由受控密钥系统或交互式安全输入提供，不写入 Git、命令参数或日志。真实 UID 按个人信息处理，只能出现在获批初始化命令和受限审计中，不粘贴到公开日志或问题单。

## 1. 明确发布输入与当前基线

每次都先设置：

```bash
export FREEBBS_DOMAIN='<主站实际域名，不含协议和路径>'
export RELEASE_SHA='<受保护 main 上待发布的 40 位 commit SHA>'
[[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
```

- `FREEBBS_DOMAIN` 来自已生效的主站 DNS/TLS 配置。
- `RELEASE_SHA` 来自受保护 `main` 的 GitHub commit 页面和本次工作流，必须是 40 位小写 SHA。
- 首次建立最高管理员时再设置 `FIRST_SUPER_ADMIN_UID='<主站确认的 UID>'`；它来自主站
  `GET /api/auth/me` 的受信结果，不能臆造。已有管理员的发布不得重复 bootstrap。

随后只从已选中的不可变 release 读取上一版本证据，不能直接把 `readlink` 的完整路径当成 SHA：

```bash
export PREVIOUS_RELEASE_SHA=''
if [[ -L /opt/freebbs-development/current ]]; then
  current_release="$(readlink -f /opt/freebbs-development/current)"
  PREVIOUS_RELEASE_SHA="$(tr -d '\n' < "$current_release/.release-sha")"
  [[ "$PREVIOUS_RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]
  [[ "$current_release" == "/opt/freebbs-development/releases/$PREVIOUS_RELEASE_SHA" ]]
  export PREVIOUS_RELEASE_SHA
else
  test ! -e /opt/freebbs-development/current
fi
```

- `PREVIOUS_RELEASE_SHA` 非空表示后续发布，必须先备份，并可使用受审计 rollback。
- 空值表示首次发布。DBA 必须确认目标业务库没有既有业务数据，变更单记录
  `FIRST_RELEASE_EMPTY_DB`；不得把“没有 current”误当作“数据库为空”。首次发布没有可回滚应用版本。

同时记录变更单、操作者、UTC 时间、目标 SHA、基线类型和后续发布的备份 SHA-256。若任何输入仍是占位符，停止发布。

## 2. 发布权限与 GitHub 门禁

- protected `main` branch 必须启用：禁止直接绕过评审和必需检查。
- GitHub `production` environment 保存 secrets `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`、`DEPLOY_KNOWN_HOSTS`，以及 variables `PRODUCTION_URL`、`FREEBBS_DOMAIN`，并配置审批人。`FREEBBS_DOMAIN` 仅含正式域名，不含协议和路径。
- GitHub `production-database` environment 保存迁移账号凭据并配置审批人。
- 数据库迁移 job 只在带有 `self-hosted, linux, production-database` 标签的私网 runner 上运行；也可由获批操作者在服务器本地执行。
- pull request 只能运行 CI，不得获得生产或数据库环境。

## 3. 安装或更新受审计服务器文件

每次发布都先在服务器检出并核对精确 `RELEASE_SHA`，再执行非启动安装器。它会更新 root-owned hook、Nginx 片段和 unit；首次发布还会创建目录与环境模板：

```bash
sudo scripts/install-server.sh
sudo stat -c '%U:%G %a %n' \
  /usr/local/sbin/deploy-freebbs-development \
  /etc/freebbs-development/development.env \
  /etc/freebbs-development/backup.env
sudo cmp scripts/deploy-release.sh /usr/local/sbin/deploy-freebbs-development
```

期望 hook 为 `root:root 755`，两个环境文件为 `root:freebbs-development 640`，`cmp` 无输出且退出 0。安装器会安全更新受审计程序和 unit，但不会覆盖已有环境文件，也不会启动服务；这一步确保本次 readiness 路径与 rollback 逻辑先于应用发布更新。

分别编辑：

```bash
sudoedit /etc/freebbs-development/development.env
sudoedit /etc/freebbs-development/backup.env
sudo systemctl daemon-reload
```

`development.env` 只放应用账号；`backup.env` 只放备份账号。生产 API 固定监听 `127.0.0.1:3100`。配置完成前不要启动 unit。

## 4. 准备三个最小权限 MySQL 账号

账号名称固定区分职责：

| 账号                            | 用途       | 长期权限边界                                        |
| ------------------------------- | ---------- | --------------------------------------------------- |
| `freebbs_development_app`       | API 运行   | 业务库 DML，不含 DDL 或授权                         |
| `freebbs_development_migration` | 受审批迁移 | 迁移所需 DDL/DML、索引和 routine，无 `GRANT OPTION` |
| `freebbs_development_backup`    | 逻辑备份   | `SELECT`、`SHOW VIEW`、`TRIGGER`、`EVENT`，无写权限 |

由 DBA 在私网创建账号并从密钥系统注入独立强密码；不要复制同一密码。MySQL 3306 不暴露公网。API 不使用 migration 或 backup 凭据，普通管理员也不能获得数据库账号。

迁移 job 的 secrets 使用 `MYSQL_MIGRATION_USER=freebbs_development_migration`。服务器上的 `development.env` 使用 `MYSQL_USER=freebbs_development_app`，`backup.env` 使用 `MYSQL_USER=freebbs_development_backup`。

## 5. 后续发布先备份；首次发布确认空基线

后续发布（`PREVIOUS_RELEASE_SHA` 非空）首次启用定时器，并在迁移前强制备份：

```bash
sudo systemctl enable --now freebbs-development-backup.timer
systemctl list-timers freebbs-development-backup.timer
sudo systemctl start freebbs-development-backup.service
sudo journalctl -u freebbs-development-backup.service --since '-10 minutes'
```

备份目录与文件只允许 `freebbs-development` 和 root 读取。以下检查、加密和异地复制必须在短时受审计
root shell 内执行；不得通过 `chmod` 或 `chown` 扩大长期读取权限：

```bash
sudo -i
umask 077
export BACKUP_FILE='<本次 /var/backups/freebbs-development/*.sql 的绝对路径>'
cd "$(dirname "$BACKUP_FILE")"
sha256sum --check "$(basename "$BACKUP_FILE").sha256"
test -s "$BACKUP_FILE"
export BACKUP_RECIPIENT='<密钥系统登记的 age recipient>'
age -r "$BACKUP_RECIPIENT" -o "$BACKUP_FILE.age" "$BACKUP_FILE"
(
  cd "$(dirname "$BACKUP_FILE")"
  sha256sum "$(basename "$BACKUP_FILE").age" \
    > "$(basename "$BACKUP_FILE").age.sha256"
)
rsync -av -- "$BACKUP_FILE.age" "$BACKUP_FILE.age.sha256" \
  '<受控异地备份目标>/'
exit
```

本机文件和 `.sha256` 不是完整灾备。异地目标必须加密、访问受控，并与应用服务器处于不同故障域。
保留期由 `BACKUP_RETENTION_DAYS` 和学校数据政策共同确定；删除前确认异地副本和最近一次 restore drill。

首次发布没有 `/opt/freebbs-development/current`，备份 unit 的 Condition 会阻止执行。此时不得假装生成了
备份；只在 DBA 完成第 1 节的空库核验并留下 `FIRST_RELEASE_EMPTY_DB` 证据后继续。

## 6. 对同一 SHA 执行迁移

首选 GitHub `Production database migration` 手工工作流：选择受保护 `main`，输入精确的 `RUN`，等待
`production-database` 审批。审批前核对该 workflow run 的 commit 正好等于 `RELEASE_SHA`，工作流执行：

```bash
npm run db:migrate
```

服务器本地替代方案必须在受控 shell 中注入 migration 账号，并检出精确 `RELEASE_SHA` 后执行同一命令。
发布迁移必须采用 expand/contract 方式，同时兼容当前运行版本与 `RELEASE_SHA`；破坏性收缩要等旧版本
完全退出且另行审批后再发布。不得在生产运行演示 seed CLI。

记录同一 `RELEASE_SHA` 的迁移 workflow URL、结果和 `schema_migrations` 证据。它们未就绪时，保持
`production` environment 的 release approval 为待审批状态；不能因为 deploy workflow 已排队就提前批准。

## 7. 创建并发布 commit 归档

在干净的 GitHub runner 上从指定 Git commit object 创建归档：

```bash
scripts/create-release-archive.sh \
  --sha "$RELEASE_SHA" \
  --output "freebbs-development-$RELEASE_SHA.tar.gz"
```

确认 GitHub artifact 已保存，再暴露 SSH secrets。工作流上传并调用 root-owned hook；人工等价命令为：

```bash
scp "freebbs-development-$RELEASE_SHA.tar.gz" \
  '<deploy-user>@<server-host>:/tmp/'
ssh '<deploy-user>@<server-host>' \
  "sudo /usr/local/sbin/deploy-freebbs-development \
    --archive '/tmp/freebbs-development-$RELEASE_SHA.tar.gz' \
    --sha '$RELEASE_SHA' \
    --domain '$FREEBBS_DOMAIN'"
```

hook 校验归档路径、成员类型、软链接和 `.release-sha`，锁定依赖并在服务器构建，然后切换 API 与 Web 两个链接。Web 探针使用正式域名的 HTTPS、SNI 与 Host 连接本机 443，并逐字节核对响应和目标 release 的 `index.html`，从而拒绝跳转、默认虚拟主机或旧版本内容。安装、构建、Nginx、服务、readiness 或 Web 检查失败时自动恢复前一版本。它不会运行 seed。

## 8. 发布后冒烟与首次管理员初始化

服务器本机先检查无需登录的真实 API 路径：

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:3100/api/development/v1/health
curl --fail --silent --show-error \
  http://127.0.0.1:3100/api/development/v1/ready
```

外部同源入口：

```bash
curl --fail --silent --show-error \
  "https://${FREEBBS_DOMAIN}/development/" > /dev/null
```

首次成功选中 release 后启用重启持久化和后续备份；重复执行是幂等的：

```bash
sudo systemctl enable freebbs-development-api.service
sudo systemctl enable freebbs-development-web.service
sudo systemctl enable --now freebbs-development-backup.timer
```

仅首次发布在 release 成功、`current` 已存在、健康与 Web 检查已通过之后，以应用账号凭据执行一次性
受控 unit：

```bash
sudo systemd-run --wait --pipe --collect \
  --unit="freebbs-development-bootstrap-${RELEASE_SHA:0:12}" \
  --property=User=freebbs-development \
  --property=Group=freebbs-development \
  --property=WorkingDirectory=/opt/freebbs-development/current \
  --property=EnvironmentFile=/etc/freebbs-development/development.env \
  --setenv=NODE_ENV=production \
  --setenv="APP_VERSION=$RELEASE_SHA" \
  npm run admin:bootstrap -- \
    --uid "$FIRST_SUPER_ADMIN_UID" \
    --confirm "BOOTSTRAP_SUPER_ADMIN:$FIRST_SUPER_ADMIN_UID"
```

该命令显式设置 `NODE_ENV=production`，并从 `development.env` 获得 `DATA_MODE=mysql` 和应用账号的
`MYSQL_*`；不得把 migration 或 backup 凭据写入应用环境文件。已有有效最高管理员时跳过 bootstrap。
恢复模式只用于获批事故流程，并要留下受限审计记录。

随后用真实主站账号完成：

1. 确认 `DEVELOPMENT_PREVIEW_UIDS` 已填入真实主站 UID；白名单账号从主站 `/development` 进入 `/development/`，登录后深层链接也可返回；
2. 非白名单账号打开主站 `/development` 仍看到原施工页，直接请求发展端 API 返回 403；
3. 普通同学只能看到获授权数据，敏感写操作返回 403；
4. 最高管理员能打开 `/development/admin`，但不在日志中出现 Bearer Token；
5. 检查一次角色/Tag/模块审计记录，并记录健康、静态入口、身份和权限 smoke 结果。

全部通过后才允许发布主站“发展端”入口。

## 9. 失败回滚与兼容性

部署过程中的失败由 hook 自动恢复 `current` 与 `/usr/share/nginx/html/development`，并重启旧
API/Nginx/Web unit。发布已成功、随后发现业务故障时，禁止手工分两次改链接；先确认数据库兼容，
再调用同一个 root-owned、带锁和失败恢复的受审计 hook：

```bash
test -n "$PREVIOUS_RELEASE_SHA"
sudo /usr/local/sbin/deploy-freebbs-development \
  --rollback-to "$PREVIOUS_RELEASE_SHA" \
  --domain "$FREEBBS_DOMAIN"
```

hook 校验目标不可变目录、`.release-sha` 和两端构建产物，在同一部署锁内切换 API/Web 链接，执行
Nginx、服务、readiness 与 Web 检查；任一步失败都会恢复调用前选中的两个链接。成功后重复第 8 节检查
并记录恢复确认。首次发布没有 `PREVIOUS_RELEASE_SHA`，不能执行应用回滚；应关闭主站入口并发布经验证
的修复版本，或进入获批的数据恢复/停机流程。

数据库迁移是 forward-only。应用回滚前必须由开发和 DBA 明确确认 `PREVIOUS_RELEASE_SHA` 与当前 schema
兼容；不得自动反向执行或删除迁移。若不兼容，保持新应用或进入经审批的数据恢复流程。

## 10. Restore drill 与恢复确认

至少按组织政策定期执行 restore drill，且不直接覆盖在线生产库。先准备与生产断网隔离的临时 MySQL
实例；`freebbs-restore-client.cnf` 只能指向该实例，不能含生产主机或生产凭据。备份由
`mysqldump --databases` 生成，会在隔离实例内恢复原数据库名 `free_bbs_development`：

```bash
cd '<已下载的 .age 与 .age.sha256 所在受控目录>'
export ENCRYPTED_BACKUP_FILE='<备份文件名.sql.age>'
sha256sum --check "$ENCRYPTED_BACKUP_FILE.sha256"
age -d -i '<受控恢复私钥>' \
  -o /srv/restore/freebbs-development.sql \
  "$ENCRYPTED_BACKUP_FILE"
mysql --defaults-extra-file=/run/secrets/freebbs-restore-client.cnf \
  < /srv/restore/freebbs-development.sql
```

在隔离实例的 `free_bbs_development` 库核对 `schema_migrations`、关键表数量、UTF-8/UTC/金额字段、
权限与审计数据，并用对应应用 commit 做只读 smoke。业务负责人、开发负责人和 DBA 三方确认恢复点、
数据差异和后续方案后，才可进入生产恢复窗口。演练完成后销毁临时实例和明文 SQL。

## 11. Adminer 仅限回环与 SSH 隧道

生产 systemd 部署不得使用本地 Compose 的 `adminer` profile，因为该 profile 会启动自己的开发 MySQL
与迁移服务。确需排障时，在 Linux 服务器上启动独立的临时容器；host network 只用于连接仅监听回环的
生产 MySQL，PHP 服务也显式只绑定 `127.0.0.1:8081`：

```bash
docker run --rm --detach \
  --name freebbs-development-adminer \
  --network host \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --env ADMINER_DEFAULT_SERVER=127.0.0.1 \
  adminer:5-standalone \
  php -S 127.0.0.1:8081 -t /var/www/html
ss -ltn '( sport = :8081 )'
```

运维工作站建立隧道：

```bash
ssh -N -L 127.0.0.1:18081:127.0.0.1:8081 \
  '<ssh-user>@<server-host>'
```

只访问 `http://127.0.0.1:18081`，使用临时只读排障账号。完成后关闭隧道并执行：

```bash
docker stop freebbs-development-adminer
```

确认容器已因 `--rm` 删除、8081 不再监听，再撤销临时数据库账号。Adminer、MySQL、API 3100 都不得
直接暴露公网。
