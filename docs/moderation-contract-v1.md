# v3 批测后的模型输出约定修订

本次保持规则版本 `freebbs-policy-2026-10-09-v3`，新增输出约定版本 `freebbs-moderation-contract-2026-10-10-v1`。不增加或删除禁止项，不修改样例预期；改进模型输出要求和批测错误诊断。

## 已有证据

2026-10-10 首轮小批测试计划 24 次，实际请求 18 次：GLM-5.1 有效 1 次、失败 5 次、剩余 6 次因连续失败未执行；Kimi K2.6 有效 9 次、失败 3 次。8 次失败被旧报告统一显示为客户端 502，不能据此认定是供应商 HTTP 502。

随后对 4 个固定虚构样例组合诊断：4 次均为 HTTP 200、正常结束、响应体完整，无超时或截断信号。

- GLM 的两个样例：外层响应可解析，但 `message.content` 不是合法 JSON。诊断没有保存原文，因此无法断定是 Markdown 包装还是内部语法错误。
- Kimi 的学生卡隐私样例：JSON 字段、规则、证据、关怀级别等检查通过，只有风险类别集合与所选禁止规则类别集合不一致。现有证据不能区分漏报、多报或错误映射。
- Kimi 的关怀样例：该次返回通过全部校验；单次成功不证明稳定性问题已消失。

这些是指定测试请求的观测结果，不是模型总体准确率或供应商能力结论。[无问结构化输出说明](https://docs.infini-ai.com/gen-studio/api/text-generation/tutorial-structured-output.html)也区分 HTTP 成功、JSON 可解析、结构合规和业务正确；正常结束不能替代本地校验。

## 本次改进

1. 明确先选择适用规则，再让 `categories` **恰好等于**其中禁止项的类别去重集合；不能多、不能少，关怀规则不计入违规类别。继续拒绝类别与规则不一致的结果，不自动补类别。
2. 仅有心理关怀、没有独立内容风险时，统一输出无违规判断及空风险类别，关怀级别、具体支持需求和保护性人工复核仍独立保留。不要求网站负责人收集既往病史或用药信息。
3. 重申纯 JSON 语法、字符串转义及字段约定；针对具体对象的含糊冲突，按现有规则说明待核实语境，不能直接等同于明确威胁或一律放行。
4. 失败时记录白名单诊断：实际 HTTP 状态、失败阶段、JSON 内容形态和固定语法错误类别等；不保存响应正文、密钥、原始解析异常或原文片段。后续批测报告可直接提供这些信息。
5. 报告单列保护性关怀复核。只有纯关怀且规则、级别符合预期的情况才与普通内容升级区分；原始严格标签差异仍保留，不能因此把不一致算成完全匹配。

保留原请求格式、一次请求上限及严格 JSON、规则、证据校验。不剥离围栏、不拼接截断结果、不进行语法修补、不自动重试。GLM 的具体语法原因仍待新一轮安全诊断确认，本次提示修订的真实改善程度也需要台式机验证。

## 验证顺序

先执行更新包内的 `moderation-contract-check.json`：4 条虚构样例，默认两个模型，最多 8 次 API 调用。涵盖第三方隐私、正常性健康教育、普通关怀和紧急关怀。它来自现有 96 条样例，不新增真实用户内容。

```powershell
& 'F:\FreeBBS-Test\tools\node-v24.21.0-win-x64\node.exe' 'F:\FreeBBS-Test\freebbs-web\scripts\moderation-model-evaluation.js' --input 'F:\FreeBBS-Test\moderation-contract-update\moderation-contract-check.json'
```

预览应显示 `caseCount:4`、`plannedCalls:8` 及新输出约定版本；添加 `--run` 才产生供应商调用。该文件只包含 4 条样例，外部输入不套用内置 12 条小批筛选。

```powershell
& 'F:\FreeBBS-Test\tools\node-v24.21.0-win-x64\node.exe' 'F:\FreeBBS-Test\freebbs-web\scripts\moderation-model-evaluation.js' --input 'F:\FreeBBS-Test\moderation-contract-update\moderation-contract-check.json' --run
```

查看末尾输出的 `reportHtml`，将同一轮的 `comparison.json` 发回分析。执行后即使有失败，也保留结果；新报告会区分具体原因，不需要先重复运行旧诊断包。通过这轮后再恢复 12 条小批及 96 条完整测试。

本次修改了后端模块，更新后需重启经核实的测试后端才能让工作台使用新输出约定；CLI 每次重新加载当前文件。没有数据库迁移、依赖或配置变更。
