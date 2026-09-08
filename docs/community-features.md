# 注册、通知与课程组接入

## 使用入口

- 管理员进入「用户管理 → 注册白名单」下载 Excel 模板，填写学号、姓名、邮箱后上传。同一行填写的字段需同时匹配；空字段不限制该项。每行仅供一位成员注册，空名单时不允许新注册。既有账号可以正常登录。
- 管理员在「用户管理 → 发布通知」选择用户、身份分组或课程负责人组。右上角铃铛显示未读数；回复与点赞也会触发通知。
- 不符合新规则的旧账号下次登录或操作时必须先修改用户名。用户名只允许 3–64 位英文字母、数字、下划线；顶部显示用户名，长名字省略显示。
- 在「个人设置 → 课程组 Agent 接入」生成或撤销个人 Token、下载 Skill。账号被指定为某门课程的负责人后，就能通过 API 修改该课程的知识点、资料和图片；身份为学生也可以。课程页的「课程资料」按钮提供已上传文件的下载。
- 课程页使用全站统一的导航、配色和字号，手机可从下拉框切换章节。学习世界保留星球旋转和滑动选择，以柔和的地图与路径呈现课程入口。

## 更新与部署

安装依赖 `npm ci`。数据库新增迁移为 `025_registration_whitelist.sql`、`026_notifications.sql`、`027_course_upload_tokens.sql`；使用现有 `scripts/migrate.sh` 流程执行。后端启动也会确保这些新表存在，迁移不会重命名或覆盖原工作台通知表。

上线后先导入有效白名单，再向新成员开放注册。邮件沿用 `BOTMAIL_SMTP`、`BOTMAIL_SMTP_PORT`、`BOTMAIL_USER`、`BOTMAIL_PASS`、`BOTMAIL_FROM`，邮件中的站点链接取 `PUBLIC_WEB_URL`。通知与邮件队列原子写入，邮件服务异常时保留待发送任务并重试；管理员可刷新邮件状态。

课程文档保存在持久化 `UPLOAD_DIR/course-agent-files`，图片在 `UPLOAD_DIR`。现有上传目录备份应覆盖子目录。静态路径拒绝直接访问课程文档，下载统一通过课程 API 并以附件返回。

## 验证

```sh
npm run check
npm run test:community
npm run test:community:integration
python3 -B backend/course-upload-client.test.py
```

集成测试需本地 MySQL 测试账号允许创建和删除临时库，默认 `127.0.0.1:3306`、`root`、空密码。测试创建独立随机库，结束后删除，不使用应用数据，也不发送真实邮件。

详细说明：[注册白名单](registration-whitelist.md)、[通知](notifications.md)、[课程 API 与 Skill](course-upload-api.md)。
