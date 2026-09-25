# 数据库与业务数据管理

本文面向部署和最高权限管理员。FreeBBS 发展端支持 `memory` 与 `mysql` 两种数据模式；生产必须使用
MySQL。业务人员的日常管理应通过发展端“权限与模块管理”页面完成，原始数据库访问仅用于迁移、
备份、恢复和经批准的故障排查。

## 数据边界

当前持久化内容包括：

- 用户映射、角色、权限、角色分配、Tag 定义与分配；
- 模块状态、模块负责人和审计日志；
- 经验、公告、咨询、俱乐部、活动、代表队、联络资源和财务记录。

数据库迁移位于 `database/migrations/`，按文件名排序执行；演示 seed 位于
`database/seeds/001_demo.sql`。财务金额以整数分存储，不得直接用 SQL 改成浮点金额。

## 最小权限 MySQL 账号

以下示例假定 API 和 MySQL 在同一主机，并通过 `127.0.0.1` 连接。`<...>` 都是必须由部署负责人
替换的占位符；不要复制占位密码到生产。

先由数据库管理员执行一次：

```sql
CREATE DATABASE `free_bbs_development`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER 'freebbs_development_app'@'127.0.0.1'
  IDENTIFIED BY '<运行时强密码>';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON `free_bbs_development`.*
  TO 'freebbs_development_app'@'127.0.0.1';

CREATE USER 'freebbs_development_migration'@'127.0.0.1'
  IDENTIFIED BY '<迁移强密码>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES,
  CREATE TEMPORARY TABLES, CREATE ROUTINE, ALTER ROUTINE, EXECUTE
  ON `free_bbs_development`.*
  TO 'freebbs_development_migration'@'127.0.0.1';

CREATE USER 'freebbs_development_backup'@'127.0.0.1'
  IDENTIFIED BY '<备份强密码>';
GRANT SELECT, SHOW VIEW, TRIGGER, EVENT
  ON `free_bbs_development`.*
  TO 'freebbs_development_backup'@'127.0.0.1';
GRANT SHOW_ROUTINE ON *.*
  TO 'freebbs_development_backup'@'127.0.0.1';
```

运行时环境使用 `freebbs_development_app`；只有执行迁移时临时把 `MYSQL_USER` 和 `MYSQL_PASSWORD` 切换为
`freebbs_development_migration`。当前迁移包含 `ALTER TABLE`，所以运行时账号不足以执行迁移是预期行为。

若 API 与 MySQL 不在同一主机，应把账号 host 精确限制为 API 的私网来源地址或容器网段，并结合
防火墙限制 3306；不要为了方便创建可从公网访问的 `'user'@'%'`。Compose 自带数据库用于本地/集成
运行，生产账号边界仍需由数据库管理员核对。

## 迁移

在仓库根目录设置迁移账号的 `MYSQL_*` 变量，然后执行：

```bash
npm run db:migrate
```

脚本还要求 `DATA_MODE=mysql`，默认等待数据库 advisory lock 最多 60 秒。可先查看参数：

```bash
npm run db:migrate -- --help
```

`--directory PATH` 可指定迁移目录，`--lock-timeout SECONDS` 允许 0 到 300 秒。生产通常保持默认目录，
避免意外执行未经评审的 SQL。

迁移器会：

- 创建并读取 `schema_migrations`；
- 按名称顺序执行 `database/migrations/*.sql`；
- 记录 SHA-256 校验和；
- 已执行且校验和一致的迁移可安全重复核对；
- 已执行文件被修改时失败，而不是静默重跑。

因此，应新增迁移文件，禁止改写已部署迁移。DDL 在 MySQL 中可能隐式提交；即使脚本包裹事务，也
不能把所有结构变化都视为可自动回滚。生产迁移前必须备份。

迁移后核对：

```sql
SELECT name, checksum, applied_at
FROM schema_migrations
ORDER BY name;
```

