# RAG 课程数据生产部署操作手册

本文说明如何把 `freebbs-web` MySQL 中的课程知识点持续同步到 `freebbs-agent`，并让知识点页面和“问问 Max”共同使用同一份 RAG 索引。

## 上线结果

上线后链路如下：

```text
课程负责人在网站保存知识点
  -> Web 在同一业务写入后递增 rag_index_state.requested_revision
  -> systemd timer 每 30 秒运行一次索引器
  -> 索引器通过本机 Unix Socket 获取一致性课程快照
  -> 构建并校验新的版本化 FAISS 索引
  -> 原子切换 current.json
  -> 运行中的 Agent 在最多 5 秒内热加载新版本
```

连续多次 MySQL 更新会合并到下一次索引构建。构建失败时旧索引继续提供服务。课程资料更新不需要人工复制文件，也不需要让 Agent 直接连接 MySQL。

## 前提和发布顺序

服务器默认路径为：

- Web：`/data/www/free-BBS`
- Agent：`/data/www/freebbs-agent`
- Web 环境：`/etc/free-bbs/free-bbs.env`
- Agent 环境：`/etc/free-bbs/freebbs-agent.env`
- 内部 Socket：`/run/free-bbs/agent-config.sock`
- 持久 RAG 数据：`/data/free-bbs/courses`

必须按以下顺序发布：

1. 合并并部署 Web 改动。
2. 执行 Web 数据库迁移 `024_add_rag_index_revision.sql`。
3. 配置并重启 Web 后端，确认内部 Socket 可用。
4. 合并并部署 Agent 改动及 Python 依赖。
5. 手工完成第一次索引同步和预检。
6. 启用 RAG Agent 与定时器。

不要先启用定时器再迁移数据库，否则课程快照接口还没有 revision 表。

## 1. 配置 Web 后端

在 `/etc/free-bbs/free-bbs.env` 保留现有数据库、认证和模型设置，并确认以下变量存在：

```dotenv
NODE_ENV=production
AGENT_URL=http://127.0.0.1:5001
AGENT_SERVICE_TOKEN=<至少32字符的随机共享令牌>
AGENT_SETTINGS_REQUIRED=true
AGENT_SETTINGS_SOCKET=/run/free-bbs/agent-config.sock
SETTINGS_ENCRYPTION_KEY=<32字节Base64或64位十六进制密钥>
COURSE_MATERIALS_ALLOWED_ROOT=/data/free-bbs/courses
COURSE_MATERIALS_ROOT=/data/free-bbs/courses
```

首次部署时可分别生成令牌和加密密钥：

```bash
openssl rand -base64 48
openssl rand -base64 32
```

不要复用 `AUTH_SECRET`、用户密码或其它服务密钥，也不要把真实值写入 Git、PR 或日志。

## 2. 执行 MySQL 迁移

推荐在 GitHub Actions 中手动运行 `db-migrate.yml`，输入 `RUN`。也可以在服务器 Web 目录执行：

```bash
cd /data/www/free-BBS
set -a
. /etc/free-bbs/free-bbs.env
set +a
bash scripts/migrate.sh
```

验证迁移：

```bash
mysql -h "$BACKEND_IP" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p "$MYSQL_DATABASE" \
  -e "SELECT requested_revision, requested_at FROM rag_index_state WHERE id = 1;"
```

迁移只创建状态表，不创建 MySQL trigger，因此数据库账号不需要 `TRIGGER` 或 `SUPER` 权限。revision 由 Web 的课程地图写接口在业务更新成功后递增。

## 3. 准备持久目录和 embedding 模型

```bash
sudo mkdir -p /data/free-bbs/courses/data/rag
sudo chown -R freebbs-agent:freebbs-agent-config /data/free-bbs/courses
sudo chmod 750 /data/free-bbs/courses

cd /data/www/freebbs-agent
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/prepare_local_embedding_model.py \
  --model-id BAAI/bge-small-zh-v1.5 \
  --output-dir data/models/bge-small-zh-v1.5 \
  --source auto
```

如果模型已经由制品或受控备份部署，可以跳过下载，但必须确认 `freebbs-agent` 用户能读取模型目录。

## 4. 配置 Agent

`/etc/free-bbs/freebbs-agent.env` 至少包含：

