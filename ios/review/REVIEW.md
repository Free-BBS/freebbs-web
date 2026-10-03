# 代码审查说明

本次增加可编译的 SwiftUI iPhone 客户端与服务端审核支持，不修改既有网页 UI，也不覆盖工作区已有改动。开发团队与 Bundle ID、客服邮箱已按用户提供的值配置。

## 审查入口

| 文件/目录 | 重点 |
|---|---|
| `FreeBBS/App/AppStore.swift` | 登录状态、过期清理、账号切换时丢弃旧请求、屏蔽与通知 |
| `FreeBBS/Core/APIClient.swift` | HTTPS、Bearer、同域重定向、错误反馈、临时会话 |
| `FreeBBS/Core/TokenVault.swift` | 钥匙串 `WhenUnlockedThisDeviceOnly`，不保存明文密码 |
| `FreeBBS/Views/AuthenticationView.swift` | 原生注册、协议、一次性 challenge、验证码、Wien 条件 |
| `FreeBBS/Views/DiscussionView.swift` | 发帖/回复验证、防重复提交、举报与屏蔽入口 |
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
| 课程列表 | 单列阅读卡片、搜索、宽屏限制阅读宽度 |
| 知识点/关系 | 列表与邻接图切换；不使用缩小的桌面坐标图 |
| 知识阅读 | 分区切换、可选择文字、正文自然高度 |
| 资料 | 系统 Quick Look、下载时禁用重复操作、临时文件清理 |
| 讨论列表 | 系统搜索、菜单筛选/排序、完整标题 |
| 讨论详情 | 底部回复框随键盘移动，滚动正文，举报与屏蔽菜单 |
| 发帖/举报 | 系统 Form 和 sheet，未提交草稿避免意外关闭 |
| 登录/注册/找回 | 系统表单、密码自动填充、验证码键盘；图表附候选数值 |
| 通知 | 未读标志不只依赖颜色、历史分页、重复记录去重 |
| 个人设置 | 原生 List/Form、确认退出、资料与密码分开 |
| 账号删除 | 清楚显示申请/待处理，二次确认及密码验证 |
| Max | 对话滚动、键盘安全区域、AI 数据确认与取消 |
| 日程 | 七天只读摘要、空态/错误态、时间本地化 |
| 隐私/支持 | 原生可滚动文本，邮件联系 |

共用 SF Symbols、语义字体和系统配色；自定义触控目标至少 44 pt，横竖屏和 Dynamic Type 采用自然布局。没有自建导航层覆盖系统玻璃标签栏；没有把长正文放在玻璃材质上。

## 审查时需留意

- `--demo` 只在 Debug 编译存在，明确展示示例内容，不作为审核后门。
- 目前只支持最近 50 条讨论，搜索为当前列表筛选；避免产品描述写成全站搜索。
- 复杂 Markdown、公式、图片与电路嵌入没有完成原生渲染，产品范围必须如实描述。
- 举报当前仅记录和处理队列，无自动过滤与管理员网页；标记 resolved 不会自动删除内容。
- 删除当前只发起申请。App Store 提交前必须核实实际清除流程，不能直接把状态改为完成。
- 程序未集成推送、统计、广告、第三方登录或支付，不申请相应权限。
- 涉及网页、校园授权、数据日志与第三方 AI 的实际部署行为仍须核对隐私问卷。
- 请求旧数据在登录状态切换后应丢弃；新功能必须遵守这一约定。

## 平台标准来源

Apple [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)、[SwiftUI 自定义 Liquid Glass](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views)、[iOS 27 Release Notes](https://developer.apple.com/documentation/ios-ipados-release-notes/ios-ipados-27-release-notes)。本机 SDK 26 没有完成 SDK 27 的编译/运行验证，需在对应环境继续执行测试。
