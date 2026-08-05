# 清华连接器授权 Broker

本模块为网络学堂私有数据同步提供按 FREE BBS 用户隔离的授权、加密会话和同步状态机。
生产部署默认关闭；管理员可以显式启用 `direct_cas` 兼容模式。

`direct_cas` 不是清华为 FREE BBS 注册的 OAuth，也不是校方批准的 CAS service callback。
用户明确同意后，浏览器才会为本次提交生成一次性的 32 位十六进制兼容
`fingerPrint`。`username`、`password` 和 `fingerprint` 只在本次 HTTPS 登录请求中短暂
经过 FREE BBS 后端（显式 development/test 的 loopback 环境允许 HTTP），由后端向清华统一
身份认证提交。三者不会写入数据库、文件、日志、响应或浏览器存储；登录成功后，认证敏感
材料中仅持久化按域隔离、使用独立密钥 AES-256-GCM 加密的网络学堂会话凭据。

## 当前交付边界

- 已实现：直接 CAS 登录、SM2 密码提交、固定域名白名单、Cookie 域/路径隔离、网络学堂
  私有学期接口验真，以及课程、公告、作业同步到通知和重要事项。
- 已实现：按用户隔离的连接状态、AES-256-GCM 凭据保险箱、归一化登录名 HMAC 绑定、
  解绑、generation fencing、同步任务 single-flight 和工作台连接 UI。
- 已实现但只服务于后续正式接入：一次性授权 state、同浏览器关联 Cookie、原子消费、
  防重放和固定站内 callback。当前仓库没有可用的校方 official adapter，不能把这套框架
  描述为已接通官方 OAuth/CAS callback。
- 已自动验证：固定夹具下的 CAS 表单解析、加密提交、域名与重定向限制、Cookie 隔离、
  私有接口验真、跨用户隔离、过期与重放失败、密文篡改失败和建表 SQL 合同。
- 尚未完成：真实清华账号验收、验证码或二次验证交互、校方 official adapter、
  `info.tsinghua.edu.cn` 私有数据解析，以及独立后台 Worker。

自动测试不能证明真实账号当前可用。真实账号验收必须由用户在自己的本地环境中完成，不应把
账号或密码发送给开发者、写入 issue、提交到 Git 或放入环境变量。

## 安全模型

1. `POST /direct-login` 只在 `direct_cas` 显式启用后可用，并要求有效的 FREE BBS 登录、
   `application/json`、明确同意凭据说明、严格字段校验和 4 KiB 请求体上限。浏览器只在用户
   提交后生成一次性 `fingerPrint`，生成失败时不会发送账号和密码。
2. 登录名、密码和 `fingerPrint` 只用于当前请求。前后端在请求完成后清空持有它们的表单和
   变量；服务端不持久化、不记录日志，也不会把它们、清华 Cookie、Authorization 或上游页面
   返回给浏览器。
3. 上游请求只允许访问受控的清华 HTTPS 域名和路径，并手动处理重定向与 Cookie；不会接受
   浏览器提供的目标 URL，也不会把 Learn Cookie 发送到其他域名。
4. 只有在私有网络学堂学期接口验证登录态后才会建立连接。持久化内容仅为受限的 Learn Cookie
   jar，不保存 CAS 密码或原始页面。
   broker 强制要求 grant 具有不超过 8 小时的服务端过期时间；持久 Cookie 更早过期时取更早值，
   session-only Cookie 也必须随 grant 到期。
5. Learn Cookie grant 使用独立密钥 AES-256-GCM 加密；AAD 绑定 FREE BBS 用户、连接器和
   adapter 版本。当前 subject 是 `username.toLowerCase()` 形式的归一化登录名，不是清华提供
   的 canonical subject、官方学号或权威身份标识；相应 HMAC 只用于 FREE BBS 内部绑定，不能
   对外宣称完成了校方 canonical identity 校验。
6. redirect 模式另行使用 256-bit 随机 state 和 `HttpOnly`、`SameSite=Lax`、callback Path
   限定的浏览器关联 Cookie；数据库只保存 `SHA-256(state)`，过期、使用或失败后均不能重放。
   这套机制不适用于 `direct_cas` 的账号密码提交。
7. 解绑会先销毁本地密文并增加 generation；旧同步任务不能继续落库。远端撤销仅在 adapter
   ID 与版本一致时尽力执行。
8. 同一归一化登录名的内部 HMAC 不能绑定多个 FREE BBS 用户；事务锁定现有绑定并以
   `409` 拒绝冲突，不会通过通用 upsert 覆盖其他用户的连接记录。此约束不是清华官方身份
   去重，也不能发现不同登录别名是否属于同一自然人。
9. callback 永远 `303` 回固定 `/workbench`，不接受 open redirect，也不把 ticket、code 或
   上游错误详情带回前端。
10. 直连登录当前使用单个 Node 进程内的滑动窗口：每个 FREE BBS 用户 5 次/15 分钟、每个
    来源 IP 50 次/15 分钟。它不是多实例共享限流；生产横向扩容前必须接入 Redis 等共享存储，
    并正确配置可信代理后的客户端 IP。

## HTTP 接口

统一前缀：`/api/workbench/connectors/tsinghua`

- `GET /status`：返回当前用户的安全连接状态、授权方式和最近同步摘要。
- `POST /direct-login`：`direct_cas` 专用。请求体只能是
  `{ "username": "...", "password": "...", "fingerprint": "32-hex", "consent": true }`；
  `fingerprint` 由浏览器在用户提交后为本次认证生成。成功返回 `201`，响应不包含登录名、
  密码、指纹、Cookie 或上游目标地址。
