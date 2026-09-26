(() => {
  const normalize = (value) => window.FreeBbsMaxArtifactData.normalize(value);
  const prefix = 'free_bbs_max_artifact_v1:';
  function mode() {
    return document.getElementById('max-create-mode')?.value || 'chat';
  }
  function read(kind, uid) {
    const id = new URLSearchParams(window.location.search).get('maxDraft');
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) return null;
    const stored = JSON.parse(sessionStorage.getItem(prefix + id) || 'null');
    if (!stored || stored.uid !== uid || Date.now() - stored.createdAt > 86400000)
      throw new Error('Max 草稿已过期或属于其他账号，请回到原对话重新打开。');
    const artifact = normalize(stored.artifact);
    if (artifact.kind !== kind) throw new Error('草稿类型不匹配。');
    return artifact;
  }
  function mount(article, value) {
    if (!article || !value) return;
    let artifact;
    try {
      artifact = normalize(value);
    } catch {
      return;
    }
    article.querySelector('.max-artifact-action')?.remove();
    const container = document.createElement('div');
    container.className = 'max-artifact-action';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = artifact.kind === 'circuit' ? '进入电路实验室' : '进入小工具工坊';
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    button.addEventListener('click', () => {
      try {
        const id = window.crypto.randomUUID();
        sessionStorage.setItem(
          prefix + id,
          JSON.stringify({
            artifact,
            uid: window.freeBbsApp.userState.uid,
            createdAt: Date.now(),
          }),
        );
        window.location.assign(
          `${artifact.kind === 'circuit' ? '/circuit' : '/tool-workshop'}?maxDraft=${id}`,
        );
      } catch {
        status.textContent = '浏览器无法保存跳转草稿，请释放存储空间后重试；作品仍保留在此对话中。';
      }
    });
    container.append(button, status);
    article.querySelector('.aichat-bubble')?.append(container);
  }
  async function generate({ kind, prompt, previous, article, onStatus, onReasoning }) {
    const app = window.freeBbsApp;
    const sessionToken = app.userState.token;
    const controller = new AbortController();
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.textContent = '停止生成';
    stop.className = 'max-artifact-stop';
    stop.addEventListener('click', () => controller.abort());
    article.append(stop);
    const selector = document.getElementById('max-create-mode');
    if (selector) selector.disabled = true;
    let code;
    let source = '';
    let timer;
    const paint = () => {
      timer = null;
      if (window.hljs)
        code.innerHTML = window.hljs.highlight(source, {
          language: 'xml',
          ignoreIllegals: true,
        }).value;
      else code.textContent = source;
    };
    try {
      let artifact;
      let answer;
      let model;
      if (kind === 'tool') {
        const details = document.createElement('details');
        details.className = 'max-artifact-source';
        details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = 'HTML 源码 · 实时生成';
        const pre = document.createElement('pre');
        code = document.createElement('code');
        pre.append(code);
        details.append(summary, pre);
        article.append(details);
        const result = await window.FreeBbsReasoning.request({
          url: `${app.apiBaseUrl}/tools/generate/html`,
          token: app.userState.token,
          payload: { prompt, currentHtml: previous?.kind === 'tool' ? previous.html : '' },
          signal: controller.signal,
          timeoutMs: 315000,
          onReasoning,
          onStatus: ({ message }) => onStatus(message),
          onHtml(delta) {
            source += delta;
            if (source.length > 184000) throw new Error('HTML 超过长度限制，请精简需求。');
            if (!timer) timer = setTimeout(paint, 100);
          },
        });
        artifact = normalize({ kind, title: prompt, html: result.html });
        source = artifact.html;
        clearTimeout(timer);
        paint();
        details.open = false;
        summary.textContent = '查看 HTML 源码';
        answer = '小工具已生成。点击下方按钮，可预览、继续编辑并发布到讨论区。';
        model = result.model;
      } else {
        const draft =
          previous?.kind === 'circuit'
            ? previous.document
            : {
                version: 1,
                components: [],
                wires: [],
                analysis: { type: 'dc' },
              };
        const result = await window.CircuitChat.request({
          url: `${app.apiBaseUrl}/ai/circuit/chat`,
          token: app.userState.token,
          payload: { question: prompt, document: draft },
          signal: controller.signal,
          onProgress(part) {
            if (part.type === 'reasoning') onReasoning(part);
            if (part.type === 'status') onStatus(part.message);
          },
        });
        const edited = window.CircuitAIActions.applyActions(draft, result.actions);
        if (!edited.components.length || !result.actions.length)
          throw new Error('Max 尚未给出可生成的电路，请补充元件、连接方式或功能要求。');
        artifact = normalize({ kind, title: prompt, document: edited });
        answer = `${result.answer}\n\n电路草稿已生成，点击下方按钮进入实验室编辑和仿真。`;
        model = result.model;
      }
      if (app.userState.token !== sessionToken || !app.userState.isLoggedIn)
        throw new Error('登录状态已变化，请重新打开对话后再生成。');
      return { answer, model, artifact };
    } finally {
      clearTimeout(timer);
      stop.remove();
      if (selector) selector.disabled = false;
    }
  }
  window.FreeBbsMaxArtifacts = { mode, mount, generate, read };
})();
