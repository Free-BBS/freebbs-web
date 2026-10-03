# 网页功能覆盖与手机审查（build 9）

「今日 → 所有功能」提供按类别排列、可搜索的原生目录。「我的」和课程、知识点、讨论、Max、代码与工具页提供对应完整工作区入口。42 个主站页面和发展端 34 条静态/详情路由已纳入白名单；目录共 68 项，带参数的编辑和详情页面由父工作区进入。

核心页面仍由 SwiftUI 实现。复杂功能复用正式网站的完整工作区，由原生导航、操作菜单、文件/照片选择器、分享和授权界面承载；不是所有子控件都已经改写成 SwiftUI。这一实现保持现有网页业务、权限和版本管理，不以截图或入口存在代替业务验收。

## 功能与入口

| 功能 | 手机入口与操作 |
| --- | --- |
| 学习世界与课程 | 所有功能 → 学习世界；原生课程页 → 课程工作区。保留知识岛、课程地图、学习记录、资料管理和背景编辑 |
| 知识点与文档 | 知识点 → 完整工作区；Markdown 编辑器先选择课程和知识点，再携带 `course` 与 `point` 进入正式编辑。保留正文/基本信息/应用、图片上传、历史与权限 |
| 计划与校园 | 我的 → 完整工作台。保留日历、重要事项、重复安排、AI 草稿预览/确认、校园连接、同步、公告、课程与作业；授权代理使用不注入 App 凭据的独立视图，返回结果交回工作台 |
| 活动 | 活动报名；保留填写、提交、回执和抽签结果；有权限的账号可进入活动管理 |
| 讨论 | 原生最新/热门、回复、屏蔽与举报；完整讨论工作区保留投票、悬赏、激光互动、编辑与版主管理；帖子参数和定位片段随链接保留 |
| Max | 问问 Max → 完整工作区。保留历史、模型、附件、工具制作与任务控制；原生、网页及电路共用按账号在本机保存的同意记录，可撤回 |
| 实验室 | 原生代码、参数、运行、调试、结果和工具；完整实验/工具工作区提供网页其余控制。电路画布、挑战、排行榜、版本、导入导出、Max 与出题管理保留 |
| 个人与经济 | 我的 → 全部个人设置/个人主页/电磁场商城/仓库与钱包。保留头像、邮箱、学号、阅读与邮件选项、徽章、商品、使用/赠送/出售和账本。经典工作区菜单提供签到日历、运势与资产说明 |
| 牧场 | 电子牧场、羊的染坊、羊群广场。保留养成、互动、场景、配色与分享；全屏牧场使用 App 的可用区域 |
| 发展端 | 原生目录包含信息服务、提案/咨询、兴趣小组、社团、活动、学生节、征集/报名/作品、社区、联络、体育、财务与管理；详情参数保留。设置/个人/商城/仓库的同源内嵌页面也支持上传与会话联动 |
| 管理 | 有管理员标识的账号显示主站和发展端管理入口；具体操作继续由服务端权限控制。保留用户、公告、奖励、课程资料、报名与模型配置 |
| 帮助与规划页 | Max 探索手册、关于、工作人员、PBL 与创意工坊。网页中尚在规划或被停用的模块沿用网页真实状态，没有创建虚构业务 |

## 手机适配与会话

使用系统 List、搜索、导航、菜单和表单。完整工作区移除重复的网页导航；桌面栏、后加载的手机栏和预留间距不会再次挤占内容。表单输入使用 16 px 字号和 44 px 操作高度，窄屏表格可横向滚动，编辑器分区与工具横向排列，牧场去除桌面顶底间距。功能面板和确认对话保留。上传来源提供照片/视频、文件和硬件可用时的系统拍照；权限说明覆盖头像、讨论附件与实验素材，拍照和真实提供者仍待真机验收。

所有工作区共用当前账号的临时 WebKit 数据存储。登录凭据仍由 Keychain 管理；退出和重新登录替换网页存储。阅读、主题、学习记录、发现偏好、牧场学习选项、Max 模型/后台任务引用、工作台提示、已看成就和五种代码草稿按账号保存在本机，只恢复一次，后续网页导航不会覆盖刚修改的设置。动态键仅接受当前账号与明确的语言/成就列表；不会把密码、原生登录 token 或校园连接凭据写入偏好字典。

