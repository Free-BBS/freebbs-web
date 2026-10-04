# FREE-BBS for iPhone

SwiftUI 原生客户端，位于现有 `Free-BBS/freebbs-web` 仓库的 `ios/`，与后端接口及审核材料共同维护。无需新建 GitHub 仓库。没有外部 Swift Package 依赖。

## 打开和运行

直接打开 `FreeBBS.xcodeproj`，选择 `FreeBBS` scheme 和 iPhone 模拟器，点击 Run。工程由 Python 标准库脚本生成并已提交到工作区；新增 Swift 文件后运行 `python3 ios/scripts/generate-project.py`。

配置在 `Config/App.xcconfig`：

- Bundle ID：`cn.free-bbs.app`，开发者团队：`Q83556V27Y`。
- API Origin：`https://www.free-bbs.cn`，客服：`feedback@free-bbs.cn`。
- 最低系统 iOS 26；标准 SwiftUI 控件采用系统 Liquid Glass，iOS 27 专项验证需要 Xcode 27 / iOS 27 runtime。
- 当前本机为 Xcode 27.0（27A266a），已安装 iOS 27 SDK、iOS 27.0 与 iOS 26.0.1 runtime；实际构建与回归结果见 `review/VALIDATION.md`。
- 已配置并发布用户批准的隐私政策草稿：`https://www.free-bbs.cn/mobile/privacy.html`。运营主体、AI 数据处理及期限仍须补齐确认。xcconfig 中 `$()` 防止 URL 的 `//` 被当作注释。
- 主图标为原生 `FreeBBSIcon.icon`：绵羊与知识轨道，支持系统浅色、深色和着色。设计源、提示词和预览见 `Design/Icons/README.md`。

Debug scheme 可增加 launch argument `--demo` 预览明确标注的示例页面。示例登录不会写入钥匙串，也不执行远端写操作。Release 编译不包含示例加载入口。App Store 审核使用正式测试账号，不能用示例模式替代账号或冒充线上数据。

## 已实现页面

首页与签到、课程搜索、知识点列表与关系浏览、分区知识阅读、课程资料系统预览、讨论版块与排序、标题搜索、讨论详情与回复、Markdown 发帖与预览、点赞、内容举报、用户屏蔽、通知及历史分页、个人资料编辑、用户名和密码修改、原生登录注册与找回密码、能带和文氏振荡器互动验证、学习日程、Max 对话及按账号记住同意/可撤回设置、账号删除申请、隐私政策、社区协议和客服入口。

实验室包含电路编辑/仿真、电路挑战、C/C++、Python、Octave、Verilog 与 HTML 工具工坊。代码实验使用 SwiftUI 参数表单、代码编辑器、NDJSON 输出、Python 暂停/步进/变量、三架构汇编、Octave 绘图和原生 Canvas 数字波形。工具工坊使用原生列表、编辑与 Max 生成表单，HTML 在无账号会话的 opaque iframe 中预览。电路列表、参数表单和操作栏为原生 SwiftUI；复杂电路画布、元件上下文和仿真引擎保留 WebKit，网站导航不重复显示。通知由首页右上角及底部工具菜单进入。

课程、讨论、回复、发帖预览与 Max 共用离线 Markdown 引擎：KaTeX 公式及字体、代码高亮/复制、图片、表格，以及线上电路、工具和代码实验结果嵌入。升级网页渲染逻辑后执行 `npm ci && python3 ios/scripts/bundle-rich-content.py`；CI 以 `--check` 校验资源与来源一致。许可证随包附带，无远端脚本依赖。

原生导航、自定义 SwiftUI Liquid Glass 底部栏、List/Form、sheet、键盘与底部安全区域；讨论“最新/热门”为直接可见的分段控件，置顶独立分组，旧请求不会覆盖新选择；内容区域最大宽度 680 pt，支持横屏、Dynamic Type、VoiceOver 和系统深浅色。玻璃仅用于导航与操作层，自定义玻璃按钮响应“减少透明度”。课程关系使用适合手机的邻接视图。

