# 举报与删除运营准备

后端必须先部署迁移 032 和 `mobile-safety.js`。此文档与接口实现是准备工作，不代表实际运营流程已经验证。

## 接口

所有用户接口以当前登录 Bearer token 为准，忽略客户端伪造的 user_id。管理员接口使用现有 requireAdmin，不接受普通用户。

| 方法 | 路径 | 请求/响应 |
|---|---|---|
| GET | `/api/mobile/blocks` | `{ blocks: [{id, username}] }` |
| POST | `/api/mobile/blocks` | `{ userId: 目标数字ID }` |
| DELETE | `/api/mobile/blocks/:id` | 仅取消当前用户的屏蔽 |
| POST | `/api/mobile/reports` | `{ targetType: "post"或"comment", targetId, reason, detail }` |
| GET | `/api/mobile/account-deletion` | `status: none/pending`，`requestedAt` |
| POST | `/api/mobile/account-deletion` | `{ password, confirm: "DELETE" }`，202 pending |
| GET | `/api/admin/mobile/reports?status=pending&before=游标` | 至多 50 条及下一页游标 |
| PATCH | `/api/admin/mobile/reports/:id` | `{ status: "resolved"或"dismissed", resolution: "人工处理说明" }` |
| GET | `/api/admin/mobile/account-deletions?after=游标` | 至多 50 条申请及下一页游标 |

举报原因：`abuse`、`inappropriate`、`spam`、`privacy`、`other`。目标先验证存在，以内部内容 ID 保存，防止公开 ID/旧 ID 产生重复申请。同一用户相同内容的 pending 举报去重，每小时最多 20 条新举报。事务锁串行化同一账号的提交；任何写入失败回滚。

屏蔽名单在服务器保存；此客户端据名单隐藏帖子与评论，不承诺阻止其他客户端或管理员对公开内容的访问。

## 举报处理上线条件

必须明确由谁查看队列、响应时限、过滤机制、内容处理权限和申诉方式。标记 resolved 只是记录处理结果，不会自动删除帖子或评论。管理员需要通过既有管理接口/工具执行实际内容处理，并通知当事人。

正式上线前验收：普通用户不能读取处理队列；普通用户可举报和屏蔽；举报员/被举报人不能看到彼此的私密联系方式；处理后保留最少必要的审核记录；客服邮箱能接收申诉。

## 删除执行上线条件

申请验证密码并保存时间，不保存密码。重复提交保持原始申请时间。没有自动删除 worker；不得宣称提交后已删除。苹果要求允许在 App 内发起账号删除，实际数据清除、处理期限和第三方协同仍必须完成。

实际执行前需设计并验证：

- 身份确认与处理期限、客服通知及必要法律留存。
- 账号、讨论和评论、点赞、AI 对话、个人日程、学校授权 grant、文件和头像的处理范围。
- 登录 token、课程上传 token 和校园授权的撤销。
- 上传目录、AI 服务商副本、邮件任务与数据库备份的清除/到期周期。
- 最后一个管理员和当前管理员不能直接套用现有 `/api/admin/users/:id` 删除限制，需要转移管理责任。
- 现有部分外键级联会删除数据库关联记录，上传文件和备份不会随外键自动清除；部分数据是 SET NULL，仍要审查实名快照与派生字段。
- 用隔离测试账号验证完整清除结果，操作人员实际完成后再向申请者通知结果。

没有提供“把请求状态改成 completed”的伪完成接口。建立上述流程并通过验证前，`deletionFulfillmentVerified` 必须保持 false。
