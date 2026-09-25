# 统一模块框架技术说明

本文记录 2026 年秋季统一模块框架的实际实现约定，供继续开发页面、API 和数据库的协作者使用。平台定位、职责与权限原则仍以[总体技术设计](./overall-technical-design.md)为准；本文重点说明路由、增量迁移和联络揭榜的数据边界。

## 页面与路由

Web 统一挂载在 `/development/`，API 统一挂载在 `/api/development/v1/`。登录后 `/development/` 默认跳转到工作台。工作台只展示平台说明、少量行动提示和最近公开内容，不复制侧栏中的完整模块导航，也不在侧栏增加“工作台”按钮。

| 模块         | 列表或默认路由               | 详情与子路由                                                                                                        |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 经验库       | `/knowledge`                 | `/knowledge/:entryId` 阅读页；卡片筛选与编辑抽屉；社工分区通过 `audience=social_org` 保留                           |
| 信息与咨询   | `/information/announcements` | `/information/consultations`、`/information/triage`、`/information/proposals`、`/information/proposals/:proposalId` |
| 个人成长档案 | `/growth`                    | `/interest-groups` 与 `/clubs` 旧地址跳转到成长档案；统计接口为 `/growth/summary`                                   |
| 活动         | `/events`                    | `/events/:activityId`                                                                                               |
| 联络揭榜     | `/liaison`                   | `/liaison/problems/:problemId`                                                                                      |
| 体育代表队   | `/sports`                    | `/sports/:teamId`                                                                                                   |
| 财务治理     | `/finance`                   | 继续使用既有财务工作流，不在本轮扩字段                                                                              |
| 平台治理     | `/admin`                     | 仅 `platform.super_admin` 可见并可访问                                                                              |

嵌套路由由同一 `AppShell` 承载。侧栏按照模块根路由保持选中状态；无权访问 `/admin` 的用户会回到 `/dashboard`。新增详情页时应继续使用模块根路径作为前缀，避免另建一套导航状态。

## 数据迁移

迁移文件只增不改，生产发布按文件名顺序执行：

- `008_module_readability_fields.sql` 为经验库增加分类、标签、摘要、维护时间与维护人，为咨询和提案增加期限，为趣缘群体增加分类与公开联系方式，为活动增加报名截止、人数上限与联系人，为体育代表队增加赛季与训练安排。迁移先回填知识库 `tags`，再设为非空，兼容既有记录。
- `009_liaison_problem_board.sql` 新增真实问题、参与团队、团队成员、问题动态和版本化成果五组表，包含问题—团队—成员/动态/成果的复合外键、查询索引和成果版本唯一约束。

迁移由 `npm run db:migrate` 执行；CI 和发布前的 `npm run test:mysql` 会连续执行两次迁移，再运行 MySQL 适配器集成测试，以验证迁移幂等记录和内存/MySQL 语义一致。没有可用 MySQL 服务时必须明确记录“未验证”，不能用 memory 测试代替。

## 联络揭榜审核配置

首期只由联络中心代录问题。代录者使用 `liaison.problem.create`、`liaison.problem.update` 和 `liaison.problem.submit_review`；审核者必须单独拥有 `liaison.problem.review`。审核权不由 `admin.manage` 推导，联络中心负责人也不会仅凭维护身份自动获得审核权。

当前内置权限目录把审核动作授予两类角色：

- `platform.super_admin`：对应发展端最高负责人；
- `affiliation.tuanwei_lead`：对应团委书记或团委负责人。

生产中先把主站 UID 同步为发展端 `subject`，再通过治理台或管理员初始化流程给指定账号授予上述角色。两位审核人任意一人即可批准或驳回；服务端记录实际审核人、时间和审计事件。不要把真实 UID 写死到代码、迁移或环境模板中。若未来需要把“发展端负责人”从最高管理员角色中拆分，应新增显式角色或 subject 级权限绑定，并保持 `liaison.problem.review` 这一动作不变。

## 公开与内部响应

联络问题的数据库记录包含 `internalContactNote` 和 `reviewNote`，但普通同学的列表与详情响应由服务层 `ProblemProjection` 投影后返回，明确移除这两个字段。记录所有者、拥有问题维护权限的用户和拥有审核权限的用户才会收到内部字段。前端模型把内部字段声明为可选，并且不能通过类型断言把公开响应强制转换成完整内部记录。

相同原则适用于其他模块：公开列表只返回阅读所需字段；个人咨询、组织资料、队伍成员和财务记录仍由服务端按 action、resource 和 scope 判断。前端隐藏入口不是数据边界。

## 外部投稿的兼容扩展

第一阶段不创建企业或课题组账号，也不允许外部主体直接写入正式问题表。未来增加外部表单时，应新增独立的 `external_submission` 输入资源和限流、验证码或签名校验，把提交保存为不可公开的待处理记录。联络中心确认来源、脱敏并补全内部信息后，再调用现有代录流程创建 `draft`，随后继续使用 `draft → pending_review → open/rejected` 审核链。

这样扩展不会改变现有问题、团队、动态和成果 API，也不会让外部提交者获得发展端身份或读取权限。外部表单只能提交候选材料，不能直接设置 `reviewerUid`、状态、内部权限或公开范围。

## 验证命令

从仓库根目录执行：

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run check
npm run test:mysql
npx playwright test tests/e2e/modules.spec.ts tests/e2e/responsive.spec.ts tests/e2e/knowledge.spec.ts tests/e2e/information.spec.ts tests/e2e/growth.spec.ts tests/e2e/events.spec.ts tests/e2e/liaison.spec.ts tests/e2e/sports.spec.ts tests/e2e/finance.spec.ts tests/e2e/permissions.spec.ts
npm run test:e2e:production
```

默认 Playwright 配置使用 `memory + demo`，覆盖桌面导航和响应式视口；production 配置使用构建产物、主站身份 stub 与 MySQL，覆盖真实认证形状、治理台和发布冒烟。Windows 已安装系统 Chrome 但未安装 Playwright Chromium 时，可以在本地设置 `PLAYWRIGHT_USE_SYSTEM_CHROME=true`，这不会改变 CI 的浏览器配置。

提交前还应搜索临时占位文字、无检查的 public/internal 类型断言和遗留 `/clubs` 页面导入。旧 `/clubs` 与 `/interest-groups` URL 只作为路由兼容层保留，业务入口和模块清单统一使用 `/growth`。
