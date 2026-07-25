# 信号系统单课程知识点页 Demo

这是一个独立静态 demo，用来展示“课程导引页 -> 知识点详情页”的学习流程。它不接主站 UI，不依赖后端 API，也不依赖本机 `node_modules`。当前目标是给课程与知识点页面做交互和信息架构验证，方便后续迁移到正式前后端。

## 如何打开

可以直接打开：

```text
demo/signals-course/index.html
```

也可以用任意静态服务预览该目录。页面内的路由使用 hash：

```text
#overview
#point=signal-basics
#point=lti-system
#point=fourier-series
#point=fourier-transform
#point=sampling-theorem
```

## 页面结构

当前 demo 分成两个状态：

1. `#overview`：课程导引页
   展示课程简介、学习路线、知识点卡片、继续学习入口和讨论入口。

2. `#point=<knowledgeId>`：知识点详情页
   展示正文区、资料区、讨论入口、学习/复习按钮，以及右下角悬浮 RAG mock。

知识点卡片点击后会先打开预览弹窗，弹窗里可以进入详情页。

## 文件说明

```text
demo/signals-course/
  index.html              页面结构
  styles.css              独立样式，不复用主站 CSS
  data.js                 单课程静态数据
  app.js                  页面状态、路由、交互逻辑
  markdown-renderer.js    Markdown + LaTeX 公式渲染封装
  vendor/
    marked/               本地 Markdown 渲染依赖
    katex/                本地公式渲染依赖和字体
```

## 数据结构

课程数据挂在：

```js
window.DEMO_COURSE_DATA;
```

知识点核心字段：

```js
{
  id: 'fourier-transform',
  title: '傅里叶变换',
  summary: '把非周期信号表示成连续频率上的复指数叠加...',
  tags: ['非周期信号', '频域', '系统响应'],
  prerequisites: ['fourier-series'],
  resources: [
    {
      type: '讲义',
      title: '课程讲义：傅里叶变换性质',
      description: '重点整理线性、时移、频移、尺度、卷积性质。',
    },
  ],
  bodyMarkdown: `
## 从级数到变换

正文支持 Markdown，也支持行内公式 $x(t)$。

$$
X(j\\omega)=\\int_{-\\infty}^{\\infty}x(t)e^{-j\\omega t}\\,dt
$$
  `,
}
```

后续如果接后端，建议后端直接返回同等结构，尤其是 `bodyMarkdown` 字段。

## Markdown 和公式渲染

渲染器接口在：

```js
window.DEMO_MARKDOWN_RENDERER;
```

常用调用：

```js
const html = window.DEMO_MARKDOWN_RENDERER.render(markdown);
container.innerHTML = html;
```

当前支持：

- 标题、段落、列表、加粗、代码等 GitHub Flavored Markdown 基础语法；
- 行内公式：`$x(t)$`、`\(x(t)\)`；
- 块级公式：`$$...$$`、`\[...\]`；
- 代码块和行内代码里的 `$` 会先被保护，避免误识别成公式；
- 公式渲染失败时会显示 fallback 文本，不会阻塞页面。

底层公式方法也暴露出来：

```js
window.DEMO_MARKDOWN_RENDERER.renderLatex('x(t)', false);
window.DEMO_MARKDOWN_RENDERER.renderLatex('X(j\\omega)', true);
```

一般业务不需要直接调用 `renderLatex`。

## 本地依赖说明

为了保证 demo 可以独立展示，第三方浏览器依赖已经放在 `vendor/` 下：

- `marked`：Markdown 转 HTML；
- `KaTeX`：LaTeX 公式渲染；
- `KaTeX fonts`：公式字体文件。

请不要在 demo 页面里直接引用 `node_modules` 或 CDN。需要升级依赖时，先在项目依赖中升级，再把对应 dist 文件复制到 `demo/signals-course/vendor/`。

## 状态存储

学习/复习状态保存在浏览器 `localStorage`：

```text
free_bbs_demo_signals_progress_v1
```

这只是 demo 状态。正式版本应迁移到后端用户学习进度接口。

## RAG 对话区

右下角 `Ask Max` 是本地 mock，不调用真实 AI 服务。

- 在导引页，上下文是整门课程；
- 在详情页，上下文是当前知识点；
- 回复根据问题关键词和当前知识点摘要生成。

正式版本可以把当前 `bodyMarkdown`、资源、前置知识作为 RAG query 的上下文。

## 开发约定

- 这个目录是独立 demo，不要接主站 `public/styles.css`。
- 不新增后端 API，不新增数据库迁移。
- 页面优先服务“学习阅读体验”，不要让固定侧栏挤占正文宽度。
- 新增课程内容时优先写 Markdown，不要再回到手写 DOM 或结构化段落数组。
- 若修改 vendor 依赖，请保留 license 文件。

## 最小检查

可运行：

```bash
node --check demo/signals-course/app.js
node --check demo/signals-course/data.js
node --check demo/signals-course/markdown-renderer.js
npx.cmd prettier --check demo/signals-course/index.html demo/signals-course/styles.css demo/signals-course/app.js demo/signals-course/data.js demo/signals-course/markdown-renderer.js demo/signals-course/README.md
npx.cmd eslint demo/signals-course/app.js demo/signals-course/markdown-renderer.js --quiet
```

如果只是改文案或数据，通常检查 `data.js` 和页面预览即可。
