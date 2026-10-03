# 验证记录

验证日期：2026-10-03。以下是本机开发审查证据，尚未提交 Apple 审核。

## 环境与结果

| 验证 | 环境 | 结果 / 证据 |
|---|---|---|
| Debug 编译 | Xcode 26.0.1，iOS 26 SDK | 通过；Swift 6 编译，无第三方 Swift Package |
| Release 编译 | generic iPhoneOS，关闭签名 | 通过；`../artifacts/ios-release-build.log` |
| Swift 核心测试 | iOS 26.0.1 模拟器 | 10 项通过；安全 URL、通知路由、Wien 边界、日期、实际响应字段、Bearer、401、错误响应 |
| 页面导航 | iPhone 17 Pro 模拟器，浅色 | 首页、Max、日程、课程、知识点、关系、讨论、发帖、通知、个人与客服通过 |
| 小屏适配 | iPhone SE 第三代模拟器，深色 | 原生页面、账号设置、删除申请、隐私、登录、注册与重置密码通过 |
| 横屏与辅助字号 | iPhone SE 第三代、iPhone 17 Pro，Accessibility XXXL | 导航可用，截图复查通过；横屏截图验证宽大于高 |
| 后端测试 | Node.js，模拟数据库 | 12 项通过；认证、权限、用户隔离、目标验证、举报去重/限额/回滚、密码与申请幂等、管理员操作 |
| 后端静态检查 | 仓库 ESLint、Prettier 配置 | 新增后端两个文件通过；不对工作区已有文件作格式化 |
| 发布检查 | `python3 ios/scripts/check-release.py` | 正确返回未就绪，保留正式发布门槛 |
| iOS 27 SDK 签名构建 | Xcode 27.0（27A266a），iphoneos27.0 | Archive、App Store Connect 分发导出与内部 TestFlight 上传通过；见 `DEPLOYMENT.md` |
| 新 SDK 回归 | SDK 27，iPhone 17 Pro / iOS 26.0.1 runtime | 13 项通过；`../artifacts/SDK27ReviewTests.xcresult`、`sdk27-test-summary.json` |
| 新增页面小屏回归 | iPhone SE 第三代 / SDK 27，iOS 26.0.1 runtime | 实验室、讨论楼中楼、横屏及最大辅助字号 2 项页面回归通过；`LabsSmallScreenTests.xcresult` |
| 富文本与实验室 | SDK 27 / iOS 26.0.1 runtime，iPhone 17 Pro | 18 项客户端测试通过；公式/表格/高亮/图片、脚本拦截、opaque 工具 sandbox、同域会话、实验室入口和楼中楼导航 |
| 共享网页渲染 | Node.js，`npm run test:discussion-markdown` | 120 项通过 |
| CI 失败修复 | [37114209875](https://github.com/Free-BBS/freebbs-web/actions/runs/37114209875) | macos-26、xcode-27 及后端任务全部成功；客服链接改用稳定标识，未删除断言 |
| 原生分层图标 | Apple Icon Composer ictool，design-generation 27 | 浅色、深色、着色和 60 pt 原生渲染复查通过；已编译为 Archive 主图标 |
| 生产部署 | 范围限定的 GitHub Actions 发布 | 健康检查、401 权限保护、政策和支持页面 200 及正文一致性通过 |

本轮客户端回归：25 个单元测试在 `FinalBuild6ContractTests.xcresult` 全部通过，包括核心合同、富文本与 sandbox、流式实验协议、最新/热门的真实请求参数和匿名作者、Max 同意保存/账号隔离/撤回。7 个完整小屏页面测试在 `UnifiedFinalReviewTests.xcresult` 全部通过；该次完整运行的单元测试 host 曾在 UIKit 启动时意外退出，因此不能将整份结果写为成功。随后独立单元测试定位到 SDK 27 在 iOS 26 runtime 的隐式隔离析构问题，显式使用非隔离析构后，25 项单元测试全部通过。完整同次 CI 结果见 [PR 174 最新检查](https://github.com/Free-BBS/freebbs-web/pull/174/checks) 和本机 `final-ci-summary.json`，不以 SDK 编译代替系统运行验收。

匿名身份保留为 `nil`，不丢弃匿名帖，不把匿名身份当作真实账号屏蔽。回归覆盖混合的匿名/普通最新和热门列表、匿名/已删除回复，以及非法作者 ID 仍应失败。此前另有 120 项网页 Markdown、预览及工具嵌入测试通过。

统一界面使用系统 List、Form、导航与分段控件；Liquid Glass 用于导航和操作区域，阅读内容保留清晰表面。原生代码编辑、运行参数、控制台、波形、工具管理与电路参数已恢复。讨论区分别显示置顶与最新内容，切换排序与版块会发送相应请求，过时请求不会覆盖新选择。Max 同意按账号存于本机，清空对话及页面切换不重置，可从「我的」撤回。

本地最新结果、截图与 CI 汇总保存于 `../artifacts/`，不提交生成物。

本机项目目录受 iCloud 文件占位影响。本轮发布使用 `/tmp/freebbs-ios-release` 的更新分支与 `/tmp/freebbs-ios-small-native-derived` 缓存；最终会同步 `ios/` 源码与本地证据，临时路径不写入工程配置。

## 截图证据

- [iPhone 17 Pro 首页](../artifacts/screenshots/01-home.png)，另有该设备的课程、讨论等页面截图。
- [小屏深色首页](../artifacts/screenshots-small/01-home.png)、[横屏](../artifacts/screenshots-small/12-landscape.png)、[最大辅助字号](../artifacts/screenshots-small/13-accessibility-text.png)。
- [删除账号申请](../artifacts/screenshots-small/17-account-deletion.png)、[隐私草案](../artifacts/screenshots-small/18-privacy.png)、[注册](../artifacts/screenshots-small/20-registration.png)。
- 小屏完整 21 张截图位于 `../artifacts/screenshots-small/`。

截图通过 Debug 的 `--demo` 生成，带有示例标识。测试未向线上发帖、举报、修改账号或删除数据。这些截图用于开发审查，正式商店截图需使用经过验收的 Release 版本及真实内容重新拍摄。

## 尚未验证或完成

1. **iOS 27 验证范围**：本机已安装 Xcode 27 / iOS 27 SDK，签名构建与上传通过。iOS 27 runtime 已安装。本轮本机小屏回归使用 iOS 26.0.1 runtime，不能当作 iOS 27 系统运行验收。CI 37114209875 已在 iOS 27 runtime 通过（日志含 `iOS 27.0.simruntime`），不能替代物理设备验收。
2. **真机与安装**：Bundle ID、应用记录及签名分发已完成；Apple 已接收内部 TestFlight 包。尚无 TestFlight 安装或物理设备验证证据。
3. **线上认证与写入**：没有使用用户正式账号验证注册邮件、互动验证、发帖、回复、AI、个人资料及校园数据。自动页面测试验证导航和布局，不能替代这些集成测试。
4. **MySQL 与业务验收**：配套模块及迁移已部署，启动初始化和健康检查通过；单元测试使用模拟数据库。实际事务、外键及登录后的管理员队列业务仍须验收。
5. **审核运营**：当前删除功能为密码验证后的申请队列；没有实现真实清除或自动注销。举报只有记录与处理接口，还需核实内容过滤、响应和违规内容处理流程。
6. **隐私与支持**：客服邮箱、URL 已确认；用户批准的政策与支持页面已发布。运营主体、AI 提供商、保留期限、处理期限尚未确认，正式上架前须完善。
7. **辅助功能**：大字和横屏通过自动导航与截图检查；VoiceOver 朗读顺序、减少透明度、硬件键盘及真机键盘交互仍需人工验收。
8. **页面范围**：课程资料没有通过真实文件下载的集成测试；公式、图片、表格、代码和电路/工具/实验结果嵌入已接入共享渲染引擎，代码编辑、参数、结果、工具管理和电路列表/操作栏已原生化；电路画布和富文本仍使用 WebKit。build 9 接入商城、牧场、完整学习/讨论/实验工作区和发展端管理页面，详见 [FEATURE_PARITY.md](FEATURE_PARITY.md)。正式账号的保存/发布、校园授权、交易、报名、服务端执行与文件分享仍须端到端验收。

完整提交前条件见 [App Store 准备](APP_STORE.md) 与 [运营流程](OPERATIONS.md)。只在实际完成并取得证据后更新 `ReleaseStatus.json`。

## 电路画布复查（build 7）

新增 WKWebView 几何测试覆盖 320×600 竖屏与 1024×400 横屏：覆盖整个可用区域、元件没有拉伸、画布相机比例与屏幕一致、布局前缩放值有效、已有与新增元件可见、重置缩放仍可见、网页元件选择面板仍可打开。其余 25 项合同、安全、富文本与同意记录测试保留。

本机公开电路页面复查包含新建、本地添加电阻、实际元件可点按、点击后的参数输入框可点按、关闭参数面板及横屏，并保存 33–37 号截图。检查不写入服务器。CI 不依赖这项在线复查。工具编辑与实际 sandbox 标题断言保留；工具 host 从完整 Markdown/数学页面缩小为只包含共享工具引擎，独立与页面测试继续验证隔离。

上一提交 2700e7a 在 [37118848936](https://github.com/Free-BBS/freebbs-web/actions/runs/37118848936) 的 iOS 27 任务全部通过，macos-26 的工具预览标题等待失败。本轮修复预览载入与进程恢复，保留实际内容断言并允许忙碌 CI 等待 30 秒。最新完整 CI 以 PR 检查及本机 `final-ci-summary.json` 为准，不能把前一提交的 iOS 27 成功当作本轮全部成功。

最终本机版本在 `Build7ClientVerification.xcresult` 和 `build7-client-verification.log` 中 28 项全部通过（26 单元、2 界面）。新元件、参数输入与横屏的最终截图为 `circuit-native-review/33–37`；没有使用失败或不完整的结果替代最终验收。

### CI 测试环境兼容

8298486 的 macos-26 任务中，工具预览已通过；新增画布测试在离屏 WKWebView 导航后改变 frame 时读取到上一尺寸的 CSS dvh，电路导航检查依赖分区标题的 AX 类型。仅修正测试：各方向在导航前给 WKWebView 设置初始尺寸，完整几何/元件/缩放断言保留；电路导航同时检查目的页导航栏与实际「新建电路」按钮，楼中楼回复的实际操作检查保留。两项定向回归在 `ViewportAndLibraryCIRegression.xcresult`、`ci-test-refinement.log` 通过。发布 App 源码未改变，TestFlight build 7 保持有效。最新完整矩阵结果以 PR 检查和本机汇总为准。

旧 iOS 27 任务还在查询屏幕外回复按钮时触发全页面 AX 快照超时。回复测试现先滚动到回复区，在该 ScrollView 内使用 firstMatch 定位原生按钮，并断言按钮实际被点按、回复目标和取消操作；不跳过回复功能。`ScopedThreadedReplyRegression.xcresult`、`scoped-reply-regression.log` 的定向回归通过。该变更仅影响审查测试，不改变 build 7 发布代码。

## Build 8 circuit parameters

The bundled parameter module retains website validation and local draft saving, replacing desktop anchor placement with an independent bottom sheet. A keyboard or offscreen symbol no longer dismisses editing. Visible viewport bounds constrain the panel; compact layout prioritizes 44 pt inputs and scrollable hints. Closing the panel blurs input. No production website modification is needed.

27 unit tests passed in Build8ClientVerification.xcresult. That run had an early landscape UI assertion failure and is not an overall success. Final circuit and code/tool UI reviews (2 tests) passed in Build8FinalUIReview.xcresult after waiting for the parameter control to become hittable. Actual software keyboard and landscape parameter screenshots are circuit-native-review/38-component-keyboard.png and 39-landscape-parameters.png. Archive, upload and TestFlight readiness remain separately verified in local artifacts.

## Build 9：网页功能覆盖与手机工作区

2026-10-03，Xcode 27 / iPhone SE 第三代 / iOS 26.0.1 的完整客户端测试在 `Build9FinalClientVerification.xcresult` 中 48 项全部通过：39 单元、9 界面，0 失败、0 跳过。新增测试实际执行会话脚本，验证 AI 发送前同意、撤回中止、偏好跨文档保留与账号隔离；同时检查深链、OAuth 回调、文件复制与取消、发展端受信内嵌页、窄屏表格/表单、晚加载导航和牧场几何。原有最新/热门解析、富文本、原生代码/工具、楼中楼回复和 Max 同意回归保留。测试附带的崩溃报告来自模拟器 SpringBoard 的切换器断言，进程不是 FreeBBS；48 项测试完成，仍不代替真机验收。

截图复查后，文档课程选择改用与原生课程列表一致的行样式，去掉重复箭头与嵌套卡片；`Build9DocumentRowFinalReview.xcresult` 中该实际导航流程再次通过。此后的完整检查以最终提交的 CI 为准。

本地状态核对补充了 Max 模型与后台任务引用、牧场学习选项、工作台提示、成就已看记录及五种语言的代码草稿。恢复和保存仅接受当前账号的明确键，重启后保留、切换账号隔离，拒绝其他账号草稿及凭据键；`Build9PreferencesFinalVerification.xcresult` 中最终源码 39 项单元回归全部通过，随后重建签名 Archive。最终提交与结果由本机 `final-ci-summary.json`、`build9-archive-verification.json` 对应记录。

在线只读复查与新增文档流程在 `Build9EmbeddedAndDocumentsFinalReview.xcresult` 中 41 项全部通过（39 单元、1 在线界面、1 文档界面）。学习世界、羊群广场、探索手册和关于页使用正式网络内容，并确认去掉重复导航和桌面留白；没有执行生产写入。公开复查截图与源码保存在本机 `features-native-review/`，不加入依赖网络的 CI。

目录生成检查覆盖主站 42 个页面、发展端 34 条路由和 68 个目录项；离线渲染资源一致性检查、后端安全 12 项测试及相关 ESLint 均通过。最新 PR 必须在本轮最终提交上完成 macos-26 / xcode-27 两套检查；上一提交 `2f7cf65` 的 [37122849412](https://github.com/Free-BBS/freebbs-web/actions/runs/37122849412) 已全部成功，不能作为 build 9 的通过证据。

复杂功能由完整网页工作区与原生承载层提供，并非全部子控件都改写成 SwiftUI。真实 FREE-BBS 登录账号的校园连接、头像/文件保存、AI 生成、报名、交易、发帖和管理写入尚未现场验收；发布门槛保持不变。功能对照清单见 [FEATURE_PARITY.md](FEATURE_PARITY.md)。

隐私清单已声明 App 内部 UserDefaults（`CA92.1`）与清理自身临时导入文件所需的时间元数据（`C617.1`），并增加用户主动上传的照片/视频类别；权限文案覆盖头像、讨论附件和实验素材。理由与类别依据 [Apple Required Reason API 文档](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons) 和 [Apple 数据类别文档](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype)，plist 格式检查通过。硬件可用时的拍照入口使用系统相机，取消和过期回调不会复用其他上传请求；相机及真实文件提供者的功能验收仍需物理设备。
## Build 11：原生业务页面与底部搜索

2026-10-04。本轮将主站 41 条路由的业务界面改为 SwiftUI，排除发展端；富文本、工具执行、电路画布及外部授权保留受限渲染器。底部菜单改为系统浮动 Menu，独立搜索位于右下角，发布加号使用实色强调底。搜索校验请求版本、查询词、类别与账号，点击结果时收起键盘。底部首页/讨论切换同时清空值导航与视图导航。

测试源码共 46 项单元、12 项界面测试。首轮完整回归中单元 46 项通过、界面 10 项通过；Max 撤回开关因滚动位置未通过，后续检查等待控件完整进入可见区域并保持稳定，保留实际值为 0 和重新显示同意入口的断言。新增工作台/牧场回归发现从首页进入工作台后点击首页无法清空视图导航，已修复并保留回归。失败记录不能作为整体成功证据。

最终源码的 iOS 27 完整测试、小屏定向回归、签名 Archive、分发和 Apple 处理结果分别记录在本机 `native-build11/` 证据与 PR 最新检查；不能以之前版本的通过结果替代。实际结果汇总为 `native-build11-validation.json`。截图包括 47–49（独立搜索、键盘、发布浮层）、50–52（周视图、原生日程表单、牧场计时）。已检查旧首轮截图并补充中文本地化声明，系统空状态随应用使用简体中文。

主站目录/导航、介绍/导引/工作人员和离线渲染资源一致性检查通过。后端文档范围提示中的错误变量修正，相关 28 项测试通过；生产发布通过既有范围限定的备份、哈希校验和健康检查流程，不覆盖整份线上后端。

正式 FREE-BBS 账号的校园连接、交易、报名、发布和管理员写入、真实文件提供者、真机与 VoiceOver 仍须验收。高级功能差异见 `FEATURE_PARITY.md`；正式 App Store 发布门槛保持未完成状态。
