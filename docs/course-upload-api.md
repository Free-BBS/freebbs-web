# FREE-BBS 课程组 Agent API

在「个人设置 → 课程组 Agent 接入」生成 Token、下载 Skill。所有用户都可生成 Token；实际课程操作要求用户被分配为该课程的资料负责人，或为站点管理员。教师/助教身份本身不授予课程权限。每次请求重新检查权限、Token 到期/撤销状态与用户名规则。用户名不合规时先登录网站修改。

将 ZIP 解压为 Agent 的 `skills/freebbs-course-upload` 目录（Codex 默认目录为 `~/.codex/skills/freebbs-course-upload`）。Skill 自带仅依赖 Python 3 标准库的脚本。设置 `FREEBBS_BASE_URL` 为站点 origin（例如 `https://free-bbs.cn`），`FREEBBS_UPLOAD_TOKEN` 为个人 Token。请通过本地密钥管理器或安全的环境变量配置注入，不要将 Token 放进命令参数、提交到仓库或粘贴到日志。生产环境只用 HTTPS，本机调试可用 `http://127.0.0.1:3001`。

## 身份认证及 Token 管理

课程 API 前缀为 `/api/course-upload`，请求头为 `Authorization: Bearer fbcu_…`，JSON 为 `Content-Type: application/json`。Token 仅允许本页课程 API，不能登录、访问管理员接口或取得其他用户数据。数据库仅存储 SHA-256 摘要；明文仅在生成成功的响应展示一次。

以下个人管理端点使用网站的登录 JWT，不接受课程 Token：

| 方法/路径            | 内容                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /tokens`        | 自己的 Token 列表，无明文/摘要                                                                         |
| `POST /tokens`       | `{"name":"备课 Agent","expiresInDays":90}`；名称 1–80 字符、1–365 天、默认 90 天，最多 20 个有效 Token |
| `DELETE /tokens/:id` | 撤销自己的 Token，即时阻止后续 API 请求                                                                |
| `GET /skill.zip`     | 下载完整可安装 Skill（无须登录）                                                                       |
| `GET /docs`          | 阅读本文档（无须登录）                                                                                 |

## 知识点与课程资料

| 方法/路径                          | 内容                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `GET /courses`                     | 返回当前管理的课程 `id/slug/name`，没有权限时为空数组                     |
| `GET /courses/:slug/nodes/:nodeId` | 读取知识点、独立 sections、坐标及 `revision`                              |
| `PUT /courses/:slug/nodes/:nodeId` | 事务内创建或部分更新知识点；返回 `{created,course,node}`                  |
| `GET /courses/:slug/files`         | 该课程最近 200 个文件，包含 SHA-256 与下载地址                            |
| `POST /courses/:slug/files`        | 上传资料；同课程相同 SHA-256 自动返回已有文件（保留首次文件名和节点关联） |
| `POST /courses/:slug/images`       | 上传课程插图；转为 WebP，返回 `{url,markdown}`                            |

知识点编号统一大写且符合 `SS-01-01` 结构（4–64 字符，首段以英文字母开头，各段使用英文字母和数字）。新建必须给出 `title`；可省略的字段默认空字符串或 `(0,0)`。更新时所有未提供的字段均保留原值，包括每个 Markdown 分区和每个坐标。

```json
{
  "title": "傅里叶变换",
  "summary": "时域与频域的桥梁",
  "sections": {
    "knowledgeMarkdown": "## 定义\n\n正文及公式……",
    "basicInfoMarkdown": "难度：3",
    "applicationsMarkdown": "用于频谱分析。"
  },
  "position": { "x": 480, "y": 320 },
  "expectedRevision": "new"
}
```

`title` 最多 160 字符，`summary` 最多 500，每个 section 最多 500000；坐标为 0–10000 整数。传入空字符串显式清空该分区。未知字段、错误类型、超限数据返回 400。`expectedRevision` 用上次读取的 `node.revision`；创建时用 `new`。不一致返回 409，无写入。Python `put-node` 缺省会预读 revision，但在人工准备修改前也应先读原节点，并在 JSON 中保留那次读取的 revision，防止准备期间发生覆盖。更新 nodes/sections 与 RAG 索引版本在同一事务提交。

资料上传正文：

```json
{ "fileName": "第一章讲义.pdf", "contentBase64": "<标准 Base64 内容>", "nodeId": "SS-01-01" }
```

每个文件最多 20MB；支持 PDF、UTF-8 TXT/MD/CSV、DOCX/XLSX/PPTX、ZIP，不会在服务器解压或执行。`nodeId` 可选，但必须是该课程已有节点。文件名禁止路径及控制字符。返回 `{created,file:{id,fileName,nodeId,contentType,size,sha256,url,markdown,createdAt}}`。上传资料不会自动改写节点；将返回的 `file.markdown` 链接合并到所需分区即可。现有 `nodeId` 关联仅作为资料分类元数据，不会因文件重复上传而变更。

资料在课程中公开发布：`GET /public/courses/:slug/files` 提供资料列表，`GET /files/:id` 无须认证并以附件下载。请仅上传适合课程公开的资料。服务端为其分配随机文件名、单独存储并强制 `nosniff`，不会按用户路径写入磁盘。下载不等同于对文档内容作安全审查。已停用课程的资料不可下载。

图片正文为 `{"imageDataUrl":"data:image/png;base64,..."}`，支持 PNG/JPEG/WEBP/GIF/AVIF，最多 20MB、4000 万输入像素，输出 2400 像素内 WebP（动图取首帧）。返回 URL 可嵌入知识点 Markdown。背景图可使用下节 `/map/background` 修改。

## 现有课程编辑界面的对应 API

以下与网页地图编辑器一致的功能，也可使用相同 Token；每次调用校验当前课程负责人权限。路径前缀仍为 `/api/course-upload`。

| 方法/路径                                       | JSON 正文                                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /courses/:slug/map`                        | 获取地图、节点与连接                                                                                                  |
| `GET /courses/:slug/map/nodes/:nodeId`          | 获取节点文档及分区                                                                                                    |
| `POST /courses/:slug/map/nodes`                 | `{id,title,summary,position:{x,y}}` 新建节点                                                                          |
| `PATCH /courses/:slug/map/nodes/:nodeId`        | `{title,summary,position:{x,y}}` 修改节点基础信息（完整提供这些字段）                                                 |
| `PUT /courses/:slug/map/nodes/:nodeId/document` | `{sections:{knowledgeMarkdown,basicInfoMarkdown,applicationsMarkdown}}`，三个分区均应完整提供；推荐上节的部分更新接口 |
| `DELETE /courses/:slug/map/nodes/:nodeId`       | 删除节点及其连接                                                                                                      |
| `POST /courses/:slug/map/edges`                 | `{source,target,type}`；`type` 为 `ordered` 或 `related`                                                              |
| `DELETE /courses/:slug/map/edges`               | `{source,target,type}` 删除指定连接                                                                                   |
| `PUT /courses/:slug/map/background`             | `{backgroundUrl:"/uploads/...webp"}` 或 `{imageDataUrl:"data:image/png;base64,..."}`；空 `backgroundUrl` 清除背景     |
| `POST /courses/:slug/map/uploads/images`        | `{imageDataUrl:"data:image/png;base64,..."}`；网页原有图片上传接口                                                    |

