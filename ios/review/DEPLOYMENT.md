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

构建为版本 `1.0.0`、build `1`，Xcode `27.0`（`27A266a`）、SDK `iphoneos27.0`。主图标为原生分层 `FreeBBSIcon.icon`（绵羊与知识轨道）。automatic signing 的 Archive、Cloud Managed Apple Distribution 导出与上传均成功；签名具备 `beta-reports-active`，`get-task-allow` 为 false。

2026-10-03 17:13 CST，Xcode 返回 `Upload succeeded` 和 `EXPORT SUCCEEDED`。随后在 [TestFlight](https://appstoreconnect.apple.com/teams/b6657e16-3de4-4dd1-acf0-711b662c81c3/apps/6818750003/testflight) 核实 Apple 处理完成，版本 1.0.0、构建 1 显示「内部」「准备测试」，有效期 90 天。构建 ID 为 `cf68eff7-e3f6-467f-bfae-bc922ad281de`。仅用于内部 TestFlight：导出参数 `testFlightInternalTestingOnly=true`，没有提交正式审核或发送测试邀请。截图证据 `../artifacts/testflight-ready.png` 仅保存在本机，未提交 Git。

本地生成证据在 `../artifacts/`（Git 忽略）：`FreeBBS-Sheep-Final.xcarchive`、`sheep-export/FreeBBS.ipa`、`ios27-archive.log`、`ios27-export.log`、`testflight-upload.log`、`SDK27ReviewTests.xcresult`、`sdk27-test-summary.json`。不提交签名材料、账号密码或私钥。

13 项客户端测试在 Xcode 27 / SDK 27、iPhone 17 Pro 的 iOS 26.0.1 runtime 上通过。iOS 27 runtime 下载持续停在 Preparing to download，不能将 SDK 编译成功记作 iOS 27 系统运行验证；此门槛仍为 false。

正式提交的剩余条件以 `ReleaseStatus.json` 为准。`check-release.py` 仍应退出 1；内部 TestFlight 上传不应清除运营、真机、隐私问卷和正式截图的门槛。
