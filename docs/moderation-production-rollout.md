# 讨论区审核正式上线步骤

本文件对应 2026-10-12 的正式环境适配。部署结构保持 GitHub main 自动部署、应用服务器与 MySQL 数据服务器分离。台式机继续是测试环境。不要把台式机的 config.json、数据库、管理员账号、测试稿件或密码恢复工具上传到正式网站。

## 当前发布边界

- 文字使用 Qwen `qwen3.6-27b`，图片使用 Kimi `kimi-k2.6`；GLM `glm-5.1` 是备选配置，不会在失败后自动重试。
- 政治与心理相关关键词、整句语义信号一律先人工审核；心理求助本身不视为违规。不可读图片、隐私疑点、异常结果继续暂缓发布。
- 正常含图内容可自动发布，同时通知负责人进入图片复核队列。负责人仍可撤回。
- production 使用独立自动审核开关，支持远程 MySQL。所有测试接口保持禁用；不能把测试开关改为 true 来上线。
- 正式发帖与评论需要确认当前数据处理说明，服务端将版本记入稿件快照，时间沿用稿件 created_at。未确认的请求拒绝入库；没有对应确认记录的旧任务转人工，不补送模型。
- 初始化的自动审核控制表默认暂停。已有控制表的暂停状态不会因部署被重置，升级前应在工作台暂停。

## 1. 合并前准备

