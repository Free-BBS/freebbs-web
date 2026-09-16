# Max 图片聊天部署

本次改动继续使用现有 Node.js、Sharp、MySQL 和 Agent 服务，无新增依赖、数据库迁移或环境密钥。用户上传的压缩图片保存在 `ai_dialogs.messages_json` 内，由现有用户鉴权与对话归属检查保护；不创建公共图片链接，不依赖 `/tmp`、本地浏览器存储或新增上传目录。数据库备份会包含这些图片。

## 发布顺序

先合并并部署 `freebbs-agent` 的配套 PR，再合并并部署 Web PR。Agent 修复使引导与普通聊天两条调用链都收到 `vision_images`。只部署 Web 时，旧 Agent 的引导部分仍可能声称没有图片。

两个仓库现有部署工作流仅在 `main` 推送或手动触发时发布。功能分支推送不会触发生产部署。GitHub 创建 PR 页面仍需人工点击提交。

## 反向代理

浏览器在 HTTPS 生产页面与本地开发页面统一访问同源 `/api/`，无需向公网开放 3001 或 5001。保留现有 TLS、认证和其他 location 配置，在负责 `/api/` 的 Nginx 配置中确认以下参数（示例 upstream 使用仓库默认后端端口）：

```nginx
location /api/ {
    client_max_body_size 32m;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 360s;
    proxy_send_timeout 360s;
}
```

`proxy_pass` 不带结尾 `/`，保留后端需要的 `/api/` 路径。若生产经 3000 前端转发到 API，仍须在外层代理设置同样的大小与流式参数。其他入口若有 CDN/WAF，应允许相应大小的 POST 和流式响应。配置修改由服务器维护者审核并使用 `nginx -t` 验证后加载；本次代码发布不会自动改写服务器 Nginx。

前端每次最多 4 张 PNG/JPEG/WebP，原文件每张最多 10 MiB，自动转换为最长边 1600 像素以内的 JPEG，发送编码小于 1.4 MB。后端 JSON 请求上限为 28 MiB，单个保存对话上限 24 MiB，超过时提示新建对话。确认 MySQL `max_allowed_packet` 至少为 32 MiB，建议 64 MiB，避免较长图片对话保存失败。图片只附给当前提问；历史图片用于展示，不会自动重新发给模型。

## 验收

1. 登录后确认验证请求走当前域名 `/api/auth/login-challenge`，不产生跨端口或 HTTP 混合内容请求。
2. 选择视觉模型，分别选择文件、拖入图片、粘贴截图；检查预览、删除按钮、纯图片发送以及非视觉模型的拦截提示。
3. 图片发送后先保存用户消息，再开始模型请求。切换对话或刷新后图片可恢复，点击可放大查看。
4. 确认普通聊天与引导两部分均可接收图片。回答末尾显示服务返回的正文模型，历史回答保留该标注。
5. “展开 Agent 思考过程”默认关闭；勾选后新旧思考栏均展开，刷新后保留选项。收起不改变模型的思考强度。
6. 通过 `npm run test:aichat-navigation` 运行相关 Web 回归测试；Agent 使用 `.venv/bin/python -m unittest discover -s tests`。

旧版本没有持久化的图片无法恢复。回滚到不保留 `images` 字段的旧 Web 版本后，重新保存已有对话可能删除图片字段，因此回滚前备份数据库并暂停该类对话写入。
