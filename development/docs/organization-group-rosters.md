# 班级人员名单 API

该接口管理班级名单，不授予账号身份，也不修改旧活动中的参与人文字。名单与不可变版本快照存入既有组织组独立存储的 `organization-group/` 工作区记录，使用同一个文件锁和原子提交；无需另建角色或配置新存储目录。

所有路径以 `/api/development/v1/organization-group` 开头。响应均为 `{ "data": ..., "requestId": "..." }`，使用 `Cache-Control: private, no-store`，必须登录。

## 读取与维护

`GET /rosters/:classId`：班级必须已在工作区配置。团支书只能读取 `submitClasses(state, user)` 中的班级；既有 `viewsAll` 授权可查看全部已配置班级。返回：

```json
{
  "classId": "wu55",
  "revision": 1,
  "members": [
    { "id": "roster-member-001", "displayName": "同学甲" },
    { "id": "roster-member-002", "displayName": "同学甲", "studentId": "2026000002" }
  ],
  "updatedAt": "2026-11-15T12:00:00.000Z",
  "canEdit": true,
  "canImport": false
}
```

尚未保存的班级返回 `revision: 0`、空 `members`、`updatedAt: null`。同名成员保留不同 ID；不能用姓名作为去重键。学号不是必填字段。

`PUT /rosters/:classId` 完整替换该班当前名单，可增删或改名：

```json
{
  "revision": 1,
  "members": [
    { "id": "roster-member-001", "displayName": "同学甲" },
    { "displayName": "新加入同学" }
  ]
}
```

新成员可省略 `id`，服务端生成 UUID；编辑既有成员时必须保留 GET 得到的 ID。省略 ID 表示新记录，不按姓名猜测同一人。ID 绑定原班级，不能跨班复用；转班时应在新班级创建新记录，旧版本仍保留。可省略 `studentId`，空字符串也会被省略；每份名单中 ID 和非空学号不能重复。每班最多 2000 条，姓名最多 120 字符、学号最多 100 字符，不能包含控制字符。

普通团支书只能维护当前允许填报的班级；既有 `manages` 或 `canGrantClassSecretaries` 授权可维护全部班级。全局只读辅导员不因此获得名单写权限。所有预览身份禁止写入。写入排队取得工作区锁后再次认证并检查当前授权、班级配置及版本。版本冲突返回 `409 revision_conflict`，不会覆盖数据；前端应保留本地编辑，提示重新读取并由用户确认。

## 管理者 JSON 批量导入

`POST /rosters/import` 仅上述管理者/组织组授权可用：

```json
{
  "batches": [
    { "classId": "wu55", "revision": 0, "members": [{ "displayName": "同学甲" }] },
    { "classId": "wu54", "revision": 2, "members": [] }
  ]
}
```

返回 `{ "items": [班级名单DTO, ...] }`。这会替换指定班级的当前名单；空数组清空该班。每个班必须配置、每个班版本必须相符；一次不能重复班级或复用其他班成员 ID。整个批次先检查后在一个工作区事务中提交，任一失败均不修改任何班。一次最多 100 班、20000 条成员，另受 API 请求体大小限制。当前提供 JSON；未承诺直接上传 XLSX。

`GET /rosters/:classId/history` 使用与名单读取相同的当前班级权限，返回 `{ "classId": "wu55", "items": [{ "revision": 1, "members": [...], "updatedAt": "..." }] }`，包括当前已提交版本。每次成功写入追加新快照；后续改名、删人不会重写旧快照或旧活动记录。未授权用户不能读取名单、历史或学号，工作区 DTO 不包含这些名单。