再切回运行时账号启动 API，并确认：

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:3100/api/development/v1/health
```

响应中的 `databaseMode` 应为 `mysql`。

## 演示 seed

仅在全新的本地或集成测试数据库执行：

```bash
export NODE_ENV=development
export DATA_MODE=mysql
export ALLOW_DEMO_SEED=true
npm run db:seed
```

当前 seed 包含固定 UID、体育负责人、队长 Tag 和示例业务记录，也会创建 `demo-admin` 的用户映射；
它不会直接授予 `platform.super_admin`。最高管理员必须通过下文受保护的 `admin:bootstrap` 流程建立。
seed 不是生产初始化方案，禁止在生产运行。只有显式的 `NODE_ENV=development` 或
`NODE_ENV=test` 使用单门禁；生产、缺失或未知环境还会要求额外的
`ALLOW_PRODUCTION_DEMO_SEED=true`。该二次门禁用于默认失败关闭，并不构成生产运行授权。不要依赖 seed
主键或示例日期承载真实业务。
脚本只接受 INSERT 语句，把它们转换为幂等插入，并与迁移共用数据库 advisory lock。参数可通过
`npm run db:seed -- --help` 查看；`--file` 指定 seed 文件，`--lock-timeout` 范围为 0 到 300 秒。

仓库 Compose 也提供同等门禁的一次性 seed 服务。设置非空的本地 `MYSQL_PASSWORD` 和
`MYSQL_ROOT_PASSWORD` 后运行 `docker compose --profile seed run --rm seed`；它会先等待迁移成功，再写入
演示数据。该 profile 固定为 development，不是生产初始化入口。

如果 seed 因重复键失败，不要手工删除生产表来“修复”。应确认连接的是可丢弃的本地数据库，再
选择新建空库或使用明确的测试清理流程。

## 生产管理员初始化

受控初始化只用于生产 MySQL，并要求 `NODE_ENV=production`、`DATA_MODE=mysql` 和完整的 `MYSQL_*`
环境变量。先执行并核对全部迁移，再从仓库根目录运行普通初始化：

```bash
export APP_VERSION=<当前发布版本或提交 SHA>
npm run admin:bootstrap -- \
  --uid u_20260727_admin \
  --confirm BOOTSTRAP_SUPER_ADMIN:u_20260727_admin
```

确认文本必须逐字包含同一个 UID。凭据、Token 和 SQL 只能通过获批的环境或密钥注入，不得作为该命令的
参数；CLI 会拒绝相应参数，也不会输出数据库配置。`npm run admin:bootstrap -- --help` 只显示帮助，不会
连接 MySQL。

CLI 获取与迁移和 seed 共用、按数据库名隔离的 advisory lock，然后在锁内对照
`database/migrations/` 与 `schema_migrations` 的完整文件名和 SHA-256；缺失、额外或校验和不一致都会在
创建业务 store 前失败。校验通过后才调用 bootstrap 服务；服务自身仍在事务内锁定规范的最高管理员
角色行，再读取或写入分配。无论成功或失败，CLI 都会关闭 store、释放 advisory lock 并关闭连接池。

恢复模式只用于经批准的事故恢复窗口，例如有效最高管理员已经全部丢失。恢复前先备份并确认迁移历史，
使用独立的恢复确认文本：

```bash
npm run admin:bootstrap -- \
  --uid u_20260727_recovery \
  --recovery \
  --confirm RECOVER_SUPER_ADMIN:u_20260727_recovery
```

恢复模式会核对并修复内建治理定义，并写入恢复审计事件；它不是绕过迁移校验、数据库锁或 UID 重复分配
保护的通道。完成后应立即验证登录和审计记录，并按事故流程决定是否撤销临时恢复账号。

## 常规业务管理

拥有 `platform.super_admin` 的用户应通过：

```text
/development/admin
```

完成以下操作：

- 启用或停用模块；
- 授予、查看和撤销角色；
- 授予、查看和撤销带作用域的 Tag；
- 查看审计日志。

页面操作会经过 API 权限校验，并为写操作创建审计记录。前端隐藏按钮只负责展示，服务端 403 才是
最终权限边界。代表队队长 Tag 必须绑定具体 `sports_team` 作用域；不要用 `*` 绕过作用域。

未经变更审批，不要用 SQL 直接修改角色、Tag、模块或业务记录。直接修改会跳过接口验证、事务语义
和业务审计。数据库账号也不应交给普通业务管理员。

## 备份

仓库脚本 `scripts/backup.sh` 是 MySQL 逻辑备份入口。执行前：

1. 确认目标目录不在仓库内，并由备份账号独占读写。
2. 只使用独立只读备份账号，通过受保护的 `backup.env` 注入凭据；不得复用应用或迁移账号。
3. 记录数据库名、应用 commit、迁移列表、UTC 时间和操作者。
4. 确认磁盘空间和保留策略。

从仓库根目录运行脚本，唯一参数是一个尚不存在的目标 `.sql` 路径。脚本拒绝覆盖已有文件，会在
目标目录旁生成临时文件，并只在 `mysqldump` 成功且非空后发布目标。不要把密码拼进命令；脚本会用
权限为 0600 的临时客户端配置传递环境中的密码：

```bash
sh scripts/backup.sh /srv/freebbs-backups/freebbs-development-<UTC时间>.sql
```

备份完成后至少执行：

```bash
sha256sum <备份文件> > <备份文件>.sha256
test -s <备份文件>
```

将备份和校验文件复制到加密、访问受控、与应用服务器故障域不同的位置。按学校数据管理要求确定
保留期限；本文不预设未确认的期限。

## 安全恢复

不要把备份直接覆盖到正在提供服务的生产库。建议流程：

1. 停止写入或进入维护窗口，并对当前库再做一次备份。
2. 校验备份 SHA-256、来源、时间点和对应的应用 commit。
3. 在隔离的临时数据库恢复。
4. 对照 `schema_migrations`，运行只读检查和当前版本 API 冒烟测试。
5. 获得业务与部署负责人确认后，再切换生产连接或在停机窗口恢复目标库。
6. 恢复后使用运行时账号启动，检查健康、权限、审计和代表队作用域隔离。

恢复时使用权限为 0600 的临时 MySQL 客户端选项文件，避免密码进入参数列表或 shell 历史。通用形式
如下；路径均需替换为经确认的安全路径：

```bash
mysql \
  --defaults-extra-file=/run/secrets/freebbs-restore-client.cnf \
  < /srv/freebbs-backups/freebbs-development-YYYYmmddTHHMMSSZ.sql
