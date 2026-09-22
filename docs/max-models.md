# Max 模型选择、视觉与连续执行

电路侧栏、问问 Max 和报告编辑器提供模型及思考强度选择。在当前浏览器中按账号保存偏好，每次请求显式携带模型；自主执行启动时固定本次选择，其他用户和系统默认模型不受影响。服务端校验模型及档位组合，API 密钥始终留在服务端。

2026-09-14 使用生产账号的 `/models` 接口得到 22 项服务，其中 14 项为聊天模型。此次全部完成文字调用验证：GLM-5.1/5.2/5.3，DeepSeek V4 Pro、V4 Flash、Pro 0813、Flash 0731、V4.1 Flash，Kimi K2.6、K2.7 Code，Qwen3.6 27B、35B A3B，MiniMax M2.7，MiMo V2.5 Pro。其余为 BGE 向量/重排、DeepSeek OCR、Seedream 图片生成，以及 Seedance、Vidu、Hailuo 视频服务，不放入聊天选择器。账号列表不含文档提及的 Kimi K3、MiniMax M3。

能力定义位于 `backend/ai-model-catalog.json`，Agent 对应文件为 `freebbs_agent/model_catalog.json`，更新时同步维护。

- GLM-5.2：关闭 / high / max，默认 high。
- GLM-5.1、Kimi K2.6、MiMo：关闭 / 自动思考。
- DeepSeek V4 及日期版本：关闭 / low / high / max。
- Qwen3.6：`enable_thinking` 开关。
- Kimi K2.7 Code、MiniMax M2.7：固定思考，MiniMax 使用 `reasoning_split`。
- GLM-5.3、DeepSeek V4.1 Flash：没有找到当前服务商明确的强度文档，保留模型默认参数，不把 HTTP 接受某个字段当作档位有效的证据。

依据：[GLM](https://docs.infini-ai.com/gen-studio/api/text-generation/tutorial-reasoning/glm.html)、[Kimi](https://docs.infini-ai.com/gen-studio/api/text-generation/tutorial-reasoning/kimi.html)、[DeepSeek](https://docs.infini-ai.com/gen-studio/api/text-generation/tutorial-reasoning/deepseek.html)、[Qwen](https://docs.infini-ai.com/gen-studio/api/text-generation/tutorial-reasoning/qwen.html)、[MiniMax](https://docs.infini-ai.com/gen-studio/api/text-generation/tutorial-reasoning/minimax.html)、[MiMo](https://docs.infini-ai.com/gen-studio/api/text-generation/tutorial-reasoning/mimo.html)。

## 图像输入

Kimi K2.6、Kimi K2.7 Code、DeepSeek V4.1 Flash 均通过了图片数字与图形辨认测试。GLM-5.3 返回不支持 `image_url`。Qwen3.6 的文档声称支持视觉，但当前账号按文档发送 PNG、JPEG、纯 Base64、图像前置均返回 400，因此在界面注明当前接口问题并暂保留文字模式。

视觉模型每轮接收最新电路 SVG 和所有波形 SVG 转换的 JPEG，连同原有精确文档、节点、采样摘要。最大 13 张对应一张电路图及六组幅度/相位波形；单张约 1 MiB，长边最多 1800 像素。图像单独校验格式、真实尺寸、解码像素量，文本上下文仍保留大小限制。文本模型不发送图像。图像只进入当前模型请求，不写入聊天历史或公共上传目录。

问问 Max 中的本站电路链接也会按明确版本渲染并附图；波形链接按保存的设置在浏览器重新仿真，图像标签注明来源。图像转换失败会显示错误，不会悄悄声称已经看图。

## 图片生成

问问 Max 与讨论区 `@Max` 支持按需调用生产账号可用的 Seedream 图片模型。Max 仅在用户明确要求，
或图片能显著改善概念解释、视觉设计与场景表达时调用；普通问答、公式、代码和精确电路原理图
继续使用文字或现有电路工具。每次回答最多生成一张，按用户限制并发且成功后冷却一分钟。

Agent 从 `/models` 自动选择最新可用的 Seedream，也可用 `IMAGE_GENERATION_MODEL` 固定型号，
并请求 Base64 结果。Web 后端校验真实格式、像素和大小，统一转为 WebP 后保存到站内
`/uploads`，再把 Markdown 图片链接写入问问 Max 对话或 Max 评论。Base64、供应商临时链接和
API key 不进入聊天记录、讨论数据库或浏览器响应。

## 连续执行

删除默认 12 轮上限及每批 12 项操作数限制。请求携带最近 24 轮执行反馈及最新完整电路状态，避免上下文随执行轮数无限增加。仍保留手动停止、每轮 5 分钟、连续失败/无进展停止、文档有效性及请求字节限制。只有完整且通过校验的操作批次才会执行。
