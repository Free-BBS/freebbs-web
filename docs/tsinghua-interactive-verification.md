# 清华连接：交互验证的已知边界与回归

核对日期：2026 年 10 月 22 日。

## 问题与本轮改动

当前 `direct_cas` 是服务端受限 HTTP 客户端，不是已注册的校方浏览器授权回调，也没有短信、企业微信或设备确认的交互接续协议。旧代码遇到这些要求会终止；单纯多次提交账号密码不会补齐二次验证。

另一个已复现问题是错误分类：旧逻辑扫描整份返回 HTML，隐藏模板、脚本或隐藏父容器中的“短信验证码”“安全验证”也可能被当作正在显示的认证要求。本轮只依据可见 DOM 分类，保留当前学期私有接口验真。成功提示、iframe 或 JavaScript 跳转文字本身都不算建立了有效连接。

遇到确实可见的验证码或二次验证，接口保持 `409`，并返回固定的恢复说明：

```json
{
  "action": "official_verification",
  "officialUrl": "https://id.tsinghua.edu.cn/do/off/ui/auth/login",
  "helpUrl": "https://its.tsinghua.edu.cn/1wzcycejdh_content.jsp?urltype=news.NewsContentUrl&wbnewsid=4000&wbtreeid=1771",
  "canResumeHere": false,
  "retryable": false,
  "browserSessionShared": false
}
```

该对象位于错误响应的 `recovery` 字段，只由服务器固定常量生成，不接收上游提供的跳转地址、ticket 或原始页面。前端应停止当前直接登录重试，清空密码，并提供原站与官方帮助入口。**在另一个标签页完成学校登录，不等于当前 FREE BBS 服务端会话已完成验证。**不得用“回来点一下就成功”或自动提交密码代替缺失的接续流程，也不能建议关闭学校二次认证。

重新认证遇到交互验证，不会替换原有 grant、提升连接 generation 或清空已成功同步的记录。有效旧会话仍按原到期规则处理；个人课程和计划不应因为本次认证未完成而被删除。

前端遇到验证要求会清空密码、撤销本次同意、停止继续提交，并提供固定的网络学堂登录与电子身份入口，由本人在校方页面完成交互。返回后的“检查本站连接”只请求本站状态，不收集校方 Cookie、不自动再发密码，也不根据窗口关闭或返回本站推断认证成功。诊断码保留在可展开说明中。

完整浏览器方案应为：本站发起授权 → 校方窗口完成验证 → 经校方支持的回调或会话交换返回结果 → 本站核验后连接。当前正式 adapter 与受批准回调仍缺失，单纯打开官方链接不能补齐授权结果回传。本轮只交付安全降级和准确状态，不声称该完整闭环已经可用。

## 公开依据

- [清华用户电子身份服务系统](https://id.tsinghua.edu.cn/do/off/ui/auth/login)：公开登录页面及当前页面引用的脚本，仅做未登录 GET 核对。
- [清华官方 WebVPN 双因素认证操作指南](https://its.tsinghua.edu.cn/1wzcycejdh_content.jsp?urltype=news.NewsContentUrl&wbnewsid=4000&wbtreeid=1771)：说明账号密码后可能要求短信或企业微信验证，以及设备浏览器的信任关系。该指南不能被当作本站已对接 WebVPN 或自动共享信任的证据。
- 公开登录页引用的 `/res/selfservice/finger3.js`、`/v2/dist/doubleauth/localstorageUtil.js`：设备浏览器信任相关数据由校方域名自己的浏览器存储管理。本站与后端 Cookie jar 不会因此获得同一份浏览器状态。本轮没有读取个人浏览器存储、登录账号或用户 Cookie。

公开资料没有提供当前受保护挑战页的完整请求协议，因此本轮没有猜测短信/企微验证码端点，也没有新增伪造的验证码提交接口。**真实二次验证的端到端接续尚未实现**；下一步需要已批准的正式浏览器授权接入，或在本人授权下取得不含账号、票据、Cookie 的挑战页面结构与请求合同，再做单独的实现和安全验证。

## 后续接续路线与本轮诊断

用户在普通浏览器登录顺利，不足以证明服务端登录也不需要挑战。两者的网络出口、Cookie jar 和设备上下文不同；旧客户端也可能把图片验证码或隐藏提示误认成交互验证。因此保留原错误码兼容，但不能仅凭该码认定发生了短信或企业微信二次验证。

诊断只返回 `verification.kind` 的固定枚举（`image_captcha`、`interactive`、`unclassified`）与固定证据枚举。图片验证码依据可见的已知图片验证码容器或输入；交互验证依据明确可见提示或标准一次性验证码输入；无法确定则明确未分类。不会返回原始 HTML、表单字段值、动态 URL、账号、密码、Cookie、票据或验证码；不会从脚本、词典或隐藏模板推断当前要求。

2026 年 10 月 22 日，对校方公开通用登录入口的未登录 GET 核对得到 `X-Frame-Options: DENY`。至少这个入口不能通过普通 iframe 嵌入本站；不能靠移除校方响应头或反向代理原始登录页面解决会话衔接。即使其他入口可嵌入，也不代表浏览器会话会共享给服务器。

优先研究的免安装路线是保留**同一个服务端登录事务**：从网络学堂开始 → 待验证 → 本人完成该事务对应的校方确认 → 服务端接续 → 私有接口验真 → 保存有效会话 → 同步。需要短时、单用户、可取消、防重放的挑战上下文，不能保存密码用于自动重试，也不能在尚未取得协议时猜测短信或企微端点。目前只完成了错误区分和诊断，**该事务接续尚未实现**。

公开页面提供了图片验证码和国家网证 APP 扫码登录的脚本线索；后者是另一种认证方式，不证明当前短信或企微挑战能够接续。必须按实际返回的挑战协议单独适配和验证。长期正式接入还需区分身份认证与网络学堂数据授权，不能把发给 FREE BBS 的身份票据当作网络学堂数据凭据。参考[校方申请目录](https://thos.tsinghua.edu.cn/announce/html/announce.html)、[数据授权流程](https://thos.tsinghua.edu.cn/announce/process/LC284008.pdf)与 [CAS 服务票据规范](https://apereo.github.io/cas/development/protocol/CAS-Protocol-Specification.html)。公开申请流程的当前办理方式仍应向校方确认。

## 自动验证范围

```sh
node --test backend/tsinghua-connectors/direct-cas-client.test.js backend/tsinghua-connectors/router.test.js backend/tsinghua-connectors/broker.test.js
npm run test:tsinghua-connectors
```

夹具覆盖：隐藏模板/脚本/祖先误判、真实可见验证要求、正常完整成功链路、私有学期接口验真、iframe/脚本不能宣告连接成功、固定恢复 URL、不回显敏感信息，以及重新认证失败时保留有效连接和已同步摘要。它们不构成真实清华账号或真实 MFA 接续验收。
