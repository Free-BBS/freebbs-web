# 后端部署与内部 TestFlight

日期：2026-10-03。此记录不代表 App Store 正式提交完成。

## 后端

生产服务比原工作区代码更新，发布使用从远端 main `b7c4ac1eafde8f47a0c1567cd4d45e33d8daa2a5` 克隆的 `codex/freebbs-ios-release` 分支。没有用旧工作区覆盖生产后端。首次发布提交为 `fbd0a00b7ea0b9b4e4b3e4adb03bd45eb55c35ce`。

[GitHub Actions 部署 37110357231](https://github.com/Free-BBS/freebbs-web/actions/runs/37110357231) 的 mobile-validate、mobile-deploy 已成功。原有完整部署任务被跳过；范围限定为移动安全模块、增量迁移、两个公开页面、三处幂等入口补丁及部署脚本，只重启后端。生产代码备份为 `.mobile-release-backups/release-20261003-163842-FhOdkB`。

已验证：

- `/api/health` 正常。
- 未认证访问屏蔽、删除申请、管理员举报和删除队列返回 401。
- [隐私政策](https://www.free-bbs.cn/mobile/privacy.html)、[支持页面](https://www.free-bbs.cn/mobile/support.html) 返回 200，下载正文与发布源逐字节一致。
- 公开接口返回 4 个课程、8 个版块；使用实际 Swift Codable 模型成功解析。当前未登录讨论返回 0 条，未伪造数据。
- 12 项后端测试、ESLint 和 Prettier 检查通过；补丁在生产代码副本上的幂等性和缺失锚点失败行为通过。

政策内容是用户批准的草稿，运营主体、AI 提供商、处理与保留期限尚待补齐。生产未执行发帖、举报、账号更改或删除等测试写入；管理员实际处理和删除执行仍须验收。

## 内部 TestFlight 构建

App Store Connect 应用记录：FREE-BBS，Apple ID `6818750003`，Team `Q83556V27Y`，Bundle ID `cn.free-bbs.app`。

此前已确认的内部构建为版本 `1.0.0`、build `4`，Xcode `27.0`（`27A266a`）、SDK `iphoneos27.0`。原生分层绵羊图标保留；本轮加入统一 SwiftUI 页面、原生实验室工作区、讨论最新/热门排序与按账号在本机记住 Max 同意。automatic signing Archive、Cloud Managed Apple Distribution 导出及上传成功。

2026-10-03 18:49:59 CST，Xcode 返回 `Upload succeeded` 和 `EXPORT SUCCEEDED`。随后在 [TestFlight](https://appstoreconnect.apple.com/teams/b6657e16-3de4-4dd1-acf0-711b662c81c3/apps/6818750003/testflight/ios/433e4b75-9f1c-4a8b-80e3-78231542d64f) 核实构建 4 显示「内部」「正在测试」，有效期 90 天，并属于已有的内部测试群组。没有新增测试人员或提交正式审核。

签名构建与上传证据：`FreeBBS-Unified-Final-Build4.xcarchive`、`unified-final-upload/`、`unified-final-build4-archive.log`、`unified-final-build4-upload.log`、`testflight-build4-ready.png`，最终同步至 `../artifacts/`，不提交 Git。构建 1–3 保留为历史内部版本；早期未上传的 build 4 草稿不得代替这次最终 Archive。

导出参数 `testFlightInternalTestingOnly=true`，只用于内部测试。原始签名构建验证含 `beta-reports-active`，`get-task-allow` 为 false；不提交账号密码、签名材料或私钥。

本机 iOS 27 runtime 已完成安装；已有 CI 在 iOS 27 runtime 验证过原客户端，本轮新功能须以 PR 最新的完整检查结果为准。小屏回归使用 SDK 27 与 iOS 26.0.1 runtime，物理设备测试尚未完成。详细范围见 [验证记录](VALIDATION.md)。

正式提交的剩余条件以 `ReleaseStatus.json` 为准。`check-release.py` 仍应退出 1；内部 TestFlight 上传不清除运营、真机、隐私问卷和正式截图的门槛。

## build 5 匿名作者兼容修复

服务端 `anonymousAuthor()` 会返回 `id: null`；旧版客户端要求作者 ID 必须为整数，匿名帖会使整个讨论列表解析失败，已删除回复亦受影响。build 5 将作者 ID 改为可空，保留匿名内容，并仅允许屏蔽有效的真实账号；不丢弃无法解析的帖子来掩盖错误。新增最新/热门混合列表、匿名/已删除回复与非法作者字段的回归测试。签名 Archive 已成功，测试及上传结果见本机证据和 PR 最新检查。

## build 6 兼容性修复

build 6 包含 build 5 的匿名作者修复，并修复 Swift SDK 27 在 iOS 26 runtime 中 `AppStore` 的隐式隔离析构崩溃；API 客户端同样使用无额外清理逻辑的非隔离析构。25 项单元测试通过，小屏 7 项界面流程通过。最终签名构建、上传和可测试状态以本机 `build6-archive.log`、`build6-upload.log`、`testflight-build6-ready.png` 及 `final-ci-summary.json` 为证。

## build 7 电路编辑与预览

移除网页画布的重复安全区域，画布铺满原生导航与工具栏之间的空间。SwiftUI 底部提供「元件」「运行」及停止，刷新移入操作菜单；缩放和状态提示使用紧凑浮层。原生相机随竖屏/横屏改变视口，使用均匀缩放和延展网格；载入已有电路时适配内容，添加屏幕外的新元件会移动视野，重置缩放保留当前中心，并保留双指移动/缩放、导线编辑与完整电路按钮。相机随 App 离线提供，仅在受信任的电路页面安装，无需修改生产网页。

添加元件后不自动遮挡画布，点击元件再打开适配手机的参数面板，输入框保持可见。工具预览改为只载入共享 sandbox 引擎的轻量页面，保留 opaque iframe、阻断网络与无账号/消息桥的隔离；进程终止后重新加载，不把失败渲染记录为完成。

本机截图与测试见 `circuit-native-review/`、`Build7ClientVerification.xcresult` 和 `build7-client-verification.log`（26 项单元与 2 项界面流程，28 项全部通过）。在线电路检查仅加载公开页面与本地临时草稿，没有创建生产账号、发帖或保存线上电路；该项复查源代码作为本机证据保存，不加入依赖网络的常规 CI。签名上传及 Apple 处理结果见 `build7-archive.log`、`build7-upload.log`、`testflight-build7-ready.png`、`final-ci-summary.json`。正式上架门槛保持不变。

## Build 8 circuit parameters

The bundled parameter module retains website validation and local draft saving, replacing desktop anchor placement with an independent bottom sheet. A keyboard or offscreen symbol no longer dismisses editing. Visible viewport bounds constrain the panel; compact layout prioritizes 44 pt inputs and scrollable hints. Closing the panel blurs input. No production website modification is needed.

27 unit tests passed in Build8ClientVerification.xcresult. That run had an early landscape UI assertion failure and is not an overall success. Final circuit and code/tool UI reviews (2 tests) passed in Build8FinalUIReview.xcresult after waiting for the parameter control to become hittable. Actual software keyboard and landscape parameter screenshots are circuit-native-review/38-component-keyboard.png and 39-landscape-parameters.png. Archive, upload and TestFlight readiness remain separately verified in local artifacts.

## Build 9 与当前上传状态

build 7 是最近已确认「内部／正在测试」的版本：[TestFlight 构建 7](https://appstoreconnect.apple.com/teams/b6657e16-3de4-4dd1-acf0-711b662c81c3/apps/6818750003/testflight/ios/36e6091e-4bda-4648-8667-26ab3ddf07cc)。build 8 已由 SDK 27 完成签名 Archive；2026-10-03 20:29 的导出上传失败，日志为 `Failed to Use Accounts`。Mac 锁屏使 Xcode 无法读取上传账号，不能将签名 Archive 视为已上传或 Apple 已处理。

build 9 在原生目录和各核心页面加入完整网站工作区，恢复学习、个人、牧场、商城、活动与发展端等功能，支持原生文件/照片选择、偏好持久化、账号隔离和授权返回。客户端完整本机回归 48 项全部通过，公开工作区只读复查另行记录；详见 [验证记录](VALIDATION.md) 与 [功能对照](FEATURE_PARITY.md)。本轮不修改或重发生产后端。

用户已授权内部 TestFlight 上传，并明确要求先继续代码工作、稍后解锁。锁屏期间不重试账号导出或界面操作；解锁后上传本轮最终签名构建，并独立核实 Apple 的处理与可测试状态。正式上架门槛仍以 `ReleaseStatus.json` 为准。
