# Backend

推荐从仓库根目录启动本地前后端：

```bash
npm install
npm run start:local
```

`start:local` 会加载 `backend/.env`。`npm run start:backend` 只是直接执行
`node backend/server.js`，不会自动加载该文件；若需要单独启动后端，必须先在当前 shell 中
显式导出环境变量：

```bash
set -a
source backend/.env
set +a
npm run start:backend
```

默认监听：

- API: `http://127.0.0.1:3001`

可用环境变量：

- `API_HOST`
- `API_PORT`
- `BACKEND_IP`：MySQL 服务器 IP。若未设置，自动回退为本机 IPv4 地址
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `AUTH_SECRET`
- `AGENT_URL`：freebbs-agent 服务地址，默认 `http://127.0.0.1:5001`
- `AGENT_SERVICE_TOKEN`：agent 读取系统设置时使用的服务令牌，至少 32 个字符
- `AGENT_SETTINGS_REQUIRED`：设为 `true` 时要求内部设置 API 必须就绪；令牌缺失或
  API 失效会导致启动失败或健康检查返回 `503`。默认 `false`，仅供本地显式可选模式
- `AGENT_SETTINGS_SOCKET`：仅供同机 agent 使用的 Unix Socket，生产建议
  `/run/free-bbs/agent-config.sock`
- `SETTINGS_ENCRYPTION_KEY`：用于 AES-256-GCM 加密模型 API key 的 32 字节 Base64
  或 64 位十六进制密钥
- `LLM_BASE_URL`、`LLM_MODEL`：数据库尚未配置时使用的模型默认值；默认与 Agent
  的静态开发配置一致，分别为 `https://cloud.infini-ai.com/maas/v1` 和 `glm-5.1`
- `COURSE_MATERIALS_ALLOWED_ROOT`：管理员可选择的课程资料目录上界
- `COURSE_MATERIALS_ROOT`：数据库尚未配置时使用的课程资料默认目录
- `BOTMAIL_SMTP`
- `BOTMAIL_SMTP_PORT`
- `BOTMAIL_USER`
- `BOTMAIL_FROM`
- `BOTMAIL_PASS`

主要接口：

- `GET /api/health`
- `POST /api/auth/send-email-code`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/workbench/summary`：返回当前用户的重要事项、可见通知和本周已确认日程
- `GET|POST /api/workbench/important-items`
- `PATCH|DELETE /api/workbench/important-items/:publicId`
- `GET|POST /api/workbench/schedule-items`
- `PATCH|DELETE /api/workbench/schedule-items/:publicId`
- `GET /api/workbench/schedule-items/conflicts`
- `POST /api/workbench/schedule-items/:publicId/confirm`：只有用户确认后才将草稿转为日程
- `GET /api/workbench/notifications`
- `PATCH /api/workbench/notifications/:publicId/state`
- `POST /api/workbench/notifications`：仅管理员可发布；外部同步后续使用独立受控入口
- `GET /api/workbench/connectors/primary-portals/probe`：只读探测网络学堂与信息门户的
  连通性和统一认证边界；固定白名单，不发送凭据、不跟随登录跳转、不保留响应 Cookie
- `GET /api/workbench/connectors/public-notices/probe`：抓取固定的清华公开通知样例页，
  返回状态码、响应哈希、解析版本和条目摘要，供开发阶段验证解析链路
- `GET /api/workbench/connectors/tsinghua-learn/capabilities`：返回网络学堂连接器核心的
  解析版本、固定接口范围和安全上限；该接口只说明能力状态，不代表已经取得用户私有数据
- `GET /api/workbench/connectors/tsinghua/status`：返回当前用户的连接方式、连接状态和同步证据
- `POST /api/workbench/connectors/tsinghua/direct-login`：仅在管理员显式启用 `direct_cas`
  后可用；请求体只接受账号、密码、明确同意和浏览器在同意后生成的 32 位十六进制
  `fingerprint`。登录名、密码和指纹仅用于本次认证请求，不持久化、不写日志、不在响应中回显
- `POST /api/workbench/connectors/tsinghua/sync-runs`：使用服务端加密会话创建网络学堂同步任务
- `DELETE /api/workbench/connectors/tsinghua/connection`：销毁当前用户的加密会话并停止后续同步

以上工作台接口均从 Bearer Token 解析用户身份，不接受客户端传入的 `user_id`。

也可以在仓库根目录直接生成一次可复核的连接器证据：

```bash
npm run probe:public-source
```

该命令会访问 `learn.tsinghua.edu.cn`、`info.tsinghua.edu.cn` 的登录边界以及固定的
公开通知样例页。它本身不登录、不发送凭据，也不能作为真实账号同步证据。私有网络学堂
同步可由管理员显式启用 `direct_cas` 兼容模式：账号本人明确同意后，浏览器才生成
与清华当前登录页面兼容的一次性 32 位十六进制 `fingerPrint`。登录名、密码和该指纹只在本次
请求中短暂经过后端并立即提交统一身份认证，不持久化、不写日志。只有通过私有接口验真的
Learn 会话凭据会按用户隔离并使用 AES-256-GCM 加密保存；服务端强制设置最长 8 小时有效期，
若持久 Cookie 更早过期则取更早时间。该模式不是校方为 FREE BBS 注册的 official callback。
验证码或二次认证挑战会安全失败并停止登录，不会尝试绕过；信息门户私有数据同步仍未实现。

生产环境的 `PUBLIC_WEB_URL` 强制使用 HTTPS；只有 `NODE_ENV=development/test` 且使用 loopback 主机
时允许 HTTP。直连登录限流目前保存在单个 Node 进程内：每用户 5 次/15 分钟、每 IP 50 次/
15 分钟；生产多实例必须使用共享限流器。连接器当前使用归一化登录名作为 subject，它不是
清华官方 canonical subject 或经核验学号，不应把内部 HMAC 绑定描述为校方身份认证结论。
网络学堂抓取核心位于 `backend/tsinghua-learn-connector.js`。它只接受服务端注入的
`authorizedFetch`，并只允许固定的 HTTPS 主机与课程、公告、作业接口；重定向、响应体、
请求总量、课程数、并发数和请求间隔均受限。未启用时工作台明确显示“尚未配置”；直接模式
不会接收浏览器提供的清华 Cookie、自定义目标 URL 或自报 `user_id`，也不会伪造私有数据。

连接器契约与安全边界可单独回归：

```bash
npm run test:tsinghua-connectors
```

完整状态、证据口径和真实统一认证接入条件见 [清华校内连接器说明](../docs/tsinghua-connectors.md)。

- `GET|PATCH /api/admin/system-settings/model`：管理员可查看状态并替换 API key；
  Base URL 和模型名只由部署环境管理，避免把已保存密钥转发到任意地址
- `DELETE /api/admin/system-settings/model/api-key`
- `GET|PATCH /api/admin/system-settings/course-materials`

同机 agent 通过 Unix Socket 请求：

```text
GET /internal/v1/agent-config
Authorization: Bearer <AGENT_SERVICE_TOKEN>
```

该接口返回模型 API key、Base URL、模型名、课程资料根目录和配置版本，并强制使用
`Cache-Control: no-store`。它不会注册到公开 API 端口。生产部署使用独立的 backend /
agent 系统用户与 `freebbs-agent-config` 共享组，socket 权限为 `0660`；前端服务用户不在
该组，也不读取后端环境文件。
