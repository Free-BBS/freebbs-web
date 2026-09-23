# 工作台课程作业与日程

作业模块仅支持同步、检测状态、查看详情和下载附件，不提供作业提交功能。前端没有提交表单；后端拒绝旧提交、上传和提交结果确认接口；学堂请求白名单不包含 `tjzy` 等写入接口。已交状态、已交正文、已交附件、教师反馈和参考答案仍可查看。

## 作业与下载

- 工作台按学期保存作业列表，支持课程及未交、已交、已批筛选。新作业通过“立即同步”获取，“刷新列表”读取已有快照。
- 详情和下载会使用当前用户的学堂会话实时核对。附件必须属于当前作业；下载上限为 50 MiB。
- 不执行学堂 HTML，不加载其中的远程内嵌图片；复杂排版可通过详情页的学堂链接查看。
- 截止时间支持上海本地时间、小数秒和毫秒时间戳。无法识别时间时保留作业并提示待核对；部分同步不会被描述为没有作业。

## 日程 DDL 与完成标记

已同步、截止时间有效的作业自动显示在对应日期的日程表中。提醒直接从当前连接的作业快照生成，按作业标识去重；重新同步后截止时间随之更新。时间待核对的作业不生成 DDL。

点击周视图中的作业提醒，可标记“已完成”或恢复未完成；列表视图提供同样的按钮。完成后提醒保留。已交、已批作业默认显示为已完成，手动标记优先并在刷新、同步后保留。该标记仅记录本站学习进度，不会向网络学堂提交任何内容。

## 数据与运行

- 使用 Node.js 24+ 和已有 direct_cas 配置。
- `048_campus_homework.sql` 创建按用户、连接 generation、学期隔离的作业快照表。
- `049_homework_calendar.sql` 创建按用户、作业标识隔离的本地完成状态表。
- 后端启动会幂等创建这些表。旧测试版本已经创建的提交记录表不再被代码使用，不主动删除历史数据。
- 重新连接后需同步新连接的作业；解绑后旧连接的作业不再显示。

## 接口

所有接口要求本站登录，仅操作当前用户的数据。

| 方法  | 路径                                                                                                           | 用途                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GET   | `/api/workbench/connectors/tsinghua/homework/semesters/:semesterId`                                            | 读取作业快照                                                |
| GET   | `/api/workbench/connectors/tsinghua/homework/semesters/:semesterId/items/:reference`                           | 实时检测状态与读取详情                                      |
| GET   | `/api/workbench/connectors/tsinghua/homework/semesters/:semesterId/items/:reference/attachments/:attachmentId` | 下载所属附件                                                |
| GET   | `/api/workbench/schedule-items`                                                                                | 日程与作业 DDL                                              |
| PATCH | `/api/workbench/homework-deadlines/:reference/completion`                                                      | 保存本站完成标记，正文为 `{ "completed": true }` 或 `false` |

作业查询路由仅允许 GET/HEAD，旧 `/submissions` 和 `/submissions/:id/reviewed` 写请求会被拒绝。日程完成标记使用独立的本地接口。

## 验证

`npm run test:homework` 检查只读学堂通道、已移除的提交接口、状态检测、下载与日程完成状态。浏览器检查使用 `scripts/check-workbench-homework-browser.js`，可通过 `PUPPETEER_MODULE` 和 `CHROMIUM_EXECUTABLE` 指定环境。

2026-09-22：83 项相关回归通过；浏览器模拟检查通过，覆盖无上传表单、日程完成/恢复、刷新保留、零点 DDL 日期、桌面/手机布局和异常时间显示。测试未向学堂提交作业。
