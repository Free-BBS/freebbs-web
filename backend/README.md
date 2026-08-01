# Backend

启动认证后端：

```bash
npm install
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

以上工作台接口均从 Bearer Token 解析用户身份，不接受客户端传入的 `user_id`。

也可以在仓库根目录直接生成一次可复核的连接器证据：

```bash
npm run probe:public-source
```

该命令会访问 `learn.tsinghua.edu.cn`、`info.tsinghua.edu.cn` 的登录边界以及固定的
公开通知样例页。它不是统一身份认证实现，也不会绕过登录；生产同步必须改用校方批准的
SSO / API 流程。FREE BBS 不应收集同学的清华密码；授权令牌仅应由服务端加密保存、
设置短有效期，并支持用户主动解绑和撤销。

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