1. 台式机验收本次更新，包括确认、取消、普通文字、政治/心理待审、含图发布和图片复核。
2. 对照应用服务器实际 systemd 服务、Node 版本、部署目录和外部配置路径；不要打印完整环境变量或密钥。
3. 核对无问芯穹账号/API 协议：处理主体、调用区域、留存期限、训练使用、下游服务及删除方式。官方[隐私政策](https://docs.infini-ai.com/legal/privacy.html)和[服务协议](https://docs.infini-ai.com/legal/terms-of-service.html)可作核对起点，但不能据此承诺 API 不留存、不训练或 30 天同步删除。相应安排需要运营方核实；确认前保持正式自动审核关闭。
4. 管理员确认网站数据告知内容与实际安排一致，并指定审核负责人。既有网站的隐私说明、联系方式及备份保存安排也要同步核对。
5. 备份正式数据库、外部环境配置、公开上传和已有私有审核目录；记录当前成功部署的 GitHub commit。确认备份可读取且有恢复方式。
6. 新版分支走 PR 检查，通过后再合并 main。合并会触发现有部署流程，不要为了预检查手动运行 Deploy 工作流。

## 2. 首次部署：保持原有发帖流程，先验证服务

正式配置文件默认是 `/etc/free-bbs/free-bbs.env`。先保持：

```dotenv
DISCUSSION_MODERATION_ENVIRONMENT=production
DISCUSSION_MODERATION_ENABLED=false
DISCUSSION_MODERATION_AUTO_ENABLED=false
DISCUSSION_MODERATION_PROVIDER_REVIEWED=false
DISCUSSION_MODERATION_AI_TEST_ENABLED=false
DISCUSSION_MODERATION_AUTO_TEST_ENABLED=false
DISCUSSION_MODERATION_NOTICE_TEST_ENABLED=false
DISCUSSION_MODERATION_AUTO_MODEL=qwen3.6-27b
DISCUSSION_MODERATION_BACKUP_MODEL=glm-5.1
DISCUSSION_MODERATION_AUTO_IMAGES_ENABLED=true
DISCUSSION_MODERATION_IMAGE_MODEL=kimi-k2.6
DISCUSSION_MODERATION_DIR=/var/lib/free-bbs/moderation-private
```

保留已有的真实 `PUBLIC_WEB_URL`（HTTPS）、`BACKEND_IP`、数据库端口/账号、认证与加密密钥、无问渠道及其他配置。不要用本文件覆盖整个 env 文件。API_HOST 保持 127.0.0.1，由网站代理转发。

确认服务用户确为 freebbs-backend 后，应用服务器创建持久私有目录：

```bash
sudo install -d -o freebbs-backend -g freebbs-backend -m 0700 /var/lib/free-bbs/moderation-private
```

目录位于代码和公开上传目录之外，不配置 Nginx 静态映射。新版部署脚本另保留旧 `database/moderation-private` 目录作为防误删措施，但 production 不允许继续使用代码目录内的存储。

代码合并后由 GitHub 自动部署。检查 Actions 成功、应用健康、普通登录/讨论及原有学习功能。新增主线功能按原有 CI 构建，不从台式机复制 node_modules 或 development 构建产物。

审核需要的增量结构为 `067_discussion_moderation.sql`、`068_moderation_policy_audit.sql`、`069_moderation_automation.sql`、`070_moderation_image_reviews.sql`。后端启动时会执行其幂等建表；当前自动部署配置不运行全库迁移。若数据库账号无相应权限，由数据库维护人员在备份后应用这些具体文件，检查表结构再启动。不要重导测试库，也不要为了这四张迁移而重放所有历史 SQL。其他主线迁移仍按原项目流程处理；迁移记录以完整文件名区分，同号不同文件不能混为一条。

注意：即使审核开关关闭，后端初始化也会建审核表并首次从管理员中初始化负责人。合并前仍需数据库备份和权限核对。

## 3. 开启人工审核，验证正式数据路径

将 `DISCUSSION_MODERATION_ENABLED=true`，`AUTO_ENABLED` 仍为 false。此时新提交会等待人工决定；安排负责人在线，避免正常用户长时间等待。重启后端，运行只读检查：

```bash
sudo systemctl restart free-bbs-backend
curl --fail --silent --show-error http://127.0.0.1:3001/api/health
sudo bash -c 'set -a; . /etc/free-bbs/free-bbs.env; set +a; exec runuser -u freebbs-backend -- /usr/bin/node /data/www/free-BBS/scripts/moderation-production-preflight.js'
```

脚本只查询表名、负责人数量、暂停状态和路径可访问性，不调用模型、不执行迁移、不打印数据库口令/API Key。`--configuration-only` 可跳过数据库连接；退出码 2 表示尚未具备验收条件，不代表脚本写入失败。

在正常 HTTPS 网站验证：普通账号可见“我的提交”、不可见负责人入口；直接访问负责人接口仍被拒绝；提交前有告知、取消保留草稿；负责人能收到通知并查看私有图片，未登录或非授权用户读不到图片；人工通过、拒绝、撤回均正常。

## 4. 开启自动审核验收

确认供应商安排和数据告知已落实后，再将 `DISCUSSION_MODERATION_PROVIDER_REVIEWED=true`、`DISCUSSION_MODERATION_AUTO_ENABLED=true`，重启后端。再次只读预检查，先确认 `paused=true`、负责人数量大于 0。管理员在工作台开启自动审核。

只用网站管理人员的虚构验收内容各测一次：普通建议、明确违规、政治关键词、心理求助、正常图片、不可读图片。核对 Qwen/Kimi、通知和最终发布状态。含图自动通过后务必验证图片队列与撤回。不要在正式网站跑批量模型评测或把真实学生内容加入测试样例。

若仅放开文字，可暂设 `DISCUSSION_MODERATION_AUTO_IMAGES_ENABLED=false`；含图内容仍转人工。后台没有自动切换到 GLM 的机制，供应商故障时转人工，后续更换模型需要重新验收。

## 5. 故障处置与回退

优先在工作台暂停自动审核，保持人工处理。若后台不可访问，先停止后端，核对任务及暂停状态后再恢复；不要直接启动第二个 worker。模型故障、未知类别或结果校验失败不能当成通过。

仅需停用模型时设 `DISCUSSION_MODERATION_AUTO_ENABLED=false` 并重启，保留 `DISCUSSION_MODERATION_ENABLED=true`，新稿件继续人工审核。不要同时关闭总审核开关来处理模型故障，否则会回到原有直接发帖路径。

代码回退使用合并前记录的正式发布版本，按原部署流程操作；回退前停止自动 worker。保留审核表、私有图片、公开上传和最新数据库。不要删除新表，也不要用上线前数据库备份覆盖上线后新增的正常帖子与账户；如必须恢复数据，需单独制定差异恢复步骤。

证据清理、备份保留和供应商留存是三件事。本站 30 天清理任务不代表备份或供应商副本也同时清理。上线后检查待审积压、图片复核队列和错误日志，由负责人安排日常值守。
