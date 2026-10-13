# FREE-BBS 课程组 Agent API

在「个人设置 → 课程组 Agent 接入」生成 Token、下载 Skill。Agent 可直接把 Markdown 发布为课程地图中的知识点，更新正文、基本信息、应用、位置和知识点连接，也可上传课程资料与图片。所有用户都可生成 Token；实际课程操作要求用户被分配为该课程的资料负责人，或为站点管理员。教师/助教身份本身不授予课程权限。每次请求重新检查权限、Token 到期/撤销状态与用户名规则。用户名不合规时先登录网站修改。

本轮随 PR #180 增加 Node.js 完整模板下载/发布工具，使用下面已有 API，不新增批量覆盖、权限升级或整篇草稿接口。工具是否可从正式网站下载须核对部署；仅有课程资料上传权限不代表稿件已经过教学审核。

将 ZIP 解压为 Agent 的 `skills/freebbs-course-upload` 目录（Codex 默认目录为 `~/.codex/skills/freebbs-course-upload`）。Skill 保留仅依赖 Python 3 标准库的旧脚本，新增的完整模板工具位于 `scripts/course-authoring/`，需要 Node.js 18 或以上。设置 `FREEBBS_BASE_URL` 为站点 origin（正式站点 `https://www.free-bbs.cn`），`FREEBBS_UPLOAD_TOKEN` 为个人 Token。请通过本地密钥管理器或安全的环境变量配置注入，不要将 Token 放进命令参数、提交到仓库或粘贴到日志。生产环境只用 HTTPS，本机调试可用 `http://127.0.0.1:3001`。

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

`title` 最多 160 字符，`summary` 最多 500，每个 section 最多 500000；坐标为 0–10000 整数。传入空字符串显式清空该分区。未知字段、错误类型、超限数据返回 400。`expectedRevision` 用上次读取的 `node.revision`；创建时用 `new`。不一致返回 409，无写入。Python `upload-node` 和 `put-node` 缺省会预读 revision，但在准备修改前也应先读原节点，并显式携带那次读取的 revision，防止准备期间发生覆盖。更新 nodes/sections 与 RAG 索引版本在同一事务提交。

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

## 下载当前作者稿与提交完整模板（Node.js）

