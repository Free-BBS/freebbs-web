# FreeBBS 发展端

FreeBBS 发展端是挂载在主站 `/development/` 路径下的独立业务子页面。它复用主站登录身份，为组织传承、信息咨询、趣缘群体、活动协作、联络资源、体育代表队和财务治理提供统一入口、细粒度权限与可持续扩展的模块框架。

> 新加入项目，或准备让 Codex 继续工作？请先完整阅读[协作与交接指南](./docs/handoff.md)。其中记录了当前进度、职责边界、未完成事项、接手顺序和 Codex 开工规则。

## 当前阶段

平台 MVP 已经形成完整的 React Web、版本化 API、共享契约、内存/MySQL 数据模式、权限与 Tag、审计、测试和部署基线。经验库、信息与咨询、趣缘群体、活动、联络资源、体育代表队、财务治理及权限管理模块均已有可运行入口。

统一模块框架进一步把信息、活动、联络揭榜和体育拆分为可直接刷新列表/详情路由；工作台保持简短概览，完整模块入口只在侧栏出现。数据库迁移 `008` 补齐各模块可读性字段，迁移 `009` 建立联络真实问题、并行团队、动态和版本化成果。实现细节见[统一模块框架技术说明](./docs/technical_design.md)。

这些描述表示代码能力已经存在，不表示生产环境已经上线。主站真实身份联调、生产数据库、服务器首次引导、部署凭据、正式发布和线上验收仍需按交接指南重新核验。

## 五分钟本地预览

要求 Node.js `>=20.19.0`。在仓库根目录执行：

```powershell
npm ci
npm run dev
```

然后访问：

- Web：`http://localhost:5173/development/`
- 工作台：`http://localhost:5173/development/dashboard`
- API 健康检查：`http://127.0.0.1:3100/api/development/v1/health`

本地默认使用可重置的 `memory + demo` 数据。完整的演示身份、MySQL 联调和 Windows 常见问题见[本地开发与完整预览](./docs/local-development.md)。

提交前运行：

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
