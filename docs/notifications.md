# 站内通知与邮件

登录后，页面右上角铃铛显示未读数量；点开可以查看通知、逐条已读、全部已读及加载历史通知。管理员在「用户管理」底部发布通知，可指定用户、身份分组、课程管理组或全体用户。课程管理组来自 `course_material_managers`，即对应课程的负责人，不等同于选课学生。

回复会通知帖子作者和被回复评论的作者，同一人去重，不通知回复者本人。点赞、点亮、烟花会通知帖子作者；取消不会通知，同一用户对同一帖子反复切换同一表情只通知一次。通知链接使用帖子公开 ID。

## 邮件投递

每位收件人的站内通知和邮件任务在同一数据库事务中写入。邮件配置沿用 `BOTMAIL_SMTP`、`BOTMAIL_SMTP_PORT`、`BOTMAIL_USER`、`BOTMAIL_PASS`、`BOTMAIL_FROM`；详情链接使用 `PUBLIC_WEB_URL`。站内通知发布成功代表邮件已经入队，实际邮件发送由每 15 秒运行的后台任务处理。

SMTP 未配置、邮箱缺失或发送失败都会保留任务并退避重试（最长间隔一小时）。管理员可在通知表单中刷新邮件状态。数据库仅保存固定错误码，不保存 SMTP 返回的敏感信息。任务带五分钟租约，进程重启后可以继续处理；不同实例通过条件更新抢占同一任务。SMTP 与数据库之间无法提供严格的仅投递一次语义，极少数进程中断可能导致重复邮件；重试会沿用同一 Message-ID。

新站内通知使用 `community_notifications` 和 `notification_email_outbox`，与已有学习工作台的 `notifications`、`user_notification_states` 分开，不修改已有课程同步通知。

## API

所有接口使用 `Authorization: Bearer <登录 token>`，已读与列表接口始终限定为当前用户。

| 接口                                               | 用途                                           |
| -------------------------------------------------- | ---------------------------------------------- |
| `GET /api/notifications?before=<id>&limit=20`      | 按 ID 倒序分页，返回通知、未读数量及下一页游标 |
| `GET /api/notifications/unread-count`              | 未读数量                                       |
| `POST /api/notifications/:id/read`                 | 当前用户的一条通知设为已读                     |
| `POST /api/notifications/read-all`                 | 当前用户的全部通知设为已读                     |
| `GET /api/admin/notifications/audience?q=<关键词>` | 管理员查询用户及课程管理组                     |
| `GET /api/admin/notifications/delivery`            | 管理员查询邮件队列汇总                         |
| `POST /api/admin/notifications`                    | 管理员发布通知                                 |

发布示例：

```json
{
  "title": "课程资料更新",
  "body": "请课程负责人检查最新资料。",
  "link": "/world",
  "requestId": "reuse-this-id-on-retry-123",
  "audience": { "type": "course", "courseId": 5 }
}
```

接收对象还可写为 `{ "type": "users", "userIds": [2, 3] }`、`{ "type": "role", "role": "student" }` 或 `{ "type": "all" }`。身份支持 `student`、`ta`、`teacher`、`admin`；管理员组按 `is_admin` 判断。站内链接不得使用外站地址或脚本 URL。`requestId` 用于同一管理员重试同次发布时按收件人去重。

## 维护与验证

启动时执行 `ensureNotificationTables(pool)`，之后调用 `createNotificationService({ pool }).startWorker()`。回复与点赞业务把现有事务连接作为 `notifyReply` / `notifyReaction` 的第二个参数传入，使业务写入和通知一起提交。不要在事务内部运行建表。

运行隔离的单元与 HTTP 权限测试：

```sh
node --test backend/notifications.test.js
```

运行真实 MySQL 集成测试（默认本地 `127.0.0.1:3306` 的 `root`，自动创建并删除随机测试库，不使用应用库）：

```sh
NOTIFICATIONS_MYSQL_TEST=1 node --test backend/notifications.test.js
```

可用 `NOTIFICATIONS_MYSQL_HOST`、`NOTIFICATIONS_MYSQL_PORT`、`NOTIFICATIONS_MYSQL_USER`、`NOTIFICATIONS_MYSQL_PASSWORD` 覆盖测试连接；测试账号需要创建和删除测试库的权限。测试先加载完整既有 schema，再验证新表兼容、收件人范围、去重、事务回滚及邮件失败恢复。所有测试使用替代邮件发送函数，不发送真实邮件。
