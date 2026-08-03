# 清华校内连接器：实现状态与验证方法

## 当前结论

截至 2026 年 8 月 2 日，FREE BBS 已具备以下能力：

| 能力                                 | 状态                   | 可复核证据                                                              |
| ------------------------------------ | ---------------------- | ----------------------------------------------------------------------- |
| 清华公开通知页抓取与解析             | 已实时验证             | 固定公开 URL 的 HTTP 状态、响应字节数、SHA-256、解析版本和通知摘要      |
| `learn.tsinghua.edu.cn` 认证边界探测 | 已实时验证             | 无凭据请求登录入口，记录认证边界且不跟随跳转                            |
| `info.tsinghua.edu.cn` 认证边界探测  | 已实时验证             | 无凭据请求首页，记录认证边界且不跟随跳转                                |
| `direct_cas` 兼容登录链路            | 已实现，固定夹具已验证 | 明示同意、一次性 `fingerPrint`、SM2 提交、Cookie 隔离和私有学期接口验真 |
| 网络学堂课程、公告和三类作业同步     | 已实现，固定夹具已验证 | 连接器、授权 fetch、规范化快照和工作台写入测试                          |
| 网络学堂真实账号同步                 | 尚未验收               | 必须由用户在自己的本地环境中明确授权并完成账号级核对                    |
| 校方 official 回调                   | 尚未实现               | 当前没有校方分配并注册的 official adapter                               |
| 信息门户私有数据同步                 | 尚未实现               | 当前只有无凭据认证边界探测                                              |

“代码和固定夹具已验证”不等于“真实清华账号已经可用”，也不等于“已获得校方正式
OAuth/CAS callback”。工作台必须分别显示连接模式、真实同步状态和 Info 功能边界。

## 一分钟复核

要求 Node.js 版本满足仓库 `package.json` 中的约束，并已安装依赖。

### 1. 运行安全边界和解析合同测试

```bash
npm run test:tsinghua-connectors
```

自动测试使用本地固定响应，不访问个人账号，验证：

- direct CAS 表单解析、SM2 密码提交、登录失败和二次验证降级；
- 显式同意后生成的 32 位十六进制浏览器设备指纹只用于本次请求，不持久化或回显；
- 上游主机、协议、路径、重定向、请求预算、响应大小和频率限制；
- Cookie 的 host、domain、path、`Secure` 和 expiry 隔离；
- 登录名、原始密码和一次性 `fingerPrint` 不写入持久层、日志、响应或加密 grant；
- 登录成功后只把受限 Learn Cookie jar 交给按用户隔离的 AES-256-GCM 凭据保险箱；
- 课程、公告和未交/已交/已批作业解析，以及重要事项草稿生成；
- 上游结构变化、超时、429、会话失效和部分失败不会伪装成空数据成功。

这些测试只能证明代码合同，不能证明真实账号当前可登录。

### 2. 运行真实联网的无凭据探测

```bash
npm run probe:public-source
```

正常输出应同时包含：

- `publicSource.network` 为 `live`，并带有状态码、`contentSha256` 和解析条目；
- `portals[*].network` 为 `live`；
- Learn 和 Info 当前返回的认证边界分类；
- `credentialsSent: false`、`cookiesSent: false`、`redirectFollowed: false`。

这条命令只访问固定白名单地址，不登录清华，不抓取个人数据。这里的“不发送凭据或 Cookie”
只描述公开探测命令，不描述用户主动启用的 `direct_cas` 登录。

### 3. 在页面中查看

本地推荐从仓库根目录运行 `npm run start:local`，它会加载 `backend/.env` 并同时
启动前后端。`npm run start:backend` 不会自动加载 `backend/.env`；若单独运行，须先在当前
shell 显式导出该文件中的变量。登录 FREE BBS 后访问：

```text
http://127.0.0.1:3000/workbench
```

- “校内连接器证据自检”只运行公开样本和无凭据认证边界探测，不发送账号、密码或 Cookie；
- “连接清华账号”根据部署模式显示 disabled、direct CAS、official 或 development mock 状态；
- direct CAS 只有在服务端声明“不持久化密码、不接收清华 Cookie、会话 Cookie 加密保存”
  等 safeguards 后才允许打开登录流程；
- Info 私有数据仍应显示“尚未实现”，不能用 Learn 同步结果代替。

## 两种授权模式

### direct CAS 兼容模式

`direct_cas` 不是校方为 FREE BBS 注册的正式 OAuth/CAS callback，且默认关闭。管理员显式启用
后，流程为：

1. 已登录 FREE BBS 的用户阅读安全说明并主动勾选同意；
2. 用户明确同意后，浏览器为本次登录生成与清华当前页面兼容的 32 位十六进制设备指纹；
   该值只用于本次认证的 fingerPrint 字段，不持久化、不在 API 响应或页面状态中回显。生成或
   格式校验失败时，流程安全停止，不提交账号和密码；
3. 浏览器只向固定 `/direct-login` 接口提交 `{ username, password, fingerprint, consent: true }`；
   FREE BBS 的 Bearer Token 只用于识别当前用户，接口不接收清华 Cookie、上游
   Authorization、自定义 URL 或客户端自报 user ID；
