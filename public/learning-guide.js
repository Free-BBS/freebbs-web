/* An optional, repeatable guide. No grades, analytics consent or learning choices are changed. */
(function exposeLearningGuide(root) {
  const steps = [
    {
      title: '先知道要解决什么',
      text: '概览说明学什么、需要哪些基础。知识起源解释它为何被需要；熟悉的内容可以直接跳过。',
      action: '看看知识起源',
      navigation: { tool: 'content', view: 'origin' },
    },
    {
      title: '在同一份正文上思考',
      text: '选中文字后可以高亮、划线或写评注。批注只对自己显示；“我的批注”能定位回原文。',
      action: '打开我的批注',
      navigation: { tool: 'notes', view: 'reading' },
    },
    {
      title: '练习与自测分开',
      text: '练习可按基础、标准、挑战选择。自测使用完整正式题目范围；订正和人工待复核有独立记录，不会由阅读时长或自述授星。',
      action: '试试分层练习',
      navigation: { tool: 'feedback', quizView: 'practice' },
    },
    {
      title: '让下一步符合这次需要',
      text: '“继续学习”给一个主要建议和少量替代。你可以展开顺序、修改或跳过；探索和直接自测始终开放。',
      action: '查看下一步',
      navigation: { tool: 'continue' },
    },
    {
      title: '需要时请 Max 帮忙',
      text: 'Max 会结合课程内容、你的学习起点和当前任务辅助讲解。它不会替正式题目判分。个人学习记录可复盘证据；过程记录由你选择是否开启。',
      action: '打开 Max',
      interaction: { tab: 'max' },
    },
  ];
  if (typeof module === 'object' && module.exports) {
    module.exports = { steps };
    return;
  }
  const button = root.document?.getElementById('learning-guide-open');
  const page = root.document?.querySelector('[data-knowledge-page]');
  if (!button || !page) return;
  let index = 0;
  const create = (tag, content, className) => {
    const element = root.document.createElement(tag);
    if (content) element.textContent = content;
    if (className) element.className = className;
    return element;
  };
  const dialog = create('dialog', '', 'learning-guide-dialog');
  dialog.setAttribute('aria-labelledby', 'learning-guide-title');
  const header = create('header');
  header.append(create('span', '学习指南'));
  const close = create('button', '关闭');
  close.type = 'button';
  close.setAttribute('aria-label', '关闭学习指南');
  header.append(close);
  const count = create('p', '', 'learning-caption');
  const title = create('h2');
  title.id = 'learning-guide-title';
  const body = create('p');
  const action = create('button', '', 'learning-primary');
  action.type = 'button';
  const footer = create('footer');
  const previous = create('button', '上一步');
  previous.type = 'button';
  const next = create('button', '下一步');
  next.type = 'button';
  footer.append(previous, next);
  dialog.append(header, count, title, body, action, footer);
  root.document.body.append(dialog);
  const render = () => {
    const step = steps[index];
    count.textContent = `${index + 1} / ${steps.length}`;
    title.textContent = step.title;
    body.textContent = step.text;
    action.textContent = step.action;
    previous.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? '完成' : '下一步';
  };
  button.addEventListener('click', () => {
    index = 0;
    render();
    dialog.showModal();
    close.focus();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => button.focus({ preventScroll: true }));
  previous.addEventListener('click', () => {
    index = Math.max(0, index - 1);
    render();
  });
  next.addEventListener('click', () => {
    if (index === steps.length - 1) dialog.close();
    else {
      index += 1;
      render();
    }
  });
  action.addEventListener('click', () => {
    const step = steps[index];
    dialog.close();
    if (step.interaction)
      page.dispatchEvent(
        new root.CustomEvent('knowledge:open-interaction', { detail: step.interaction }),
      );
    else {
      page.dispatchEvent(
        new root.CustomEvent('knowledge:tool-select', { detail: { tool: step.navigation.tool } }),
      );
      page.dispatchEvent(new root.CustomEvent('knowledge:navigate', { detail: step.navigation }));
    }
  });
})(typeof window === 'undefined' ? globalThis : window);
