# 代码审查说明

本次增加可编译的 SwiftUI iPhone 客户端与服务端审核支持，不修改既有网页 UI，也不覆盖工作区已有改动。开发团队与 Bundle ID、客服邮箱已按用户提供的值配置。

## 审查入口

| 文件/目录 | 重点 |
|---|---|
| `FreeBBS/App/AppStore.swift` | 登录状态、过期清理、账号切换时丢弃旧请求、屏蔽与通知 |
| `FreeBBS/Core/APIClient.swift` | HTTPS、Bearer、同域重定向、错误反馈、临时会话 |
| `FreeBBS/Core/TokenVault.swift` | 钥匙串 `WhenUnlockedThisDeviceOnly`，不保存明文密码 |
| `FreeBBS/Views/AuthenticationView.swift` | 原生注册、协议、一次性 challenge、验证码、Wien 条件 |
| `FreeBBS/Views/DiscussionView.swift` | 卡片摘要、楼中楼、三种反应、回复点赞/删除、举报与屏蔽 |
| `FreeBBS/Views/LaboratoryView.swift` | 同域白名单、临时 Web 会话、手机实验布局、原生提示和文件分享 |
| `FreeBBS/Views/RichContentView.swift`、`WebSource/` | 离线共享渲染、参数传递、HTTPS、主 frame 桥接、HTML 工具 opaque sandbox |
| `FreeBBS/Views/CoursesView.swift` | 手机知识点与关系视图、真实地图接口、分区正文 |
| `FreeBBS/Views/ProfileView.swift` | 账号设置、真实删除申请状态、客服 |
| `FreeBBS/Views/ChatView.swift` | AI 数据发送确认、上下文限制、取消请求 |
| `../backend/mobile-safety.js` | 权限、举报限额/去重、删除申请验证、管理员队列 |
| `../database/migrations/032_mobile_safety.sql` | 仅新增表、外键行为与索引 |
| `FreeBBSTests/`、`FreeBBSUITests/` | 传输/合同测试、导航、横屏、大字与截图 |

## 页面适配矩阵

| 页面组 | iPhone 行为 |
|---|---|
| 首页 | 可滚动、标题自动换行，快捷入口不足宽度时竖排 |
| 课程列表 | 系统 insetGrouped List、原生导航行与搜索 |
| 知识点/关系 | 列表与邻接图切换；不使用缩小的桌面坐标图 |
| 知识阅读 | 分区切换、可选择文字、正文自然高度 |
| 资料 | 系统 Quick Look、下载时禁用重复操作、临时文件清理 |
| 讨论列表 | 系统 plain List、摘要与图片/实验预览、可见最新/热门分段控件、置顶独立分组、菜单筛选和系统搜索 |
| 讨论详情 | 回复引用与目标提示、评论点赞/删除、底部输入框随键盘移动、宽公式/表格独立横滚 |
| 代码实验 | SwiftUI 代码编辑与参数 Form、原生输出/变量/汇编/绘图/Canvas 波形、NDJSON 与取消、原生快照分享和代码导出 |
| 工具工坊 | SwiftUI 列表、编辑表单、生成同意、公开发布确认；HTML 独立 opaque sandbox 预览 |
| 电路/挑战 | 原生列表、参数和工具栏；WebKit 保留复杂画布、元件面板、仿真与上下文操作，移除重复网页导航 |
| 富文本 | 离线公式字体与高亮、图片随宽、代码/表格横滚、随 Dynamic Type 与深浅色更新 |
| 发帖/举报 | 系统 Form 和 sheet，未提交草稿避免意外关闭 |
| 登录/注册/找回 | 系统表单、密码自动填充、验证码键盘；图表附候选数值 |
| 通知 | 未读标志不只依赖颜色、历史分页、重复记录去重 |
| 个人设置 | 原生 List/Form、确认退出、资料与密码分开 |
| 账号删除 | 清楚显示申请/待处理，二次确认及密码验证 |
| Max | 对话滚动、浮动玻璃输入、键盘安全区域、按账号保存一次同意、清空不重置、可在个人页撤回 |
| 日程 | 七天只读摘要、空态/错误态、时间本地化 |
| 隐私/支持 | 原生可滚动文本，邮件联系 |

共用 SF Symbols、语义字体和系统配色；自定义触控目标至少 44 pt，横竖屏和 Dynamic Type 采用自然布局。没有自建导航层覆盖系统玻璃标签栏；没有把长正文放在玻璃材质上。

## 审查时需留意

- `--demo` 只在 Debug 编译存在，明确展示示例内容，不作为审核后门。
- “最新”将置顶独立显示，其余已加载记录按发布时间排序，热门保留服务器热度顺序。加载/错误/重试可见，按请求版本、筛选和会话丢弃过期响应。当前只加载 50 条讨论，搜索为当前列表筛选；避免产品描述写成全站搜索。
- 代码实验和工具管理 UI 使用 SwiftUI，执行由既有服务端运行环境提供。电路画布/仿真、富文本和 HTML 预览仍含 WebKit；不能描述为全功能纯 SwiftUI 引擎。工具 iframe 不带 `allow-same-origin`，不能访问登录会话或原生桥。
- 实验快照保存后可公开读取；工具 POST 每次创建一个公开新版本。客户端在写入前明确确认公开范围，AI 生成前要求同意；Max 对话与工具助手共用已说明的数据范围。选择按账号保存在本机，退出账号不会把同意转给其他账号，个人页可撤回。
- Bearer 仅用于同域 API；实验室会话仅注入明确白名单的主 frame，账号切换销毁旧 WebView。HTML 工具的 CSP 禁止网络、表单、顶层导航。
- 举报当前仅记录和处理队列，无自动过滤与管理员网页；标记 resolved 不会自动删除内容。
- 删除当前只发起申请。App Store 提交前必须核实实际清除流程，不能直接把状态改为完成。
- 程序未集成推送、统计、广告、第三方登录或支付，不申请相应权限。
- 涉及网页、校园授权、数据日志与第三方 AI 的实际部署行为仍须核对隐私问卷。
- 请求旧数据在登录状态切换后应丢弃；新功能必须遵守这一约定。

## 平台标准来源

Apple [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)、[SwiftUI 自定义 Liquid Glass](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)、[iOS 27 Release Notes](https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes)。本机已完成 SDK 27 的编译、签名与分发导出；CI 37114209875 的 Xcode 27 / iOS 27 runtime 回归已通过；本机新增功能回归使用 SDK 27 / iOS 26 runtime。新增的 `FreeBBSIcon.icon` 由原生 Icon Composer 工具渲染检查并编译进 Archive。
