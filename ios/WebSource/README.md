# iPhone rich content

`reader.js` 和 `reader.css` 是手机适配层。`bundle-rich-content.py` 从网站 `public/app.js` 提取共享的 Markdown、数学保护、HTML 清理和代码高亮函数，并嵌入 Marked、KaTeX、Highlight.js、公式字体以及电路/工具/代码结果模块。许可证随 App 附带。

```sh
npm ci
python3 ios/scripts/bundle-rich-content.py
python3 ios/scripts/bundle-rich-content.py --check
```

不得手动修改生成的 `Resources/RichContent.html`。来源锚点变化会停止生成，需重新审查提取范围。`manifest.json` 记录渲染器与 lockfile 的 SHA-256。

正文接受参数化 JS 调用，先使用站点清理器，再限制 HTTPS。原生 bridge 只接受主 frame，Bearer 仅发送到同域 `/api/`。公开 HTML 工具保留不带 allow-same-origin 的 iframe 与禁止网络的 CSP。公式、字体和语法高亮离线可用，引用的电路/工具/实验结果需要网络。