原生消息仅接受准确的 HTTPS 站点与受支持页面，并验证 WebKit 安全来源；发展端仅允许四种明确的同源内嵌页面使用文件和消息桥。外部授权页不注入 token、脚本或消息桥。拒绝 Max 同意时不发起 AI 请求；撤回会中止当前页面的 AI 请求。查看模型、管理对话记录和取消任务不要求再次同意。

## 审查与验证边界

`python3 ios/scripts/generate-feature-catalog.py --check` 对比 `server.js`、HTML 重定向和发展端路由；新增网页而未更新手机目录时，CI 会失败。该检查验证路由覆盖，不证明每项后端业务成功。

新增自动测试覆盖受信任/越界链接与旧 HTML 深链、管理员目录、账号偏好隔离与恢复、网页偏好跨文档保留、Max 实际脚本的发送前授权/撤回、授权回调、内嵌页边界、文件复制/取消、窄屏表格与后加载导航，以及牧场双方向几何。原有合同、安全、渲染和原生页面测试保留。

公开学习世界、羊群广场、探索手册和关于页已在真实 App 中进行只读在线复查。网络复查源码保存在本机 `artifacts/features-native-review/`，不加入可复现 CI。Debug 示例目录测试与在线工作区测试分别记录。

没有使用正式 FREE-BBS 账号执行注册、头像保存、校园登录、发帖、报名、商城交易、AI 生成或管理员写入。这些功能复用既有网页和服务端流程；提交正式审核前仍需具备对应权限的测试账号完成业务验收。Apple 上传登录与 FREE-BBS 业务登录是两种不同的凭据。物理设备、真实照片/文件提供者和 VoiceOver 验收仍待完成。

下表由当前目录列出所有页面；「上下文」表示必须从课程/知识点/发布等父工作区携带参数进入。单独打开 Markdown 编辑器会先进入原生课程选择。

