/* An optional, repeatable guide. No grades or learning choices are changed. */
(function exposeLearningGuide(root) {
  const steps = [
    {
      title: '先知道要解决什么',
      text: '概览说明学什么，并提供资料信息。知识起源解释它为何被需要；基础条件以正文为准，熟悉的内容可以直接跳过。',
      action: '看看知识起源',
      navigation: { tool: 'content', view: 'origin' },
    },
    {
      title: '在同一份正文上思考',
      text: '选中文字后可以高亮、划线或写评注。批注只对自己显示；“我的批注”能定位回原文。',
      action: '回到正文标注',
      navigation: { tool: 'content', view: 'reading' },
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
      text: 'Max 会结合课程内容、你的学习起点和当前任务辅助讲解，不替正式题目判分。学习过程自动记录，批注正文和聊天内容不进入过程统计。',
      action: '打开 Max',
      interaction: { tab: 'max' },
    },
  ];
  const courseSteps = [
    {
      title: '想从头学，看这里',
      text: '“顺着学”展示已发布的学习顺序，没有顺序连线时按目录浏览。遇到分支可以自己选，不会锁住其他知识点。',
      action: '看看学习路线',
      target: '.course-learning-route',
    },
    {
      title: '带着问题来，直接找',
      text: '用名称、编号、别名搜索全课程，也可打开“完整目录”多看一些知识点、按章查找。不必沿路线逐个打开。',
      action: '定位查找入口',
      target: '.course-direct-find input[type="search"], .course-direct-find',
    },
    {
      title: '回来时，接着上次的位置',
      text: '有最近学习位置时，可以点“回到上次位置”找回它；也可以继续查别的内容，不会自动跳转或替你完成学习。',
      action: '定位上次位置入口',
      target: '.course-route-locate',
      missingText: '还没有可返回的学习位置。先选一个感兴趣的知识点，以后可以从这里找回来。',
    },
    {
      title: '先看概览，再决定怎么学',
      text: '点击知识点先看概览，再选择查看联系或进入学习。可以阅读、标注、自测，也可以只查阅需要的内容。',
      action: '定位知识点入口',
      target:
        '.course-learning-route [data-course-route-node-id], .course-direct-find [data-course-point-id]',
      missingText: '这门课程还没有可选知识点。之后发布内容时，可以从路线或查找区打开知识概览。',
    },
  ];
  function install(browser) {
    const document = browser.document;
    const button = document?.getElementById('learning-guide-open');
    const page = document?.querySelector('[data-knowledge-page], [data-course-map-page]');
    if (!button || !page) return null;
    if (button.learningGuideController) return button.learningGuideController;
    const coursePage = page.hasAttribute('data-course-map-page');
    const pageSteps = coursePage ? courseSteps : steps;
    let index = 0;
    let returnFocus = true;
    const create = (tag, content, className) => {
      const element = document.createElement(tag);
      if (content) element.textContent = content;
      if (className) element.className = className;
      return element;
    };
    const dialog = create('dialog', '', 'learning-guide-dialog');
    dialog.dataset.learningGuidePage = coursePage ? 'course' : 'knowledge';
    dialog.setAttribute('aria-labelledby', 'learning-guide-title');
    const header = create('header');
    header.append(create('span', coursePage ? '课程指南' : '学习指南'));
    const close = create('button', '关闭');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭学习指南');
    header.append(close);
    const count = create('p', '', 'learning-caption');
    count.setAttribute('aria-live', 'polite');
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
    document.body.append(dialog);
    const courseTarget = (step) =>
      [...document.querySelectorAll(step.target)].find(
        (element) =>
          !element.disabled &&
          !element.closest('[hidden], .hidden') &&
          (!element.getClientRects || element.getClientRects().length > 0),
      );
    const knowledgeEntry = (step) =>
      step.interaction
        ? document.getElementById('knowledge-chat-toggle')
        : document.querySelector(`[data-knowledge-tool="${step.navigation.tool}"]`);
    const enabled = (element) =>
      Boolean(element && !element.disabled && element.getAttribute?.('aria-disabled') !== 'true');
    const knowledgeDestination = (step) =>
      document.getElementById(
        step.interaction
          ? 'knowledge-chat-input'
          : step.navigation.tool === 'content'
            ? step.navigation.view === 'origin'
              ? 'knowledge-history-toggle'
              : 'knowledge-body'
            : 'learning-heading',
      );
    const render = () => {
      const step = pageSteps[index];
      const target = coursePage ? courseTarget(step) : null;
      count.textContent = `${index + 1} / ${pageSteps.length}`;
      title.textContent = step.title;
      body.textContent = coursePage && !target && step.missingText ? step.missingText : step.text;
      action.textContent = step.action;
      action.disabled = coursePage ? !target : !enabled(knowledgeEntry(step));
      previous.disabled = index === 0;
      next.textContent = index === pageSteps.length - 1 ? '完成' : '下一步';
    };
    const open = () => {
      index = 0;
      returnFocus = true;
      render();
      if (!dialog.open) dialog.showModal();
      close.focus();
    };
    button.addEventListener('click', open);
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (returnFocus) button.focus({ preventScroll: true });
    });
    previous.addEventListener('click', () => {
      index = Math.max(0, index - 1);
      render();
    });
    next.addEventListener('click', () => {
      if (index === pageSteps.length - 1) dialog.close();
      else {
        index += 1;
        render();
      }
    });
    action.addEventListener('click', () => {
      const step = pageSteps[index];
      if (coursePage) {
        const target = courseTarget(step);
        // Targets are looked up again: the course can finish loading while the
        // guide is open, or its most recent learning position can change.
        if (!target) {
          render();
          return;
        }
        returnFocus = false;
        dialog.close();
        if (!target.hasAttribute('tabindex') && !target.matches('button, input, a[href]'))
          target.setAttribute('tabindex', '-1');
        target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        target.focus({ preventScroll: true });
        return;
      }
      if (!enabled(knowledgeEntry(step))) {
        render();
        close.focus();
        return;
      }
      // A deliberate tool jump owns its new focus. Native dialog close is
      // asynchronous and must not later put the learner back at the opener.
      returnFocus = false;
      dialog.close();
      if (step.interaction)
        page.dispatchEvent(
          new browser.CustomEvent('knowledge:open-interaction', { detail: step.interaction }),
        );
      else {
        page.dispatchEvent(
          new browser.CustomEvent('knowledge:tool-select', {
            detail: { tool: step.navigation.tool },
          }),
        );
        page.dispatchEvent(
          new browser.CustomEvent('knowledge:navigate', { detail: step.navigation }),
        );
      }
      const destination = knowledgeDestination(step);
      if (
        enabled(destination) &&
        !destination.closest('[hidden], .hidden') &&
        (!destination.getClientRects || destination.getClientRects().length > 0)
      ) {
        if (!destination.hasAttribute('tabindex') && !destination.matches('button, input, a[href]'))
          destination.setAttribute('tabindex', '-1');
        destination.focus({ preventScroll: true });
      } else {
        // An absent/failed optional feature must not leave focus on a closed
        // dialog. This is a safe return, not an automatic retry or navigation.
        returnFocus = true;
        button.focus({ preventScroll: true });
      }
    });
    const controller = { open, close: () => dialog.close(), getIndex: () => index };
    if (browser.MutationObserver) {
      const observer = new browser.MutationObserver(() => {
        if (dialog.open) render();
      });
      observer.observe(page, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'disabled', 'aria-disabled'],
      });
    }
    button.learningGuideController = controller;
    return controller;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = { steps, courseSteps, install };
    return;
  }
  root.FreeBbsLearningGuide = { steps, courseSteps, install };
  install(root);
})(typeof window === 'undefined' ? globalThis : window);