底部导航与网页版同序：**首页、讨论、＋、学习、工具**；全站搜索独立位于右下角。发布、学习和工具使用系统 SwiftUI Menu 浮动菜单，发布加号以实色底强调。41 条主站路由都对应原生业务页面；工作台、校园、商城、编辑和管理页面使用原生业务 UI。牧场使用 SwiftUI 导航与操作，加上受限 WebKit 呈现网页版背景、羊动画、SSE、时钟和倒计时；倒计时退出学习模式后仍继续。电路闯关提供直接可见的原生元件、测试、提交及关卡选择，点选元件打开原生参数表单。内容渲染和电路仿真引擎仍保留受限 WebKit，详见 `review/FEATURE_PARITY.md` 中的功能与未完成边界。头像框、名牌和主页卡片使用原生绘制，金色名字按服务器期限显示；换装后同步首页、讨论/回复及个人页。签到使用原生月历与真实服务器回执，首页和公开主页提供全年贡献热力图与每日详情。发展端继续排除；资产名称沿用「电元、磁元」。

## 后端配套

新增 `backend/mobile-safety.js` 与 `database/migrations/032_mobile_safety.sql`。启动后端会创建三张新表，也可按现有迁移流程执行，不能以重放整个 schema 代替增量迁移。

- `/api/mobile/blocks`：当前用户的屏蔽名单，服务器保存、客户端隐藏帖子和评论；不改变网页或其他客户端的展示。
- `/api/mobile/reports`：验证内容存在，举报事务去重、每小时限额；管理员处理接口位于 `/api/admin/mobile/reports`。
- `/api/mobile/account-deletion`：密码重新验证，返回真实 `pending` 申请状态；管理员队列 `/api/admin/mobile/account-deletions`。

**删除申请尚不是完整删除流程。** 当前没有自动清除数据库、上传文件、备份或第三方 AI 数据的 worker。正式上架前必须按 `review/OPERATIONS.md` 建立并验证实际删除与申诉流程。举报队列不能代替内容过滤及人工响应。配套接口已通过范围限定的部署上线，健康检查、未认证保护及政策/支持页面通过；仍须进行登录后的全链路验收，当前准备内部 TestFlight 测试。

## 验证

```sh
node --test backend/mobile-safety.test.js
IOS_SIMULATOR_ID=你的模拟器UUID bash ios/scripts/verify.sh
python3 ios/scripts/check-release.py
```

`check-release.py` 会在任何发布检查项未完成时退出 1。只有取得证据并实际完成对应工作，才能更新 `review/ReleaseStatus.json`。生成的测试结果与截图保存在 `ios/artifacts/`，构建缓存不提交 Git。

## 审查资料

- `review/REVIEW.md`：代码审查入口、页面矩阵及风险。
- `review/APP_STORE.md`：上架文案、审核路线、隐私问卷和提交步骤。
- `review/OPERATIONS.md`：举报与账号删除运营接口和上线条件。
- `FreeBBS/Resources/PrivacyPolicy.md`：随 App 展示的隐私草案。
- `review/privacy.html`、`review/support.html`：用户批准的网页草案，已发布；正式上架前补齐运营信息。
- `review/VALIDATION.md`：实际验证证据与未验证范围。

## Archive 与导出

explicit App ID `cn.free-bbs.app` 已注册，App Store Connect 应用记录已创建（Apple ID `6818750003`）。automatic signing 已生成签名 Archive 和 App Store Connect 分发包。App Privacy、年龄分级、审核账号和最终运营资料仍待确认。无需提供账号密码或证书私钥到本仓库。

```sh
python3 ios/scripts/check-release.py
xcodebuild -project ios/FreeBBS.xcodeproj -scheme FreeBBS -configuration Release \
  -destination 'generic/platform=iOS' -archivePath ios/artifacts/FreeBBS.xcarchive \
  -allowProvisioningUpdates archive
xcodebuild -exportArchive -archivePath ios/artifacts/FreeBBS.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath ios/artifacts/export
```

后端部署记录和 TestFlight 上传状态见 `review/DEPLOYMENT.md`。正式 App Store 提交需先通过 `check-release.py`；内部测试不能替代正式发布验收。
