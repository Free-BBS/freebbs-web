# 今日随机发现与地图入口

活动页顶部展示一条推荐，支持「去看看」「换一个」及「偏好设置」。地图入口使用产品名称 **frEE bbs MAP**。

## 用户偏好

- 可选择活动、经验中的一种或多种。
- 最多填写 8 个兴趣关键词，每个最多 24 个字符，按标题、简介、分类及标签等内容进行文字匹配。匹配会提高抽中机会，不使用角色或浏览记录推断兴趣。
- 活动时间范围为未来 7、30 或 90 天，同时包含正在进行及时间待定的活动。已结束、未发布、日期无效的活动不进入候选。
- 「也看看兴趣之外的内容」开启时混入其他候选；关闭后，仅保留命中关键词的内容。没有关键词时按所选类型探索。
- 使用账号、浏览器本地日期和偏好生成稳定的每日排序。「换一个」依次浏览候选；候选不变时，一轮内不重复。刷新后回到当日排序的第一条。
- 偏好保存在当前浏览器的 `free_bbs_discovery:v1:<uid>`，按账号隔离，不跨设备同步。存储不可用时，本次浏览仍能应用偏好，并显示提示。

## 站点配置

当前站点级配置由维护者修改 `apps/web/src/modules/discovery/site-config.ts` 后重新构建发布，不是治理管理台中的在线设置。

```ts
export const DISCOVERY_CONFIG: DiscoveryConfig = {
  enabled: true,
  allowedKinds: ['activity', 'club', 'knowledge'],
  excludedKeys: ['activity:unwanted-id', 'knowledge:unwanted-id'],
  suggestedInterests: ['运动', '音乐', '摄影', '科创', '志愿', '读书'],
};
```

`enabled` 控制整块推荐功能；`allowedKinds` 控制候选类型；`excludedKeys` 使用 `activity:<id>`、`club:<id>`、`knowledge:<id>` 排除具体内容；`suggestedInterests` 控制偏好抽屉中的快捷兴趣按钮。用户偏好不能扩大站点允许范围。

活动候选共享活动列表的服务器确认数据，状态变更后同步移出推荐。其他候选使用已有授权接口：`/interest-groups`、`/knowledge/entries?audience=general`。只展示 active 群体与 published 通用经验。每个请求独立显示结果并有 8 秒超时；加载失败可以重试，已卸载页面的迟到请求不会写回。

## frEE bbs MAP 上线

小程序目前尚未发布、备案尚未完成，入口展示「即将上线」并打开说明。没有临时或虚构的跳转地址。

发布后在 Web 构建环境中设置 `VITE_FREE_BBS_MAP_URL` 为真实 HTTPS 跳转链接，重新构建并发布 Web。入口会自动变为在新标签页打开的链接。变量示例位于 `apps/web/.env.example`。空值、非 HTTPS 地址以及包含用户名/密码的地址保持未上线状态。

该变量是公开的前端配置，只能填写可公开访问的链接，不能填写私密凭据。
