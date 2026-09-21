# Max 深入导览：功能小站与本地演示

本文核对的是 `freebbs-web-onboarding` 独立工作区的现有页面和后端，不借用学习区分支的未合入功能。配置在 `public/max-guide-stations.js`，当前有 12 站、43 步；本地预览复用这些真实前端页面，而不是另外画一份示意网站。

## 每站介绍什么

| 站点       | 当前可介绍、可查看的功能                                                                    | 边界与尚未开放内容                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页       | 常用入口；永久保留的「认识 FREE BBS」手册入口                                               | 首页入口不表示全部规划均已上线；发展端仍逐步建设                                                                                             |
| 学习世界   | 整片轨道、中央星球与箭头；数学岛概览；课程轨道；高等微积分入口                              | 数学、电路、信号有课程入口；物理、计算机、实验岛标记建设中，不能进入不存在的课程                                                             |
| 课程地图   | 章节目录；知识点聚焦；关联图谱和关系说明；进入具体知识点                                    | 以实际发布节点为准；不承诺课程已经覆盖全部内容、自动评测或教学完成度                                                                         |
| 知识点     | 基础信息/实际应用概览；Markdown 正文与公式、图片、代码；知识标签；前后知识点；侧栏 Max/讨论 | 基础信息和应用只显示作者实际填写的内容。学习资源、学习反馈、继续学习、个人笔记、参与共建目前是预留接口；知识起源只有可折叠外壳，正文仍在开发 |
| 讨论       | 版块与筛选；优先读一篇置顶帖；正文、回复与反应；编辑器；评论里的 `@Max`                     | `@Max` 在发表包含独立提及的评论/回复后才触发答疑，单独写在发帖正文不触发。管理操作按权限显示；导览不发表、不表态、不调用 AI                  |
| 问问 Max   | 当前对话；问题输入；支持的附件入口；可用模型与推理选项；历史对话                            | 能力由实际模型配置决定；不能承诺每个模型都支持所有附件。导览不选文件、不上传、不发送，也不把 AI 回答当作正确性保证                           |
| 工作台     | 周计划与列表；AI 计划生成→预览→确认添加的入口；重要事项；通知标签、搜索与筛选               | AI 生成和校内连接需要实际服务条件；本地预览不连接它们。没有把计划自动写入日程，也不自动打开会标记已读的通知                                  |
| 商城       | 商品分类、当前价格、物品端详、适用规则与购买限制                                            | 只介绍已上架商品，不替用户购买；价格可能有阶梯、组合支付或限额，以当前账号显示为准                                                           |
| 仓库与账本 | 已有物品；普通/黄金鱼骨回收小站；可滚动钱包账本、筛选与加载更早记录                         | 普通鱼骨 1 磁元/根、黄金鱼骨 10 磁元/根，独立于普通物品网格。坚硬鱼骨购买规则不变。卖出不会增加花费热力；未记录的历史不补造                  |
| 设置       | 字体/字号预览；全局明暗切换说明；头像、网页、简介、昵称与密码设置；前往自己主页             | 姓名由管理员修改；昵称费用/免费周期以实际提示为准。导览不填密码、不保存资料、不上传头像、不改阅读偏好                                        |
| 个人主页   | 公开身份/简介；自己的装扮管理；公开藏品；Max 牧场与实际规则                                 | 必须使用当前账号 UID；装扮管理仅自己的主页可见。导览不领养、喂养、装备、领取或赠送                                                           |
| 随身手册   | 五项探索任务；当前功能介绍；未来计划；重看导览入口                                          | 新手任务记录探索，不代表成绩或货币奖励；深入评测等 V2 想法仍待后续论证，不能描述为已开放                                                     |

## 真实路由与可靠定位器

路由按 pathname 匹配，但课程、知识点、个人主页必须保留实际查询参数。不能为了演示把线上链接硬编码为本地示例 ID。