```dotenv
AGENT_HOST=127.0.0.1
AGENT_PORT=5001
AGENT_SETTINGS_SOCKET=/run/free-bbs/agent-config.sock
AGENT_SERVICE_TOKEN=<与Web完全相同的共享令牌>
COURSE_MATERIALS_ROOT=/data/free-bbs/courses
FREEBBS_WEB_BASE_URL=https://www.free-bbs.cn

RAG_ENABLED=true
RAG_INDEX_PATH=/data/www/freebbs-agent/data/rag/index.faiss
RAG_METADATA_PATH=/data/www/freebbs-agent/data/rag/metadata.jsonl
RAG_INDEX_MANIFEST_PATH=data/rag/current.json
RAG_INDEX_RELOAD_INTERVAL_SECONDS=5
RAG_SYNC_TIMEOUT_SECONDS=30
RAG_VERSION_RETENTION=3
RAG_TOP_K=5
RAG_MAX_CONTEXT_CHUNKS=4
RAG_EMBEDDING_PROVIDER=local
RAG_LOCAL_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5
RAG_LOCAL_EMBEDDING_DIM=512
RAG_LOCAL_MODEL_DIR=data/models/bge-small-zh-v1.5
RAG_LOCAL_FILES_ONLY=true
```

生产环境通常无需设置 `RAG_COURSE_SNAPSHOT_SOCKET` 和 `RAG_COURSE_SNAPSHOT_TOKEN`；它们默认复用 `AGENT_SETTINGS_SOCKET` 和 `AGENT_SERVICE_TOKEN`。只有希望把模型设置 Socket 与课程快照 Socket 分开时才单独配置。

设置权限：

```bash
sudo chown deploy:freebbs-agent /etc/free-bbs/freebbs-agent.env
sudo chmod 640 /etc/free-bbs/freebbs-agent.env
```

## 5. 安装服务并首次构建

先安装或更新三个 Agent unit：

```bash
cd /data/www/freebbs-agent
sudo cp deploy/systemd/free-bbs-agent.service /etc/systemd/system/
sudo cp deploy/systemd/free-bbs-rag-indexer.service /etc/systemd/system/
sudo cp deploy/systemd/free-bbs-rag-indexer.timer /etc/systemd/system/
sudo systemctl daemon-reload
```

先重启 Web 后端并检查 Socket，再执行首次索引：

```bash
sudo systemctl restart free-bbs-backend
sudo systemctl --no-pager --full status free-bbs-backend
sudo test -S /run/free-bbs/agent-config.sock

sudo systemctl start free-bbs-rag-indexer.service
sudo journalctl -u free-bbs-rag-indexer.service -n 100 --no-pager
```

索引器会在切换 manifest 前重新加载新索引完成完整性校验。索引成功后启动 Agent 和 timer：

```bash
sudo systemctl enable --now free-bbs-agent
sudo systemctl enable --now free-bbs-rag-indexer.timer
```

## 6. 验收

```bash
curl --fail http://127.0.0.1:3001/api/health
curl --fail http://127.0.0.1:5001/health
systemctl list-timers --all | grep free-bbs-rag-indexer
sudo systemctl --no-pager --full status free-bbs-rag-indexer.timer
sudo journalctl -u free-bbs-rag-indexer.service -n 100 --no-pager
```

Agent 健康响应必须满足：

```json
{ "status": "ok", "rag": { "enabled": true, "ready": true } }
```

浏览器验收：

1. 登录网站并打开一个课程知识点，在右侧交互区提问，确认能得到 RAG 回答。
2. 打开 `/aichat`，询问“请结合课程资料解释傅里叶变换”，确认回答下方显示“RAG · 已检索课程资料”和来源链接。
3. 用课程负责人账号给某知识点加入唯一测试句并保存。
4. 等待约 30 秒，确认 indexer 日志出现新的 revision 和版本号。
5. 再次提问唯一测试句，确认新内容可被检索。

## 7. 日常运行与故障处理

- MySQL 内容更新后无需人工操作；timer 最多约 30 秒开始同步，Agent 随后最多约 5 秒热加载。
- revision 未变化时索引器会输出 `already current`，不会重复计算 embedding。
- 构建中的文件位于新版本目录；只有完整保存并重新加载校验成功后才切换 manifest。
- 默认保留 3 个版本。构建失败或快照暂时不可用时，线上 Agent 继续使用原版本。
- `401/403`：检查两个环境文件中的共享 Token 是否完全一致，以及 Socket 用户组和 `0660` 权限。
- `RAG disabled`：检查 Agent 进程实际读取的环境文件中是否为 `RAG_ENABLED=true`。
- `rag.ready=false`：先查看 indexer 日志，再确认 `/data/free-bbs/courses/data/rag/current.json` 和其指向的文件可读。
- embedding 模型报错：检查 `RAG_LOCAL_MODEL_DIR`、`RAG_LOCAL_FILES_ONLY` 和目录权限。

紧急情况下可停止自动同步而不影响当前索引服务：

```bash
sudo systemctl disable --now free-bbs-rag-indexer.timer
```

修复后手工执行一次 indexer，验证成功再重新启用 timer。不要删除当前 manifest 或活动版本目录。
