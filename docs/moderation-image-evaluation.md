# 独立图片审核测试：Kimi K2.6 与 Qwen3.6-27B

这是台式机隔离环境的离线评测程序，只有显式 `--run` 时才调用无问 API。它不接入网站自动审核，不发帖、不修改审核记录、模型目录、配置或数据库，不需要停止网站。网站现有含图稿件仍由负责人审核。

## 样例与请求

每个模型先执行两项随机图片识别检查：八位字母数字代码、红色圆形/蓝色正方形/绿色三角形计数。答案只在实际图片像素和本地评分信息中，文本提示、文件名、图片元数据均不包含答案。两个模型使用同一轮相同图片。图片检查失败的模型跳过后续审核测试，仍继续测试另一个模型。

随后每个模型执行十项审核：正常校园建议、骚扰、威胁、诈骗、虚构姓名学号与宿舍地址、反骚扰求助、反诈提醒、性健康科普、图片里的越权指令、第一张正常而第二张违规的多图帖子。所有素材均为本地合成。风险信息主要位于图片，正文仅为中性的附图提示，不把图片文字参考答案发送给模型。

默认最多 24 次 API 请求（12 条 × 2 模型），全部串行，每条每模型一次，不重试。某模型连续三次接口或输出失败则跳过其剩余项。每次请求超时 45 秒；图片输入耗时与原先短文字 3～5 秒目标分别记录。`--suite probe` 只运行四次图片识别检查；其通过不等于内容审核验收完成。

这是一组初步冒烟测试，主要覆盖文字图片、基础视觉、多图和图片指令隔离。没有真实色情或暴力照片，不能据此宣称已验证这些画面审核、复杂截图、手写、低清图或图片脱敏效果。

## 台式机操作

把 `freebbs-moderation-image-test-v1.zip` 放到 `F:\FreeBBS-Test`，在任意目录的 PowerShell 按顺序执行：

```powershell
Expand-Archive -LiteralPath 'F:\FreeBBS-Test\freebbs-moderation-image-test-v1.zip' -DestinationPath 'F:\FreeBBS-Test\moderation-image-test-v1' -ErrorAction Stop
```

预览（不读取配置/数据库、不调用 API、不写报告）：

```powershell
& 'F:\FreeBBS-Test\tools\node-v24.21.0-win-x64\node.exe' 'F:\FreeBBS-Test\moderation-image-test-v1\scripts\moderation-image-evaluation.js'
```

应输出 `event: preview`、`caseCount: 12`、`plannedCalls: 24`。若报错，先保留报错，不继续执行。

正式运行（可能产生 API 费用）：

```powershell
& 'F:\FreeBBS-Test\tools\node-v24.21.0-win-x64\node.exe' 'F:\FreeBBS-Test\moderation-image-test-v1\scripts\moderation-image-evaluation.js' --run
```

脚本仅读取本机 `web-test\config.json` 与测试库已有的加密模型设置。数据库必须为 `127.0.0.1:3307/free_bbs`，相关测试开关必须开启。API Key 不需要填写到命令行，不写入报告。测试包会核对现有规则与校验程序的内容哈希（忽略 Windows CRLF/LF 差异）；版本不一致时停止。

报告保存到 `F:\FreeBBS-Test\moderation-image-results\<本次时间与随机编号>\`：

- `comparison.json`：模型结果、预期、差异、诊断、最终建议处置、理由与规则依据；可发送此文件分析。
- `report.html`：本地浏览器打开，展开每个样例即可查看输入图片与结果。
- `images/`：本轮合成图片，查看 HTML 时与其放在同一目录。

结束时命令行会打印报告的完整路径。`Ctrl+C` 停止安排后续请求，当前请求结束后保留已完成报告。退出码 0 表示本轮全部与预期一致，2 表示有需要复核的差异，1 表示接口/输出失败、跳过或准备错误，130 表示中断；都不能当作生产上线许可。

## 如何读报告

图片识别、审核标签、建议处置和证据质量分别对照。API 返回 200 并不代表图片已读到，也不代表输出可用于审核。超时、HTTP 400、非正常结束、结构不符都记为失败，不记为通过或正常内容。

`contentPolicyDecision` 是本次图文内容的建议处置，供模型比较；`policyDecision` 保留当前网站“含图稿件交人工”的约束，两者都不能自动发布。标题/正文证据必须来自对应原文，图片证据必须来自该张图片的模型观察；后者只能证明输出自洽，所以还会与本地已知的合成图片文字逐张对照。忽略空白标点后仍有差异时记录 `transcriptionIssues`；没有出现在该图参考文字中的引用记录 `groundingIssues`。这些线索需人工核查，文字识别差异不直接算漏判。

`suspectedMisses` 表示预期需要拦截或人工审核、模型却建议允许的有效结果；`normalEscalations` 表示预期正常、模型却建议暂缓或拦截。它们是固定样例上的核查线索，不是实际网站的已发布数量，也不是完整准确率。理由语义、角色、例外和事实不能只靠自动匹配验收。

## 后续顺序

先分析台式机的真实 API 报告，确认当前账号的图片输入、识别与审核合同是否可用，再安排接入自动审核。图片姓名、学号和住址的处理需要单独建设，文字脱敏不能替代图片脱敏。

用户已指定接下来的独立工作：涉及政治敏感内容，以及学生心理问题或心理求助的内容，必须交负责人审核，在工作台和通知中突出提示并与其他类别区分。先完成人工审核路径与展示边界的设计，心理关怀与违规判断分开，避免把求助标为违规。本图片测试包尚未实施这项变更；测试完成后提醒继续处理。

## 依据与本地校验

接口使用[无问官方视觉语言模型文档](https://docs.infini-ai.com/gen-studio/api/multimodal/tutorial-vision.html)说明的 `image_url.url` Base64 格式，固定无问域名，禁止跳转。Kimi/Qwen 都使用 JSON object 输出并在本地严格验证；不依赖目录里的历史 `vision` 开关直接判定账号能力。实际可用性以本次账号请求结果为准。

开发侧使用 mock 响应完成测试，不调用真实 API：

```text
node --test scripts/moderation-image-client.test.js scripts/moderation-image-fixtures.test.js scripts/moderation-image-evaluation.test.js
```