| 页面 / 路由                                | 关键定位器                                                                                                                                             | 安全操作                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `/`                                        | `.home-actions`、`a[href="/guide"]`                                                                                                                    | 打开同站链接                                                         |
| `/world` 全区                              | `.world-orbit-shell`、`#world-core`、`[data-orbit-step]`                                                                                               | 切换轨道；整区聚光避开外层大片留白                                   |
| 数学岛 / 在建岛                            | `.island-orbit-item[data-world-id="mathematics"]`、`[data-world-id="physics"]`                                                                         | 打开领域概览；在建星球只说明状态                                     |
| 领域概览                                   | `#world-modal[open] .world-modal-intro`、`#world-enter-island`、`#world-discussion-link`                                                               | 原生 dialog；进入课程轨道或相关讨论                                  |
| 课程轨道                                   | `#island-course-stage:not([hidden])`、`a.island-course-planet[data-course-slug="math"]`、`#island-course-back`                                         | 跟随真实课程 href；返回领域                                          |
| `/course?course=<slug>`                    | `#course-map-canvas`、`[data-reader-node-id]`、`.course-map-focused-chapter`、`.course-reader-study-link`                                              | 首次点节点聚焦；再点同节点会进入阅读。导览使用明确的「进入学习」链接 |
| 图谱解释                                   | `[data-course-map-arrow-help-toggle]`、`[data-course-map-arrow-help-panel]`                                                                            | 打开/关闭只读关系说明                                                |
| `/knowledge?course=<slug>&point=<node-id>` | `#knowledge-overview:not(.hidden)`、`#knowledge-start-reading`、`#knowledge-body`、`#knowledge-return-overview`                                        | 切换概览/正文；不得把元素存在误判为可见                              |
| 知识工具与陪伴                             | `#knowledge-tools`、`#knowledge-chat-panel`、`#knowledge-chat-tab-discussion`                                                                          | 切换到只读课程讨论；不点学习标签或快捷 AI 提问                       |
| `/discussion?board=<slug>&post=<id>`       | `.discussion-feed-toolbar`、`#discussion-post-list`、`[data-action="open-post"]`                                                                       | 读列表与具体帖子；没有帖子时允许跳过                                 |
| 帖子详情与编辑器                           | `#discussion-detail`、`#discussion-comment-form`、`[data-action="close-detail"]`、`#discussion-create-toggle`、`#discussion-compose-form:not(.hidden)` | 只展开/关闭；不 submit，不点击反应/管理按钮                          |
| `/aichat`                                  | `#aichat-thread`、`#aichat-form`、`.max-composer-tools > summary`、`#aichat-dialog-toggle`、`#aichat-dialogs`                                          | 展开对话选项或历史抽屉；不发送/新建/删除对话                         |
| `/workbench`                               | `#workbench-plan-tab`、`#workbench-week-grid`、`#workbench-agent-form`、`#workbench-priority-list`                                                     | 浏览日程与入口；tab 用 `aria-current="page"`，不是 aria-selected     |
| `/workbench?view=notifications`            | `#workbench-notifications-tab`、`#workbench-notifications-panel:not([hidden])`、`#workbench-notification-list`                                         | 切通知标签；不自动打开通知或同步外部账号                             |
| `/electromagnetic`                         | `#shop-grid [data-action="inspect-item"]`、`#shop-inspect-modal:not(.hidden) .shop-inspect-panel`                                                      | 端详并关闭，不购买                                                   |
| `/inventory`                               | `#inventory-list`、`#bone-recycling`、`#wallet-ledger-open`                                                                                            | 回收只介绍；账本可以安全打开                                         |
| 钱包账本                                   | `#wallet-ledger[open] .wallet-dialog-layout`、`#wallet-ledger-scroll`、`#wallet-ledger-currency`、`#wallet-ledger-more`                                | 原生 dialog；滚动、币种筛选、加载历史只读                            |
| `/settings`                                | `.settings-typography-form`、`#settings-password-form`、`#settings-profile-link`                                                                       | 仅介绍设置，跟随当前账号的主页 href；不点击保存或上传                |
| `/profile?uid=<当前账号UID>`               | `.public-profile-header`、`#public-profile-wardrobe:not([hidden])`、`#public-profile-collectibles`、`#public-profile-ranch`                            | 查看；裸 `/profile` 不是「我的主页」别名                             |
| `/guide`                                   | `#guide-missions`、`#guide-horizon`                                                                                                                    | 任务/未来说明与重新查看导览                                          |

置顶帖优先选择器使用两个互斥分支：有 `.discussion-pin-badge` 时仅匹配置顶卡的打开按钮；整个列表没有置顶标记时才匹配普通按钮。这样不会因为 CSS 逗号选择器按 DOM 顺序返回结果而错选。

## 导览引擎契约

`public/max-guide-stations.js` 同时导出 `window.FreeBbsGuideStations` 与 CommonJS，包含深度冻结的 `STATIONS`、`STEPS` 和 `RELEASE_STEP_IDS`。

- `STATIONS` 含 `id/label/title/route/fallbackRoute`。课程与知识点无上下文时返回 `/world` 选择真实课程；未登录个人主页回退 `/guide`。
- 每一步含 `id/station/route/target/label/title/body/caption`。`action` 是明确审核过的只读 `click` 或 `link`，应先存进度再执行。
- 首页入口、整片世界轨道和课程总览提供 `focus: {fit: 'overview', radius: 24}`，允许引擎暂时等比缩放到可用视口，离开步骤后恢复。其他大列表聚焦具体首项，账本分别聚焦 `.wallet-toolbar` 与 `.wallet-ledger-entry:first-child`，不把整个巨大窗口圈起来；讲解卡文字不随目标缩放。
- `prepare: [{selector, whenMissing}]` 仅安全重开已存在的视图；按顺序执行，并检查目标是否可见。知识点用 `.hidden`，world/workbench 用 `hidden` 属性，dialog 用 `open`，不能混用。
- `emptyTarget/emptyBody` 用于课程、帖子、权限、库存等空状态。没有实际内容就解释并允许跳过，不点击虚构目标。
- World 概览和账本使用原生 dialog top layer；同站返回上一步也可能需要关闭导览打开的弹窗。切站必须清理本次导览打开的模态，但不能清掉用户预先打开的窗口或表单内容。
- 不自动触发发布、AI 生成、上传、购买、出售、装备、喂养、学习标签、校内账号连接/同步、通知已读等写操作。
- `/course` 和 `/knowledge` 从实际 href 保存上下文；从设置进入 `/profile` 跟随实际 UID 链接，不使用示例账号 UID 替代生产账号。