```

选项文件应包含 `[client]` 下的 `host`、`port`、`user` 和 `password`，恢复完成后安全删除。不要在
命令中使用 `--password=<明文>`。生产恢复所需的 `DROP`/`CREATE` 权限不应长期授给运行时或
迁移账号；由数据库管理员在审批窗口临时执行，并在完成后收回。

## 通过 SSH 隧道访问原始数据库

MySQL 不应暴露公网端口。经批准需要使用本机客户端排障时，从运维工作站建立仅绑定回环的隧道：

```bash
ssh -N \
  -L 127.0.0.1:13306:127.0.0.1:3306 \
  <ssh-user>@<server-host>
```

另一个终端用最小权限、只读排障账号连接：

```bash
mysql \
  --host=127.0.0.1 \
  --port=13306 \
  --user=<只读排障账号> \
  --database=free_bbs_development
```

如果 MySQL 实际在私网另一主机，把隧道右侧的 `127.0.0.1:3306` 替换为服务器可访问的精确私网
地址。完成后关闭 SSH 会话。不得共享隧道、导出全库到个人设备或将查询结果贴到公开渠道。

生产 systemd 拓扑不得使用 Compose 的 `adminer` profile，因为它会连带启动本地开发 MySQL 与迁移
服务。临时只读账号、独立回环容器、SSH 隧道和停止/撤权命令统一见
[生产发布与数据恢复检查清单](./production-release-checklist.md)。常规管理继续使用 Web 管理页。

## 定期核查

- 抽样验证备份可以在隔离库恢复，而不只是文件存在。
- 核对运行时账号没有 `CREATE`、`ALTER`、`DROP`、`GRANT OPTION`。
- 核对迁移账号没有远程公网来源，并在非迁移窗口禁用或妥善保管。
- 检查过期角色/Tag 和异常权限变更的审计记录。
- 检查数据库磁盘、连接数、慢查询和备份失败告警。
- 确认生产 `AUTH_MODE=main`，且没有演示 UID 或 `X-Demo-User` 运维流程。

## 故障处理

### `MYSQL_* is required when DATA_MODE=mysql`

缺少必填变量。检查 systemd 环境文件、Compose 环境注入或当前 shell；不要用空密码临时绕过。

### `Migration checksum mismatch`

已部署迁移文件被改动。恢复仓库中已发布版本的原文件，审查差异，再以新编号创建后续迁移。不要
直接改 `schema_migrations.checksum`。

### `Access denied`

先确认当前步骤使用的是运行时账号还是迁移账号，再检查 MySQL 账号的 host 限制。不要直接授予
`ALL PRIVILEGES`；只补充当前步骤确实需要且已经审批的权限。

### 恢复后 API 仍失败

核对数据库字符集/排序规则、全部迁移记录、应用版本和 `databaseMode`。用 API 的
`X-Request-Id` 关联日志，但不要记录原始 Token 或数据库密码。

## 当前生产数据职责（2026-07）

生产账号严格拆为 `freebbs_development_app`、`freebbs_development_migration` 和 `freebbs_development_backup`，凭据不得复用。定时备份、SHA-256、encrypted off-host copy、restore drill、恢复确认和 Adminer 隧道的逐条命令见[生产发布与数据恢复检查清单](./production-release-checklist.md)。迁移是 forward-only；应用回滚前必须确认旧 commit 与当前 schema 兼容，不能把反向删表当作常规回滚。
