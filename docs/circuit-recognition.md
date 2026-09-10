# 电路图识别

在 `/circuit` 点击「识别电路图」，选择、拖入或粘贴一张电路原理图，可填写补充说明。手机端也可以点击「拍照识别」，调用系统相机拍摄电路图；浏览器支持时优先使用后置摄像头。拍摄完成后会显示图片预览，取消拍摄会保留之前选择的图片。

识别完成后，先对照原图检查预览中的元件、参数和连线，再生成新电路草稿。草稿可继续修改、仿真，并通过「保存并获取 CID」保存为站内电路。

图片支持 PNG、JPEG、WebP，上传上限 8 MiB。清晰的原理图截图或正面拍摄的图像更适合识别；实物照片不能可靠确定内部接线。无法确认的参数、缺失的地和模型不支持的元件需要检查识别提示。识别不代表电气正确性或仿真已经通过。

## HTTP 接口

登录用户通过 Bearer 认证调用 `POST /api/ai/circuit/recognize`：

```json
{
  "imageDataUrl": "data:image/png;base64,...",
  "instructions": "请按图中的电阻标值识别，保留输出节点。"
}
```

成功响应为 `{circuit:{title,description,document},warnings:string[]}`。`document` 遵循 [电路数据约定](circuit-contract.md)，并经过严格字段、引脚、参数和元数据校验。响应仅生成候选电路，不写入数据库；确认后沿用 `POST /api/circuits` 保存并获取 CID。模型输出和提示以数据处理，不执行生成的代码。

模型正文未通过格式或电路数据校验时，会结合原图和校验反馈自动修复一次，再执行相同校验。修复与首次请求共享总超时和取消状态；非电路图片、模型服务错误及超时不会触发修复。识别结果仍需要人工核对参数和连接。

服务端通过 sharp 检查真实图片格式、解码并规范化，限制像素数量和传给模型的图片大小，不接受远程图片 URL。请求最长 180 秒，等待期间以 JSON 空白心跳维持连接；断开和取消会中止上游。已经发送 HTTP 响应头后的错误返回 `{ok:false,status,message,code}`，客户端必须检查该对象，不能仅把 HTTP 200 当作识别成功。

## 模型设置

复用系统模型设置中的 API Base URL 和加密保存的 API key，直接向兼容 Chat Completions 的接口发送文字及 `image_url` 数据，不经过纯文本 Agent 转发。

`CIRCUIT_VISION_MODEL` 可单独指定识别模型，保持普通聊天模型配置。未指定时，Infini 服务使用当前已知视觉型号，或者从文字型号切换到 `kimi-k2.6`；其他服务使用配置中的模型，管理员应确保它支持图片输入。Kimi K2.6 识别请求关闭额外思考，以便在交互时限内返回完整电路。

Infini 的图片输入使用带 MIME 前缀的 Base64，官方限制单张图片 5 MB，并建议小于 4 MB；服务端会压缩规范化图片后发送。支持视觉的模型及格式见 [Infini 官方视觉文档](https://docs.infini-ai.com/gen-studio/api/multimodal/tutorial-vision.html)。

## 验证

`npm run test:circuits` 包含识别请求边界、模型返回校验、HTTP 鉴权与取消、以及前端识别流程测试。使用本机隔离数据库验证保存与版本读取时，运行 `npm run test:circuits:integration`。发布不新增数据库表，不需要额外迁移。
