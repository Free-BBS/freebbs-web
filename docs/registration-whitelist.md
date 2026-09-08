# 注册白名单

管理员在“用户管理 → 注册白名单”下载 Excel 模板、上传名单、搜索或移除记录。模板第一行保留“学号”“姓名”“邮箱”表头，从第二行填写名单。只填写希望限制的列，也可以省略不限制的列。

同一行内已填写的字段须全部匹配，空字段不限制。不同记录之间满足任意一行即可。学号遵循现有的 `20` 开头 10 位数字规则；姓名去除首尾空格后区分大小写；邮箱去除首尾空格并忽略大小写，最长 128 个字符。每个身份仅能注册一次，重复行自动合并。姓名重名且只限制姓名时仅有一个注册名额，建议同时填写学号或邮箱。现有账号匹配的行在导入时标记为已注册。

白名单为空时拒绝新的公开注册。已有账号可以正常登录，管理员直接创建账号仍走管理员权限接口。注册邮件验证码发送前检查完整身份；最终注册在数据库事务内再次检查并占用名额。

上传支持 `.xlsx`，单个文件不超过 5 MB，解压后不超过 24 MB，最多 10,000 条数据行。拒绝公式、日期、错误值、无效学号及邮箱。完全空白行忽略，不允许用空限制条件放开注册。任一数据行错误会拒绝整份导入，并显示前 30 条行错误。原始文件不落盘。

默认追加到现有名单；选择“替换当前全部白名单”后仅本次文件记录有效。替换和移除不会删除用户，也不会重置已经使用的注册名额。重新上传相同名单不会恢复名额。全部变更在事务内完成，导入、移除和注册使用同一数据库行锁，以防导入与注册竞争。

## 接口

以下管理员接口都要求 `Authorization: Bearer <登录令牌>`：

| 方法   | 路径                                                   | 用途                                                |
| ------ | ------------------------------------------------------ | --------------------------------------------------- |
| GET    | `/api/admin/registration-whitelist`                    | 返回 50 条分页记录与总数，参数 `page`、`search`     |
| GET    | `/api/admin/registration-whitelist/template`           | 下载 Excel 模板                                     |
| POST   | `/api/admin/registration-whitelist/import?mode=append` | 上传原始 XLSX 内容，`mode` 为 `append` 或 `replace` |
| DELETE | `/api/admin/registration-whitelist/:id`                | 将单条记录设为无效                                  |

上传的 Content-Type 使用 `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`。请求正文为文件本身，不使用 JSON 或 multipart。错误对象包含 `message`、`code`、`errors`；行错误还包括 Excel 行号。

## 初始化与集成

迁移为 `database/migrations/025_registration_whitelist.sql`。后端启动时调用 `ensureRegistrationWhitelistTables(pool)`，管理员路由也会确保表存在。`registration_whitelist.claimed_user_id` 刻意不设置级联外键，删除账号也不会释放已消费的注册名额。

注册事务先调用 `assertRegistrationWhitelisted(connection, identity, { lock: true })`，插入用户后调用 `claimRegistrationWhitelist(connection, identity, userId)`，最后提交。捕获错误时必须回滚，两次调用与插入用户必须使用同一数据库连接。`identity` 为 `{ studentId, fullName, email }`。发送注册邮件验证码时先在普通连接上调用 `assertRegistrationWhitelisted(pool, identity)`。

管理员页面加载 `registration-whitelist.css`、`registration-whitelist.js`，完成管理员鉴权后调用 `window.initRegistrationWhitelist({ apiBaseUrl: API_BASE_URL, getToken: () => userState.token })`。