本次新版短游只取 9 个稳定 ID，避免课程/知识点上下文依赖；个人主页使用当前登录账号的真实 UID：

1. `world-atlas`
2. `world-mathematics`
3. `world-island-overview`
4. `workbench-ai-plan`
5. `inventory-recycling`
6. `inventory-ledger-entry`
7. `inventory-ledger`
8. `profile-ranch`
9. `profile-wool`

本次发布记录还处于未发布开发阶段，因此在本轮追加了牧场两步；正式发布后即固定其 `stepIds`，未来更新应追加新的 release，而不是重排本次记录。`profile-ranch` 聚焦 `#public-profile-ranch .ranch-scene` 的 Max 与茅草屋，`profile-wool` 聚焦 `.ranch-wool-stages` 的剪取/摩擦区域，避免整块超长牧场遮挡视口。未拥有 Max 时回退到 `#public-profile-ranch` 解释前置条件；每累计5次有效喂养长1份羊毛，按北京时间每天最多剪1份，其余待剪量保留，次日零点恢复机会。当天再剪提示「Max 被薅秃了，明天再来吧。」；剪下后使用7磁元购买的永久橡胶棒摩擦，每份换2电元。导览只讲解，所有操作仍需用户自己触发。

## 纯内存预览补齐范围

运行 `npm run preview:onboarding`，默认 `http://127.0.0.1:3120/`。仍然只有回环地址，没有生产 `.env`、数据库、真实 AI 或校内服务连接。

- 数学、电路、信号三个既有课程 slug 各提供 4 个明确标注「本地演示」的知识点。沿真实前端路线可到 `/course?course=math`，再由实际地图链接进入 `/knowledge?course=math&point=MA-01-1`。
- 地图边用生产消费的 `type: 'ordered'` 与有效 source/target；节点沿用生产 `position`、`hasDocument` 结构。`sections.knowledgeMarkdown/basicInfoMarkdown/applicationsMarkdown` 驱动现有阅读器，非另加假资料工具。
- 知识点正文只有清楚标注的示例文字、公式和本地课程/讨论链接。没有伪造上传附件、笔记系统、学习资源库或知识起源正文。
- `daily/math/signal/circuit` 四个讨论版块各一篇演示帖子。日常帖 101 为置顶使用说明，并提供一条明确标注的演示评论；课程节点关联正确的课程版块。未解答筛选可以得到真实空态。发表评论和 `@Max` 请求仍被预览拒绝。
- 导览进度按 version 存入 Map，并直接复用后端 `createOnboardingService`：`max-v2`、历史 `max-v1` 和 `guide-depth-2026-09` 各自保留进度。新版基础导览只继承历史任务收据，不继承 seen/status/step；新版短游没有新手任务。读取进度本身不把欢迎记为已读。
- 鱼骨买卖、余额快照账本仍沿用已有内存事务模拟，与本次新增阅读演示相互独立。
- 牧场初始已有 Max 与10条小鱼、没有橡胶棒。可用真实商城服务以7磁元购买限购1根的橡胶棒，沿现有个人资料 API 完成「喂5条鱼→剪1份羊毛→摩擦换2电元」；每天最多剪1份，第二轮须跨北京时间午夜，超额待剪量保留。自动测试注入时间验证午夜边界，浏览器预览使用实际时间。羊毛仅保存在牧场，棒始终保留，公开主页实时读取同一内存状态。
- 重启预览会清空这些账号与进度模拟。浏览器字体、主题等真实前端偏好可能仍存于浏览器；本地演示不等于正式发布已产生的数据。

## 校验与验收

```bash
node --test scripts/preview-onboarding.test.js backend/onboarding.test.js
npm run test:onboarding
```

新增自动检查覆盖版本隔离/历史任务合并/无效版本拒绝、三个真实课程入口的节点与章节字段、讨论版块映射与只读评论、写操作拒绝、UMD 契约、稳定步骤 ID、只读 action 白名单以及真实客户端/生产 router/preview 的鱼骨售卖 URL 一致性。

人工浏览器还需按最新 43 步逐项检查：跨页后继续、返回上一项、直接跳站、刷新后 prepare、无内容时跳过、原生弹窗 top layer、明暗主题及窄屏的聚光边界；确认不会自动发送 AI 或产生资产、资料和密码变化。本文件不把旧版 10 步浏览器验证当作新版 43 步已验收，也不宣称未经浏览器核查的视口兼容性。
