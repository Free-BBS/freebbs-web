# PR #104 审核修正（2026-09-22）

对应 [CBDT-JWT 的审核意见](https://github.com/Free-BBS/freebbs-web/pull/104#issuecomment-5776820527)。
本轮基于 `2694845`，只更新 `fix/community-guide-wallet-reasons-pr`，不修改 main 或执行部署。

## 工作台生成计划

- `/preview` 与 `/confirm` 不再将数值 501 作为 `execute()` 的 `LIMIT ?` 参数。
  查询内联服务端常量 `MAX_EVENTS + 1`，账号与时间继续使用参数绑定；客户端不能影响上限。
- 保留 500 条日程的安全限制、账号隔离、冲突检查及确认写入事务。
- 单测覆盖参数数量与 500/501 边界；新增真实 MySQL 路由用例，验证预览只读、
  确认落盘、重复确认冲突回滚、跨账号隔离和超上限拒绝。
- 明确时间表达的真实 MySQL 路径已验证，不等同于已验证生产 Agent 服务或完成线上部署。

## PR 自动检查与真实数据库

- 新增 `.github/workflows/pr-validate.yml`，所有面向 main 的 PR 都运行共享
  `scripts/ci-validate.sh`；另设独立的真实 MySQL job。
- Actions 固定官方提交 SHA，token 只读，不向 PR 提供生产 secrets、部署环境或凭据。
- CI 补齐工作台测试，并逐个检查 Shell 脚本语法。
- `npm run test:mysql:isolated` 每次创建新的随机临时数据目录，以 `--no-defaults`
  初始化 MySQL，禁用 TCP 与 MySQL X，仅通过专用本地 socket / Windows named pipe 连接。
  在执行测试及关闭数据库前，校验禁用网络状态和实际数据目录归属。
- 测试环境移除继承的数据库目标与 Node 测试过滤参数，不读取应用数据库配置。
  12 个数据库测试入口全部显式启用，并检查真实 TAP 用例名称、零失败、零跳过，
  不接受“所有用例被过滤但文件执行成功”的假绿。
- 正常结束后关闭临时进程，仅清理本次创建的测试目录；失败时保留诊断目录。
  中断处理仅终止本次子进程树及本次数据库，不按进程名终止其他服务。

本地示例（Git Bash；安装目录按实际情况调整）：

```bash
MYSQLD_BIN='D:/Dev/MySQL/MySQL Server 8.0/bin/mysqld.exe' \
PYTHON='C:/path/to/python.exe' npm run test:mysql:isolated
```

Linux 上只需 `MYSQLD_BIN=/usr/sbin/mysqld npm run test:mysql:isolated`。
不要将应用数据库、生产账号或远程数据库地址传给这些测试。

## 实测记录

- 本机 MySQL **8.0.46**，12 个测试文件合计 **70 通过、0 失败、0 跳过**；
  包括真实触发器、余额快照、行锁并发、幂等与回滚，及完整社区接口集成。
- 首次启用历史数据库用例发现旧测试问题，现已修正：Python CLI 中文输出显式 UTF-8；
  白名单锁竞争预期拒绝提前安装断言；匿名帖用例对齐已有登录可见性和已删除帖权限。
  保留并加强游客拒绝、作者信息匿名及事务断言，没有放宽生产权限。
- PR 工作流与隔离保护测试 **10/10**；Python 客户端测试 **7/7**。
- 按完整 CI 清单去重的本机 Node 回归为 150 文件、1514 项：1499 通过、13 条环境条件
  跳过，另有两个未修改的 PDF 测试文件因 Windows 原生访问冲突退出（`3221225477`）。
  在正常本机权限下单独复测仍可复现；不将其隐去或宣称全量测试通过，Linux PR CI 会独立验证。
- 本轮 JavaScript ESLint 无错误（3 条已有警告），Shell 语法与差异空白检查通过。

未访问生产数据库、未发放线上奖励、未创建线上日程，也未触发真实 Agent 请求。