[课程组模板包](https://www.free-bbs.cn/downloads/freebbs-course-authoring.zip) 包含 `README.md`、课程组编写指南、模板、样例和 `tools/` 工具；需部署 PR #180 对应版本才含本轮新工具。Skill 包也带有相同工具，但路径为 `scripts/course-authoring/`。下例在 Skill 目录执行；模板包则将脚本前缀改为 `tools/`。

### 只读下载

先用旧脚本的 `courses` 查明所负责课程标识，然后下载选定课程：

```sh
python3 scripts/freebbs_course_upload.py courses
node scripts/course-authoring/下载课程.cjs signals --out 现有课程-20261012
```

仅 GET 课程地图与逐点作者接口，输出 `课程地图原始.json`，每点的 `知识点/ID/节点原始.json`、`revision.txt`、`基本信息.md`、`背景与应用.md`、`正文.md`，全部成功后才生成 `快照清单.json`。保留完整作者评分配置及节点位置；不读取学生作答、私人笔记或聊天，不下载图片/附件本体，不自动拼完整模板或补编章节/知识起源。输出目录必须不存在，不覆盖已有文件；请求校验后才写本地文件，本地写出失败可能留下部分结果，应保留核查，下次使用新的输出目录。工具复查地图变化，但逐点 GET 不是数据库事务级快照，不能保证全部节点为同一瞬间版本。

公开学生接口的知识点快照可能裁去评分配置及评分答案，不能当完整作者备份。下载出的单独 `正文.md` 也不是完整三分区模板。旧稿缺少真实章名、知识起源、署名或新版字段时，课程组需如实整理、补齐和审核，不能自动伪造来源、审核者或已发布状态。

### 完整三分区模板预检与发布

填写模板内的“课程标识”和“知识点ID”，工具从稿件读取目标，调用 `/courses/:slug/nodes/:nodeId`。更新用准备修改前读取的 64 位 `node.revision`；新建用 `new` 且必须指定两个坐标。默认只校验与 GET 检查，无写入；只有显式 `--publish` 才执行一次 PUT 并 GET 回读核对。

```sh
node scripts/course-authoring/上传知识点.cjs 完整稿.md --revision "上次读取的64位revision"
node scripts/course-authoring/上传知识点.cjs 完整稿.md --revision "上次读取的64位revision" --publish
node scripts/course-authoring/上传知识点.cjs 新知识点.md --revision new --x 200 --y 180
```

新建发布也需显式追加 `--publish`。完整稿经本包解析器拆分为三个 sections，同时更新名称与概览；不传坐标则保留已有位置，不改关系。只发布用户明确指定且完成教学审核的稿件，不自动批量上传其他文件。稿件格式检查不判断答案、史实或教学适切性。

网站节点正文没有独立整篇草稿开关，保存后即成为可见内容；评分扩展的 `draft` 不会隐藏正文。Node 工具不自动填审核人、切换 `published` 或生成正式通过证据。401/403/409 时停止，409 需回读并人工合并；写入超时或回读失败先核对实际保存结果，不自动重试，也不因回读失败认定 PUT 未成功。

现有 Python `upload-node` 只把 MD 文件当 `knowledgeMarkdown`，不识别完整模板；`--basic-info` 与 `--applications` 可分别更新另外两个分区，未提供的分区保留，空文件会清空对应分区。原有 `get-node`、`map`、`upload-node`、`put-node`、图片/附件和关系命令均继续兼容。只想改正文而不替换其他分区时，使用这套旧分区接口，不把完整模板直接当正文传入。

## Python 调用示例

以下命令读取环境变量，不接收 Token 参数。在 Skill 目录下运行。

### 上传课程地图知识点

`upload-node` 将 UTF-8 Markdown 文件直接写入知识点正文；新建的知识点会出现在课程地图中。`file` 上传的是可下载附件，不会创建知识点或改写正文。

先查看可管理的课程和目标地图，确认知识点编号、空闲位置及已有连接：

```sh
python3 scripts/freebbs_course_upload.py courses
python3 scripts/freebbs_course_upload.py map signals
```

以下新建示例使用 `SS-03-01` 和坐标 `(960,320)`；实际应选择地图中未使用的编号和与周围节点留有间距的位置。标题为新建知识点的必填项，`--expected-revision new` 防止覆盖同名节点。

```sh
python3 scripts/freebbs_course_upload.py upload-node signals SS-03-01 fourier.md \
  --title "傅里叶变换" --summary "时域与频域的桥梁" \
  --x 960 --y 320 --expected-revision new
```

更新时先保存原节点，阅读内容后再编辑本地 Markdown。使用读取时的 revision，期间若他人修改节点，上传会以 409 终止，应重新读取并合并后再提交：

```sh
python3 scripts/freebbs_course_upload.py get-node signals SS-03-01 > node-before.json
```

准备好新的 `fourier.md` 后执行：

```sh
NODE_REVISION=$(python3 -c 'import json; print(json.load(open("node-before.json", encoding="utf-8"))["node"]["revision"])')
python3 scripts/freebbs_course_upload.py upload-node signals SS-03-01 fourier.md \
  --expected-revision "$NODE_REVISION"
```

上面的更新只替换正文，保留标题、简介、基本信息、应用和坐标。需要修改其他字段时才传入对应选项：

| 选项                      | 含义                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `--title TITLE`           | 设置标题；新建必填                                                                  |
| `--summary SUMMARY`       | 设置简介                                                                            |
| `--basic-info FILE`       | 用 UTF-8 Markdown 文件替换基本信息分区                                              |
| `--applications FILE`     | 用 UTF-8 Markdown 文件替换应用分区                                                  |
| `--x INT`、`--y INT`      | 设置指定坐标；未传入的坐标保持原值                                                  |
| `--expected-revision REV` | 使用先前读取的 `node.revision`；新建使用 `new`；省略时脚本在写入前读取当前 revision |

正文文件始终替换正文；附加分区文件未提供时保留对应分区，提供空文件则显式清空对应分区。只发布用户指定的课程和知识点，不应因为源文件缺少其他内容而清空已有分区。

为正文插图时先上传图片，将响应中的 `markdown` 插入 `fourier.md` 的相应位置，再用上述 `upload-node` 命令发布：

```sh
python3 scripts/freebbs_course_upload.py image signals fourier-diagram.png
```

连接需要两个知识点已经存在。确认地图中已有 `SS-01-01`、新节点 `SS-03-01` 已创建且该连接尚不存在后，可按用户要求建立学习路径：

```sh
python3 scripts/freebbs_course_upload.py connect signals SS-01-01 SS-03-01 --type ordered
python3 scripts/freebbs_course_upload.py map signals
```

`ordered` 表示从 source 指向 target 的学习顺序，也是省略 `--type` 时的默认值；关联知识点使用 `--type related`。写入后检查返回的节点和地图，确认正文、位置及连接符合要求。图片或连接创建遇到超时，先检查结果再决定后续操作，不自动重试。

### JSON、附件与其他地图操作

原有 JSON 部分更新和地图请求命令继续可用：

```sh
python3 scripts/freebbs_course_upload.py get-node signals SS-01-01
python3 scripts/freebbs_course_upload.py put-node signals SS-01-01 node-patch.json
python3 scripts/freebbs_course_upload.py file signals chapter-1.pdf --node-id SS-01-01
python3 scripts/freebbs_course_upload.py image signals diagram.png
python3 scripts/freebbs_course_upload.py files signals
python3 scripts/freebbs_course_upload.py map-request signals PUT /background --json-file background.json
```

HTTP 400 表示数据错误；401 表示 Token 无效/过期/撤销；403 表示权限不足或需要修改用户名；404 表示课程/知识点/文件不存在；409 表示重复节点或版本冲突。网络超时后先读取确认操作结果：文件重复上传会去重，知识点可校验 revision；图片/连接创建不自动重试。撤销 Token 后不会删除已发布的资料。

部署：启动时在课程基础表初始化之后运行 `ensureCourseUploadTables`，迁移文件为 `database/migrations/027_course_upload_tokens.sql`。课程文件存放在上传目录内的 `course-agent-files` 子目录，随上传目录一同持久化和备份。服务必须在静态文件中间件之前阻止 `/uploads/course-agent-files` 路径的直接访问，资料统一通过 `/api/course-upload/files/:id` 下载；图片沿用站点上传目录。资料文件不会自动进入 PDF 等文件的 RAG 解析流程，知识点 Markdown 更新会触发现有 RAG 重建。