4. 登录名、密码和 `fingerPrint` 只用于本次统一身份认证请求，不写入数据库、文件、日志、
   响应或浏览器存储；前端在发出请求后清空密码输入框，并在请求结束后清空指纹变量；
5. 后端只访问受控清华 HTTPS 域名，手动处理重定向和按域、路径隔离的 Cookie；
6. 只有私有网络学堂学期接口验真成功后才建立连接；
7. 持久化内容仅为按用户隔离、使用独立密钥 AES-256-GCM 加密的 Learn Cookie jar；
8. 同步器解密授权 grant，生成规范化课程、通知、作业和重要事项草稿，随后清除明文引用。
   每个 direct grant 都有服务端强制的 8 小时有效期上限；如果有效持久 Cookie 更早过期，则以
   更早的 Cookie 过期时间为准。session-only Cookie 也不会产生无期限 grant。

生产环境的 `PUBLIC_WEB_URL` 强制使用 HTTPS；只有 `NODE_ENV=development/test` 且地址是本机
loopback 时允许 HTTP。真实账号验收必须由账号本人完成，不得把登录名、密码或指纹提交到
Git、issue 或发给开发者。验证码、二次验证或清华登录结构变化会安全失败，当前版本不会绕过
这些要求。

直连登录限流当前只存在于单个 Node 进程：每个 FREE BBS 用户 5 次/15 分钟、每个来源 IP
50 次/15 分钟。多实例生产部署必须使用共享限流存储。当前 subject 只是
`username.toLowerCase()` 形式的归一化登录名，不是清华官方 canonical subject 或已核验学号；
内部 HMAC 绑定也不能作为官方身份结论。

### official 正式授权模式

正式模式仍缺少校方分配并注册的 adapter、callback 和受批准的会话交换方式。该模式的目标是：

1. FREE BBS 只创建一次性、短有效期、绑定当前用户和浏览器的 state；
2. 浏览器跳转到校方统一身份认证页面，FREE BBS 不接收清华密码或浏览器 Cookie；
3. 校方回调后，服务端原子消费 state，并加密保存 adapter 返回的 opaque grant；
4. callback 固定返回 `/workbench`，不把 ticket、code 或上游错误带回前端。

没有 registered official adapter 时，页面显示“尚未配置”或“配置异常”是正确行为，不能构造
看似真实的授权 URL。

## 网络学堂解析核心

入口文件：`backend/tsinghua-learn-connector.js`。

`syncTsinghuaLearn()` 本身只接受服务端注入的 `authorizedFetch`。一次性密码只进入
`/direct-login` 认证入口；解析和同步函数永远不接触密码。浏览器也不能向同步接口提交 Cookie、
目标 URL 或 user ID。当前固定访问当前学期、课程列表、课程公告和三类作业。

输出是供工作台写入层使用的规范化快照，包括课程、通知、作业、待确认重要事项、部分失败和
无敏感值的响应证据。重要事项保持 `draft`，不能未经用户确认直接写入日程。

## 安全边界

- `freebbs-agent` 只消费已经规范化且获授权的数据，不接触清华密码、Cookie 或票据；
- direct 登录要求 FREE BBS Bearer Token，但不接受浏览器提供的清华 Cookie、上游
  Authorization、自定义目标 URL 或自报 user ID；
- 32 位十六进制浏览器设备指纹只在用户显式同意后生成并用于本次 direct 登录，不持久化或回显；
- 公开探测只记录“响应是否出现 Cookie”的布尔证据，不保存 Cookie 值；
- direct 登录成功后只保存按域隔离、按用户加密的 Learn Cookie jar，且不会返回前端或 Agent；
- 加密 Learn 会话由服务端强制限制为最长 8 小时；持久 Cookie 更早过期时以更早时间为准；
- 上游目标使用精确 HTTPS 白名单，重定向、Cookie 和 XSRF 都由服务端受限处理；
- 错误、日志和 API 响应不得包含登录名、密码、一次性指纹、ticket、state、Cookie、令牌或
  原始私有页面；
- 直连登录限流目前为进程内实现，生产多实例必须改为共享限流器；
- 单次同步有总时限、请求预算、课程上限、并发上限和最小请求间隔；
- 解绑删除加密 grant 并提升 generation，旧任务不能继续落库；
- 用户修改过的待办和日程，后续同步不得无痕覆盖。

更完整的接口、环境变量和数据库说明见 `docs/tsinghua-authorization-broker.md`。

## 下一阶段验收

direct CAS 只有在以下条件全部满足后才能标记为“真实账号已验证”：

- 部署负责人明确批准在测试环境启用兼容模式，账号本人主动同意；
- 至少核对当前学期、课程、公告和三类作业各一条真实数据；
- 登录名、密码和一次性 `fingerPrint` 未进入日志、数据库、响应、浏览器存储或加密 grant；
- 浏览器设备指纹为有效的 32 位十六进制值，且只在用户提交后生成；
- 数据库只存在可成功解密且 AAD 绑定当前用户的 Cookie 密文；
- 真实同步不会跨用户、重复写入或覆盖用户修改；
- 解绑、会话过期、429、超时、验证码和结构变化均有可理解的安全失败结果。

official 模式只有在校方 adapter、批准的 callback、授权范围和撤销方式均可用，并完成独立安全
评审后才能标记为“正式授权已接入”。Info 私有同步需单独实现和验收。
