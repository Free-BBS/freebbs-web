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

最新客户端回归为 `LabsAndRenderingFinalTests.xcresult`：18 项全部通过（10 个核心合同测试、4 个 WebKit 渲染/安全测试、4 个页面测试）。另有 120 项网页 Markdown、预览及工具嵌入测试全部通过。测试结果与截图保存于 `../artifacts/`，不提交生成物。

本机项目目录受 iCloud 文件占位影响。构建使用 `/tmp/freebbs-ios-source` 中的相同源码副本与 `/tmp/freebbs-ios-derived` 缓存，逐文件 SHA-256 对比未发现源码差异；临时路径不写入工程配置。

## 截图证据

- [iPhone 17 Pro 首页](../artifacts/screenshots/01-home.png)，另有该设备的课程、讨论等页面截图。
- [小屏深色首页](../artifacts/screenshots-small/01-home.png)、[横屏](../artifacts/screenshots-small/12-landscape.png)、[最大辅助字号](../artifacts/screenshots-small/13-accessibility-text.png)。
- [删除账号申请](../artifacts/screenshots-small/17-account-deletion.png)、[隐私草案](../artifacts/screenshots-small/18-privacy.png)、[注册](../artifacts/screenshots-small/20-registration.png)。
- 小屏完整 21 张截图位于 `../artifacts/screenshots-small/`。

截图通过 Debug 的 `--demo` 生成，带有示例标识。测试未向线上发帖、举报、修改账号或删除数据。这些截图用于开发审查，正式商店截图需使用经过验收的 Release 版本及真实内容重新拍摄。

## 尚未验证或完成

1. **iOS 27 验证范围**：本机已安装 Xcode 27 / iOS 27 SDK，签名构建与上传通过。runtime 下载停留在准备阶段，新 SDK 回归仍使用 iOS 26.0.1 runtime；不能当作 iOS 27 系统运行验收。CI 37114209875 已在 iOS 27 runtime 通过（日志含 `iOS 27.0.simruntime`），不能替代物理设备验收。
2. **真机与安装**：Bundle ID、应用记录及签名分发已完成；Apple 已接收内部 TestFlight 包。尚无 TestFlight 安装或物理设备验证证据。
3. **线上认证与写入**：没有使用用户正式账号验证注册邮件、互动验证、发帖、回复、AI、个人资料及校园数据。自动页面测试验证导航和布局，不能替代这些集成测试。
4. **MySQL 与业务验收**：配套模块及迁移已部署，启动初始化和健康检查通过；单元测试使用模拟数据库。实际事务、外键及登录后的管理员队列业务仍须验收。
5. **审核运营**：当前删除功能为密码验证后的申请队列；没有实现真实清除或自动注销。举报只有记录与处理接口，还需核实内容过滤、响应和违规内容处理流程。
6. **隐私与支持**：客服邮箱、URL 已确认；用户批准的政策与支持页面已发布。运营主体、AI 提供商、保留期限、处理期限尚未确认，正式上架前须完善。
7. **辅助功能**：大字和横屏通过自动导航与截图检查；VoiceOver 朗读顺序、减少透明度、硬件键盘及真机键盘交互仍需人工验收。
8. **页面范围**：课程资料没有通过真实文件下载的集成测试；公式、图片、表格、代码和电路/工具/实验结果嵌入已接入共享渲染引擎，电路与代码实验以完整 WebKit 工作区提供。正式账号的实验保存/发布、服务端执行与文件分享仍须端到端验收；商城和后台未迁移。

完整提交前条件见 [App Store 准备](APP_STORE.md) 与 [运营流程](OPERATIONS.md)。只在实际完成并取得证据后更新 `ReleaseStatus.json`。
