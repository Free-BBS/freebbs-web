# PR #97 审核意见修复与验证

对应审核版本：969db7e367ef6d74730fb134df6bf3d3ea5cd0ea。
审核意见：https://github.com/Free-BBS/freebbs-web/pull/97#pullrequestreview-5213145157

## 修复

1. callApi 在访问可选浏览器组件前检查 window 是否存在。原有 5 项电路 API 成功、HTTP 错误及流式错误断言不变，新增浏览器组件存在/缺失的兼容测试。
2. awardMagnetic 在账户锁保护下对奖励回执及当日奖励明细使用 SELECT ... FOR UPDATE 当前读，替代可能使用旧快照的普通读取及 SUM。事务已提前建立 REPEATABLE READ 快照时，仍按最新已提交记录去重和封顶。
3. 新增可复现的真实 MySQL 回归：两个事务先读取互动表建立快照，再对同一账户奖励；已有 2 磁元时结果必须为 1 和 0。另验证同来源精华奖励去重、精华奖励独立和下一日额度。

## 本地验证

- 修复前：5 项 circuit-api-errors 测试全部失败；真实 MySQL 旧快照并发测试返回 [1, 1]，复现越过每日上限。
- 修复后：按 scripts/ci-validate.sh 逐项运行所有 Node 测试命令、Node 语法检查、Shell 语法检查、必需文件检查和 SQL 安全检查。Node 合计 1059 项：1052 通过，0 失败，7 跳过。
- Python course-upload-client：7 项通过。
- 新 MySQL 回归实际启用并通过，没有计入跳过。使用 MySQL 8.0.46、REPEATABLE READ、独立临时数据库、关闭 TCP 的本地命名管道；未连接生产数据库。测试完成后关闭实例。
- 按 package-lock.json 离线 npm ci 安装本工作区依赖后完成上述验证。最初仅使用相邻工作区 NODE_PATH 的尝试存在静态资源/ESM 依赖缺失，不计为验证通过。
- 修改的 JavaScript 通过 ESLint 错误检查及 Prettier；git diff --check 通过。
- 未运行生产部署或新的完整浏览器视觉验收。7 项原有可选集成测试仍需对应环境，不将它们视为通过。

## 真实 MySQL 回归入口

命令为 npm run test:economy-mysql，已列入 CI 清单。
默认不连接数据库，测试标记为跳过；执行者需准备独立、允许丢弃的本地 MySQL 实例，关闭 TCP 并启用命名管道。
设置 RUN_ECONOMY_MYSQL=1、ECONOMY_MYSQL_SOCKET 为该实例的命名管道路径后执行。
测试使用该临时实例的 root 空密码账户，创建名称以 pr97_rewards_ 开头的全新数据库；不读取应用 DB 配置，也不删除既有数据库。切勿指向正式实例。

本次不增加数据库迁移，不调整商品价格，不改动封存的学习区。