- `POST /authorization-attempts`：只供 redirect adapter 创建一次性授权会话；请求体必须
  为空。在 `direct_cas` 下不会启动跳转授权。
- `GET /callback`：redirect adapter 的公开回调，使用 state 与同浏览器关联 Cookie 找回发起
  用户并原子消费。当前没有已注册的 official adapter。
- `DELETE /connection`：解除当前用户的连接；请求体必须为空。
- `POST /sync-runs`：创建同步任务；请求体必须为空。
- `GET /sync-runs/:publicId`：只允许任务所属用户查看安全状态和计数。

所有 JSON 接口均返回 `Cache-Control: no-store`。未配置时授权接口返回
`503 tsinghua_authorization_not_configured`；配置不完整时返回
`503 tsinghua_authorization_misconfigured`。安全错误不会转发上游页面或敏感响应。

## 环境变量

仓库默认必须保持关闭。启用本地 `direct_cas` 的示例：

```dotenv
PUBLIC_WEB_URL=http://127.0.0.1:3000
CORS_ORIGIN=http://127.0.0.1:3000
TSINGHUA_CONNECTOR_MODE=direct_cas
TSINGHUA_CONNECTOR_ADAPTER_ID=tsinghua_direct_cas
TSINGHUA_CONNECTOR_CALLBACK_URL=
TSINGHUA_CONNECTOR_ENCRYPTION_KEY=replace-with-32-random-bytes-in-base64
TSINGHUA_CONNECTOR_WORKER_SOCKET=
TSINGHUA_CONNECTOR_STATE_TTL_SECONDS=600
TSINGHUA_CONNECTOR_SYNC_INTERVAL_SECONDS=300
```

- `MODE` 可为 `disabled`、`direct_cas`、`official`、`development_mock`；缺省为 `disabled`。
- `direct_cas` 必须使用有效的内建 adapter ID `tsinghua_direct_cas` 和独立 32-byte
  加密密钥；不需要 callback URL 或 Worker socket。缺任一必需项都会 fail closed。
- `official` 还要求批准的 callback 和绝对 Worker socket，但当前仓库没有注册可用的
  official adapter，因此不能据此声称已经接通校方正式授权。
- `ADAPTER_ID` 只接受最多 32 字符的小写字母、数字、下划线和连字符，且必须以字母开头。
- `ENCRYPTION_KEY` 接受 64 位十六进制、标准或无 padding Base64，也可使用 `base64:` 前缀。
- production 只接受 HTTPS callback；development/test 仅额外接受 loopback HTTP。
- `PUBLIC_WEB_URL` 必须等于浏览器实际访问的前端 Origin；生产环境强制 HTTPS，仅
  `NODE_ENV=development/test` 且主机为 `localhost`、`127.0.0.1` 或 `::1` 时允许 HTTP。
  开发环境的 3000→3001 请求只对这个精确 Origin 允许关联 Cookie；`CORS_ORIGIN` 建议保持一致。
- `development_mock` 只能用于测试，不是真实清华抓取证据。

生成独立密钥示例：

```bash
openssl rand -base64 32
```

不得复用 `AUTH_SECRET`、`SETTINGS_ENCRYPTION_KEY`、清华密码或 Cookie。

## 数据库

迁移：`database/migrations/020_create_campus_connector_runtime.sql`

- `user_campus_connectors`：用户连接、加密 Learn Cookie grant、generation 与最近同步状态。
- `campus_connector_auth_flows`：redirect 模式的一次性 state 摘要、短期 flow secret 和消费状态。
- `campus_connector_sync_runs`：任务、lease、fencing generation、安全计数与哈希证据。

授权 flow 与同步 run 都使用生成的 nullable `active_slot` 唯一索引，从数据库层而非单个
Node 进程内存保证同一用户或连接只有一个活动实例。

## 本地验证

先运行不使用真实账号的自动检查：

```bash
npm run test:tsinghua-connectors
npm run probe:public-source
```

这些检查只能证明解析、安全限制和公开认证边界，不能替代真实账号验收。真实验收步骤：

1. 完成数据库迁移，按上文设置 `direct_cas` 和独立加密密钥。推荐从仓库根目录运行
   `npm run start:local`，它会加载 `backend/.env` 并启动前后端；`npm run start:backend`
   不会自动加载 `backend/.env`，单独启动时须先显式导出变量。
2. 先登录自己的 FREE BBS 测试账号，然后访问 `/workbench`。
3. 打开“连接清华账号”对话框，在本机输入自己的清华账号和密码，阅读说明并主动勾选同意。
   提交时页面才生成本次 `fingerPrint`；不要把账号、密码或指纹发给开发者或写入配置文件。
4. 连接成功只表示后端已通过网络学堂私有学期接口验证该会话；如清华要求验证码、二次验证或
   改变登录表单，连接会安全失败，当前版本不会绕过这些要求。
5. 发起同步，确认工作台出现该账号的课程、公告、作业以及由未交作业生成的重要事项；解绑后
   再次同步应被拒绝。以上结果才可作为当前环境的真实账号验收证据。

当前 `info.tsinghua.edu.cn` 只支持公开认证边界探测，不会读取信息门户私有通知、个人数据或
时间表；不得把 Learn 同步成功描述为 Info 同步成功。
