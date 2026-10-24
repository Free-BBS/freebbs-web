/* A small, learner-directed panel; callbacks never submit chat or assess mastery. */
(function exposeLearningWorkflowPanel(root) {
  const MODULE_LABELS = Object.freeze({
    overview: '查看概览',
    origin: '查看知识起源',
    read: '定点查阅正文',
    'worked-example': '查阅已有示例',
    retrieve: '回忆关键概念',
    practice: '尝试一道题',
    repair: '查找具体卡点',
    transfer: '检验一个变式',
    explore: '找一个探索方向',
    reflect: '留下批注或问题',
    revisit: '以后再回看',
  });
  const EXPLORATION_HINTS = Object.freeze({
    new: '可以先问一个直观现象，必要时再补术语与原理。',
    familiar: '从不确定的条件或应用出发，需要时定点查阅。',
    basic: '可以改变一个条件，看看原结论的边界。',
    advanced: '可以从反例、跨领域联系或可检验的假设出发。',
  });
  const object = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const workflowApi = () =>
    root.FreeBbsLearningWorkflow ||
    (typeof module !== 'undefined' && module.exports ? require('./learning-workflow') : null);
  function render(container, value = {}, handlers = {}) {
    const options = object(value) ? value : {};
    const actions = object(handlers) ? handlers : {};
    const session = workflowApi()?.normalizeSession(options.session);
    const document = container?.ownerDocument || root.document;
    if (
      !container?.append ||
      !document?.createElement ||
      !session ||
      !['review', 'explore'].includes(session.goal)
    )
      return false;
    const element = (tag, content = '', className = '') => {
      const node = document.createElement(tag);
      node.textContent = content;
      if (className) node.className = className;
      return node;
    };
    const card = element('section', '', 'learning-workflow-panel');
    card.id = 'learning-workflow-card';
    card.dataset.workflowGoal = session.goal;
    card.dataset.workflowPhase = session.phase;
    card.setAttribute('aria-label', session.goal === 'review' ? '这次复习' : '这次探索');
    const heading = (title, detail = '') => {
      const titleNode = element('h3', title);
      titleNode.tabIndex = -1;
      card.append(titleNode);
      if (detail) card.append(element('p', detail, 'learning-workflow-caption'));
    };
    const controls = element('div', '', 'learning-workflow-actions');
    let resourcePanel = null;
    const button = (label, callback, enabled = true) => {
      const control = element('button', label);
      control.type = 'button';
      control.disabled = !enabled;
      if (enabled) control.addEventListener('click', callback);
      return control;
    };
    const actionButton = (type, label, payload = {}) => {
      const control = button(
        label,
        () => actions.action({ type, ...payload }),
        typeof actions.action === 'function',
      );
      control.dataset.workflowAction = type;
      controls.append(control);
      return control;
    };
    const moduleButton = (moduleId, label, target = controls) => {
      const control = button(
        label,
        () => actions.module(moduleId),
        typeof actions.module === 'function',
      );
      control.dataset.workflowModule = moduleId;
      target.append(control);
      return control;
    };
    const askButton = (prompt, label = '请 Max 帮我一下') => {
      const control = button(label, () => actions.ask(prompt), typeof actions.ask === 'function');
      control.dataset.workflowAction = 'ask-max';
      controls.append(control);
      return control;
    };
    const finishButton = () => actionButton('finish', '本次先到这里');

    if (options.paused === true) {
      heading('本次先暂停', '准备好时，再从这里继续。');
      actionButton('resume', '继续本次');
    } else if (session.phase === 'finished') {
      heading('本次先到这里', '这是本次自主结束，不代表正式测评通过。');
      actionButton('resume', '继续本次');
    } else if (session.goal === 'review') {
      if (session.phase === 'recall') {
        heading('先回忆，或直接试一道', '想一想关键概念和条件；顺利就可以结束。');
        actionButton('review-clear', '想清楚了，结束本次').className = 'learning-workflow-primary';
        actionButton('review-gap', '有点卡住');
        if (options.hasPractice === true) actionButton('review-check', '试一道');
        askButton(
          '请先帮我确定这个知识点值得回忆的一个关键问题，让我自己解释，再按我的回答核对条件。',
        );
      } else if (session.phase === 'repair') {
        heading('只补卡住的这一处', '只查相关条件、解释或一步示范，不需要重读全文。');
        if (options.hasContent === true) moduleButton('read', '查原文');
        askButton(
          '我想核对这个知识点的一处疑问。请先问清我卡在哪里，再给一个能继续思考的提示，不要直接代做。',
        );
        if (options.hasPractice === true) actionButton('review-check', '再试一下');
        actionButton('review-clear', '已理顺，结束本次').className = 'learning-workflow-primary';
      } else {
        heading('核对一下，顺利就结束', '检查理由与适用条件，不需要从头重读。');
        actionButton('review-clear', '已理顺，结束本次').className = 'learning-workflow-primary';
        actionButton('review-gap', '还有点卡住');
        askButton(
          '请根据我实际给出的解释或作答，帮我核对关键条件；先给提示，没有我的作答时不要猜测我哪里做错了。',
        );
      }
    } else {
      heading(
        session.phase === 'question' ? '先从你关心的问题出发' : '围绕问题，按需找依据',
        EXPLORATION_HINTS[session.level],
      );
      const label = element('label', '我想弄清的问题', 'learning-workflow-question');
      const input = element('textarea');
      input.rows = 2;
      input.maxLength = 1000;
      input.placeholder = '写下一个好奇、疑问或应用方向，也可以先不填';
      const draft =
        typeof options.questionDraft === 'string' ? options.questionDraft : session.question || '';
      input.value = draft.slice(0, 1000);
      input.dataset.workflowQuestion = 'true';
      input.addEventListener('input', () => {
        if (typeof actions.draft === 'function') actions.draft(input.value);
      });
      label.append(input);
      card.append(label);
      const apply = button(
        '围绕这个问题探索',
        () => actions.action({ type: 'set-question', question: input.value }),
        typeof actions.action === 'function',
      );
      apply.dataset.workflowAction = 'set-question';
      apply.className = 'learning-workflow-primary';
      controls.append(apply);
      moduleButton('explore', '先找一个探索方向');
      askButton(
        '请结合当前课程内容和我这次的探索方向，帮助我把问题范围说清楚，区分已有依据与待验证的猜想；正文和练习只在需要时查用。',
      );
      finishButton();

      const seen = new Set();
      const modules = (Array.isArray(options.modules) ? options.modules : [])
        .filter((entry) => {
          if (
            !object(entry) ||
            typeof entry.moduleId !== 'string' ||
            !Object.hasOwn(MODULE_LABELS, entry.moduleId) ||
            entry.moduleId === 'explore' ||
            entry.available !== true ||
            seen.has(entry.moduleId) ||
            (entry.moduleId === 'read' && options.hasContent !== true) ||
            (entry.moduleId === 'practice' && options.hasPractice !== true)
          )
            return false;
          seen.add(entry.moduleId);
          return true;
        })
        .slice(0, Object.keys(MODULE_LABELS).length);
      if (modules.length) {
        const details = element('details', '', 'learning-workflow-resources');
        details.append(element('summary', '按需找资料或检验'));
        const choices = element('div', '', 'learning-workflow-actions');
        modules.forEach(({ moduleId, title }) => {
          moduleButton(
            moduleId,
            typeof title === 'string' && title.trim()
              ? title.trim().slice(0, 100)
              : MODULE_LABELS[moduleId],
            choices,
          );
        });
        details.append(choices);
        resourcePanel = details;
      }
    }
    card.append(controls);
    if (resourcePanel) card.append(resourcePanel);
    container.append(card);
    return true;
  }
  const api = { render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else Object.assign(root, { FreeBbsLearningWorkflowPanel: api });
})(typeof window !== 'undefined' ? window : globalThis);