| 页面 | 功能 | 呈现与入口 |
| --- | --- | --- |
| `/` | 今日 | SwiftUI / native canvas host (context or existing native entry) |
| `/world` | 学习世界 | Full workspace in native navigation |
| `/course` | 课程工作区 | Full workspace in native navigation (context or existing native entry) |
| `/knowledge` | 知识点工作区 | Full workspace in native navigation (context or existing native entry) |
| `/course-map-editor` | 编辑课程地图 | Full workspace in native navigation (context or existing native entry) |
| `/search` | 全站搜索 | Full workspace in native navigation |
| `/workbench` | 完整工作台 | Full workspace in native navigation |
| `/surveys` | 活动报名 | Full workspace in native navigation |
| `/discussion` | 完整讨论工作区 | Full workspace in native navigation |
| `/publish` | 完整发表工作区 | Full workspace in native navigation (context or existing native entry) |
| `/aichat` | Max 完整工作区 | Full workspace in native navigation |
| `/markdown-editor` | Markdown 编辑器 | Native document picker + context workspace |
| `/creative-workshop` | 创意工坊 | Full workspace in native navigation |
| `/pbl` | PBL 计划 | Full workspace in native navigation |
| `/laboratory` | 全部实验室 | SwiftUI / native canvas host |
| `/circuits` | 电路库 | SwiftUI / native canvas host |
| `/circuit` | 电路实验室 | SwiftUI / native canvas host |
| `/circuit-embed` | 电路引用 | Full workspace in native navigation (context or existing native entry) |
| `/circuit-challenge` | 电路挑战 | SwiftUI / native canvas host |
| `/code-lab` | 完整代码实验室 | Full workspace in native navigation |
| `/tool-workshop` | 完整工具工坊 | Full workspace in native navigation |
| `/profile` | 个人主页 | Full workspace in native navigation |
| `/settings` | 全部个人设置 | Full workspace in native navigation |
| `/electromagnetic` | 电磁场商城 | Full workspace in native navigation |
| `/inventory` | 仓库与钱包 | Full workspace in native navigation |
| `/ranch` | 电子牧场 | Full workspace in native navigation |
| `/ranch-dye` | 羊的染坊 | Full workspace in native navigation |
| `/ranch-gallery` | 羊群广场 | Full workspace in native navigation |
| `/guide` | Max 探索手册 | Full workspace in native navigation |
| `/about` | 关于 FREE-BBS | Full workspace in native navigation |
| `/staff` | 工作人员 | Full workspace in native navigation |
| `/login` | 登录 | SwiftUI / native canvas host (context or existing native entry) |
| `/register` | 注册 | SwiftUI / native canvas host (context or existing native entry) |
| `/remake` | 找回密码 | SwiftUI / native canvas host (context or existing native entry) |
| `/adminusers` | 用户管理 | Full workspace in native navigation |
| `/system-settings` | 管理员端 | Full workspace in native navigation |
| `/system-settings/announcements` | 公告管理 | Full workspace in native navigation |
| `/system-settings/rewards` | 奖励方案 | Full workspace in native navigation |
| `/system-settings/model` | 模型与密钥 | Full workspace in native navigation |
| `/system-settings/course-materials` | 课程资料管理 | Full workspace in native navigation |
| `/system-settings/surveys` | 报名活动管理 | Full workspace in native navigation |
| `/development` | 发展端入口 | Full workspace in native navigation |
| `/development/dashboard` | 发展端总览 | Full workspace in native navigation |
| `/development/shop` | 发展端商城 | Full workspace in native navigation |
| `/development/inventory` | 发展端仓库 | Full workspace in native navigation |
| `/development/profile` | 发展端个人主页 | Full workspace in native navigation |
| `/development/settings` | 发展端个人设置 | Full workspace in native navigation |
| `/development/knowledge` | 知识平台 | Full workspace in native navigation |
| `/development/information` | 信息服务 | Full workspace in native navigation |
| `/development/information/announcements` | 发展端公告 | Full workspace in native navigation |
| `/development/information/consultations` | 我的咨询 | Full workspace in native navigation |
| `/development/information/triage` | 咨询处理 | Full workspace in native navigation |
| `/development/information/proposals` | 提案池 | Full workspace in native navigation |
| `/development/growth` | 成长与兴趣社群 | Full workspace in native navigation |
| `/development/interest-groups` | 兴趣小组 | Full workspace in native navigation |
| `/development/clubs` | 社团 | Full workspace in native navigation |
| `/development/events` | 活动与招募 | Full workspace in native navigation |
| `/development/events/student-festival` | 学生节 | Full workspace in native navigation |
| `/development/collections` | 作品征集 | Full workspace in native navigation |
| `/development/collections/registrations` | 征集报名 | Full workspace in native navigation |
| `/development/collections/mine` | 我的征集报名 | Full workspace in native navigation |
| `/development/collections/showcase` | 作品展示 | Full workspace in native navigation |
| `/development/community` | 发展端社区 | Full workspace in native navigation |
| `/development/liaison` | 学生联络 | Full workspace in native navigation |
| `/development/sports` | 体育与队伍 | Full workspace in native navigation |
| `/development/sports/matches` | 体育赛程 | Full workspace in native navigation |
| `/development/finance` | 财务工作区 | Full workspace in native navigation |
| `/development/admin` | 发展端管理 | Full workspace in native navigation |

Development detail route patterns:

- `^/development/dashboard$`
- `^/development/shop$`
- `^/development/inventory$`
- `^/development/profile$`
- `^/development/settings$`
- `^/development/knowledge$`
- `^/development/knowledge/[^/]{1,256}$`
- `^/development/information$`
- `^/development/information/announcements$`
- `^/development/information/consultations$`
- `^/development/information/triage$`
- `^/development/information/proposals$`
- `^/development/information/proposals/[^/]{1,256}$`
- `^/development/growth$`
- `^/development/interest\-groups$`
- `^/development/clubs$`
- `^/development/events$`
- `^/development/events/student\-festival$`
- `^/development/collections$`
- `^/development/collections/registrations$`
- `^/development/collections/mine$`
- `^/development/collections/showcase$`
- `^/development/collections/showcase/[^/]{1,256}$`
- `^/development/collections/workbench/[^/]{1,256}$`
- `^/development/community$`
- `^/development/community/posts/[^/]{1,256}$`
- `^/development/liaison$`
- `^/development/liaison/problems/[^/]{1,256}$`
- `^/development/events/[^/]{1,256}$`
- `^/development/sports$`
- `^/development/sports/matches$`
- `^/development/sports/[^/]{1,256}$`
- `^/development/finance$`
- `^/development/admin$`