这些兼容接口沿用网页的验证与更新行为。为保证“省略字段即保留”以及事务/版本冲突保护，知识点写入优先使用 `/nodes/:nodeId`；图片优先使用 `/images`。

## Python 调用示例

以下命令读取环境变量，不接收 Token 参数：

```sh
python3 scripts/freebbs_course_upload.py courses
python3 scripts/freebbs_course_upload.py get-node signals SS-01-01
python3 scripts/freebbs_course_upload.py put-node signals SS-01-01 node-patch.json
python3 scripts/freebbs_course_upload.py file signals chapter-1.pdf --node-id SS-01-01
python3 scripts/freebbs_course_upload.py image signals diagram.png
python3 scripts/freebbs_course_upload.py files signals
python3 scripts/freebbs_course_upload.py map-request signals PUT /background --json-file background.json
```

HTTP 400 表示数据错误；401 表示 Token 无效/过期/撤销；403 表示权限不足或需要修改用户名；404 表示课程/知识点/文件不存在；409 表示重复节点或版本冲突。网络超时后先读取确认操作结果：文件重复上传会去重，知识点可校验 revision；图片/连接创建不自动重试。撤销 Token 后不会删除已发布的资料。

部署：启动时在课程基础表初始化之后运行 `ensureCourseUploadTables`，迁移文件为 `database/migrations/027_course_upload_tokens.sql`。课程文件存放在上传目录内的 `course-agent-files` 子目录，随上传目录一同持久化和备份。服务必须在静态文件中间件之前阻止 `/uploads/course-agent-files` 路径的直接访问，资料统一通过 `/api/course-upload/files/:id` 下载；图片沿用站点上传目录。资料文件不会自动进入 PDF 等文件的 RAG 解析流程，知识点 Markdown 更新会触发现有 RAG 重建。
