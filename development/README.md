# FreeBBS 发展端

FreeBBS 发展端是挂载在主站 `/development/` 路径下的独立业务子页面。它复用主站登录身份，为组织传承、信息咨询、趣缘群体、活动协作、联络资源、体育代表队和财务治理提供统一入口、细粒度权限与可持续扩展的模块框架。

> 新加入项目，或准备让 Codex 继续工作？请先完整阅读[协作与交接指南](./docs/handoff.md)。其中记录了当前进度、职责边界、未完成事项、接手顺序和 Codex 开工规则。

## 组织风采内容（2026-10-16）

侧栏“风采展示”沿用 `/development/organizations`。首页复用五组小羊形象，按组织与兴趣检索部门；部门页优先展示组织自己维护的 HTML，没有上传主页时展示本轮整理的策展内容。现有主页编辑权限、版本冲突和准确的部门活动关联继续由原接口处理。

本轮接入 14 组投稿：7 组文档与照片编排为原生页面，7 组已有静态网站保留完整作品、报告、拼贴诗与音视频，在隔离小窗内浏览并支持全屏。调研组使用 `/organizations/youth_league/research` 独立只读展区，未增加身份角色，也不借用实践组的管理权限或活动接口。未收到本轮投稿的既有部门仍保留目录和原简介。

内容数据在 `apps/web/src/modules/organizations/showcase/`，公开素材在 `apps/web/public/organization-showcase/`，正常构建无需原始投稿目录。原站脚本不运行在主站页面上下文；小窗不授予同源访问权。人文组草稿与留言在隔离环境仅临时保留，作品可导出，页面有对应提示。音视频需主动点击播放，硬件部完整比赛视频未裁剪。

已有上传主页继续使用原来的限制性 CSP 与隔离文档组件。尺寸桥接同时核对当前视窗、内容版本和文档代际，丢弃异步到达的旧尺寸，避免含 `100vh` 的模板反复撑高；真实内容展开、收起和宽度变化仍会重新测量。

素材重建脚本位于主站根目录 `scripts/prepare-department-content.mjs` 和 `scripts/prepare-submitted-showcases.mjs`。前者可用 `SHOWCASE_SHARP_PATH` 指定 Sharp；后者接受 `--source`、`--sharp-root`，并可通过 `--ffmpeg`、`--python`、`--python-tools` 优化完整音乐和字体。重建会从原投稿重新生成公开副本，不修改原稿；修改生成页面时也要同步重建脚本，避免下次生成丢失修正。

部署时必须原样服务 `/development/organization-showcase/`，缺文件返回 404，不能退回 SPA，也不能注入主站页面脚本。主站 Node 服务已有专用处理器；Nginx 模板已提供专用 location、字体 CORS、正确媒体 MIME 和 `SAMEORIGIN` 框架头。音视频需支持 HTTP Range，允许拖动进度；公开素材的 CORS 不应用于 API、私有上传或身份响应。上线仍需按原发布流程验收，本轮仅完成本地实现与验证。

目前已知投稿缺项：权益发展中心未提供联系人邮箱；智能策划部未附正文指定的无人机比赛图片。页面不补造联系人或照片，权益建议可进入现有公开提案池。调研组历年报告 `archive-08.html` 有与原 DOCX 一致的缺字，例如“3个.”处时间单位缺失；本轮保留原文，需原作者核对。

## 当前阶段

平台 MVP 已经形成完整的 React Web、版本化 API、共享契约、内存/MySQL 数据模式、权限与 Tag、审计、测试和部署基线。经验库、信息与咨询、趣缘群体、活动、联络资源、体育代表队、财务治理及权限管理模块均已有可运行入口。

统一模块框架进一步把信息、活动、联络揭榜和体育拆分为可直接刷新列表/详情路由；工作台保持简短概览，完整模块入口只在侧栏出现。数据库迁移 `008` 补齐各模块可读性字段，迁移 `009` 建立联络真实问题、并行团队、动态和版本化成果。实现细节见[统一模块框架技术说明](./docs/technical_design.md)。

这些描述表示代码能力已经存在，不表示生产环境已经上线。主站真实身份联调、生产数据库、服务器首次引导、部署凭据、正式发布和线上验收仍需按交接指南重新核验。

## 五分钟本地预览

要求 Node.js `>=20.19.0`。从主站仓库根目录进入发展端 npm 工作区，再执行以下命令；如果已经在 `development/`，省略第一行。

```powershell
cd development
npm ci
npm run dev
```

然后访问：

- Web：`http://localhost:5173/development/`
- 工作台：`http://localhost:5173/development/dashboard`
- API 健康检查：`http://127.0.0.1:3100/api/development/v1/health`

本地默认使用可重置的 `memory + demo` 数据。完整的演示身份、MySQL 联调和 Windows 常见问题见[本地开发与完整预览](./docs/local-development.md)。

提交前在同一个发展端工作区运行：

```powershell
npm run check
npx playwright install chromium
npx playwright test
npm run test:mysql
npm run test:e2e:production
```

默认 E2E 使用 `memory + demo`；`test:mysql` 与 production E2E 需要本地或 CI 提供 MySQL。缺少 MySQL 时应把这两项报告为未验证，不能把内存模式结果当作生产数据库结果。

## 模块与责任边界

- 平台核心组维护主站身份、统一权限、Tag、共享契约、审计、模块注册和部署基线；
- 各领域团队维护本模块页面、接口和业务数据，例如体育中心维护代表队、权益发展中心维护提案池、联络中心维护趣缘群体；
- 领域模块必须复用统一身份、权限和审计，不能另建账号系统或直接读取其他模块数据；
- 涉及公共契约、权限模型、数据库基础设施或生产部署的变更，应先由平台核心组评审。

详细模块分工和认领要求见[协作与交接指南](./docs/handoff.md)与[总体技术设计](./docs/overall-technical-design.md)。

## 文档入口

- [协作与交接指南](./docs/handoff.md)：新协作者和 Codex 的第一入口；
- [文档索引](./docs/README.md)：按角色选择阅读路径；
- [总体技术设计与开发分工](./docs/overall-technical-design.md)；
- [统一模块框架技术说明](./docs/technical_design.md)：路由、迁移、联络审核、公私响应和扩展边界；
- [本地开发与完整预览](./docs/local-development.md)；
- [服务器部署与运维](./docs/server-deployment.md)；
- [数据库与业务数据管理](./docs/data-administration.md)；
- [生产发布与数据恢复检查清单](./docs/production-release-checklist.md)。

截至 2026-08-20，上述长期运维文档由开放的 [PR #2](https://github.com/Free-BBS/Free-bbs-Development/pull/2) 恢复；开始工作前请重新确认 PR 与远程 `main` 状态，不要依据旧的本地检出目录判断进度。

## 相关入口

- [FreeBBS 主站](https://www.free-bbs.cn/)
- [FreeBBS 主站源码](https://github.com/Free-BBS/freebbs-web)
- [发展端源码](https://github.com/Free-BBS/Free-bbs-Development)
