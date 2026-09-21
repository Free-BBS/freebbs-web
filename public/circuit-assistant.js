(() => {
  const panel = document.getElementById('circuit-ai-panel');
  if (!panel || window.location.pathname.replace(/\/$/, '') === '/circuits') return;

  const $ = (id) => document.getElementById(`circuit-ai-${id}`);
  const app = window.freeBbsApp;
  const desktop = window.matchMedia('(min-width: 1250px)');
  const layout = document.getElementById('circuit-editor-layout');
  const tabNames = ['max', 'parameters'];
  const sidebarTab = (name) => document.getElementById(`circuit-sidebar-tab-${name}`);
  const sidebarPanel = (name) => document.getElementById(`circuit-sidebar-panel-${name}`);
  const state = {
    open: false,
    tab: 'max',
    sending: false,
    history: [],
    proposals: [],
    runner: null,
    suggestionController: null,
    agentStep: 0,
    progressMessage: '',
    agentArticles: new Map(),
    backgroundTaskId: '',
    returnFocus: null,
    inertElements: [],
  };

  function editor() {
    if (!window.FreeBbsCircuitEditor) throw new Error('电路还在加载，请稍后再试。');
    return window.FreeBbsCircuitEditor;
  }

  function status(message = '', error = false) {
    $('status').textContent = message;
    $('status').classList.toggle('is-error', error);
  }

  function updateRunbar() {
    const active = Boolean(
      state.runner?.isRunning() || state.suggestionController || state.backgroundTaskId,
    );
    $('runbar').hidden = !active || state.open;
    $('header-stop').hidden = !active || state.tab === 'max';
    $('runbar-status').textContent =
      state.progressMessage ||
      (state.agentStep ? `Max 正在执行 · 第 ${state.agentStep} 步` : 'Max 正在准备');
    $('toggle').classList.toggle('is-agent-running', active);
  }

  function updateMode() {
    const agent = $('mode').value === 'agent';
    if (!state.sending) $('send').textContent = agent ? '开始' : '发送';
    $('mode').disabled = state.sending;
  }

  function questionKey() {
    return `free_bbs_circuit_ai_question_v1:${window.location.pathname}${window.location.search}`;
  }

  function retainQuestion() {
    try {
      if ($('input').value) sessionStorage.setItem(questionKey(), $('input').value.slice(0, 4000));
      else sessionStorage.removeItem(questionKey());
      return true;
    } catch {
      return false;
    }
  }

  function restoreQuestion() {
    try {
      $('input').value = sessionStorage.getItem(questionKey())?.slice(0, 4000) || '';
    } catch {
      // The current input still works when this browser disallows session storage.
    }
  }

  function releaseBackground() {
    state.inertElements.forEach((element) => {
      element.inert = false;
    });
    state.inertElements = [];
    document.body.classList.remove('circuit-ai-drawer-open');
  }

  function updateModalState() {
    releaseBackground();
    const modal = state.open && !desktop.matches;
    $('backdrop').hidden = !modal;
    panel.setAttribute('role', modal ? 'dialog' : 'complementary');
    if (modal) {
      panel.setAttribute('aria-modal', 'true');
      document.body.classList.add('circuit-ai-drawer-open');
      let current = panel;
      while (current.parentElement && current !== document.body) {
        for (const sibling of current.parentElement.children) {
          if (
            sibling !== current &&
            sibling !== $('backdrop') &&
            !sibling.inert &&
            !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)
          ) {
            sibling.inert = true;
            state.inertElements.push(sibling);
          }
        }
        current = current.parentElement;
      }
    } else {
      panel.removeAttribute('aria-modal');
    }
  }

  function notifySidebar() {
    updateRunbar();
    window.dispatchEvent(
      new CustomEvent('freebbs:circuit-sidebar-change', {
        detail: { open: state.open, tab: state.tab, modal: state.open && !desktop.matches },
      }),
    );
  }

  function selectTab(name, { focus = false, notify = true } = {}) {
    if (!tabNames.includes(name)) return;
    state.tab = name;
    tabNames.forEach((tabName) => {
      const active = name === tabName;
      sidebarTab(tabName).setAttribute('aria-selected', String(active));
      sidebarTab(tabName).tabIndex = active ? 0 : -1;
      sidebarPanel(tabName).hidden = !active;
    });
    if (focus) sidebarTab(name).focus({ preventScroll: true });
    if (notify) notifySidebar();
  }

  function setOpen(open, { focus = false, tab } = {}) {
    if (open && !state.open) state.returnFocus = document.activeElement;
    if (tab) selectTab(tab, { notify: false });
    state.open = open;
    panel.hidden = !open;
    layout.classList.toggle('has-assistant', open);
    $('toggle').setAttribute('aria-expanded', String(open));
    $('toggle').setAttribute('aria-label', open ? '收起电路侧栏' : '打开电路侧栏');
    updateModalState();
    if (open && focus) {
      const target =
        state.tab === 'max' && !$('input').disabled ? $('input') : sidebarTab(state.tab);
      target.focus({ preventScroll: true });
      if (desktop.matches) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (!open && focus) {
      const target = state.returnFocus?.isConnected ? state.returnFocus : $('toggle');
      target.focus({ preventScroll: true });
    }
    notifySidebar();
    window.dispatchEvent(new Event('resize'));
  }

  function showQuestion(question) {
    setOpen(true, { focus: true, tab: 'max' });
    if (state.sending) return;
    $('input').value = question;
    retainQuestion();
    $('input').focus();
  }

  function renderContent(element, content) {
    if (app?.renderMarkdownContent) {
      element.innerHTML = app.renderMarkdownContent(content);
      app.enhanceMarkdownContent?.(element, { interactiveCodeControls: false });
    } else {
      element.textContent = content;
    }
  }

  function appendMessage(role, content, { pending = false } = {}) {
    $('intro').hidden = true;
    const article = document.createElement('article');
    article.className = `circuit-ai-message is-${role}`;
    const label = document.createElement('strong');
    label.className = 'circuit-ai-message-author';
    label.textContent = role === 'user' ? '你' : 'Max';
    const body = document.createElement('div');
    body.className = 'circuit-ai-message-body discussion-markdown-body';
    if (role === 'user' || pending) body.textContent = content;
    else renderContent(body, content);
    article.classList.toggle('is-pending', pending);
    article.append(label, body);
    $('thread').append(article);
    $('thread').scrollTop = $('thread').scrollHeight;
    return article;
  }

  function updateEditorState(snapshot) {
    if (!snapshot) return;
    $('context').textContent = snapshot.canEdit
      ? '当前画布 · 包含未保存的草稿'
      : '只读电路 · 可提问、查看高亮与波形';
    $('undo').disabled = !snapshot.canUndoAi || state.sending;
    $('clear-highlights').disabled = state.sending;
    state.proposals.forEach((proposal) => {
      if (proposal.applied) return;
      const stale = proposal.editVersion !== snapshot.editVersion;
      const readOnly = proposal.editing && !snapshot.canEdit;
      proposal.button.disabled = state.sending || stale || readOnly || proposal.applying;
      proposal.retry.hidden = !stale;
      proposal.note.textContent = stale
        ? '电路已变化，请基于当前草稿重新提问。'
        : readOnly
          ? '这是只读电路，复制为新电路后可应用修改。'
          : proposal.editing
            ? '应用到当前草稿后，可以撤销。保存电路后才会发布这些修改。'
            : '点选后在电路和仿真结果中查看。';
    });
  }

  function renderActions(article, actions, snapshot, question) {
    if (!actions?.length) return;
    const helper = window.CircuitAIActions;
    if (!helper) throw new Error('操作组件未加载，请刷新后重新提问。');
    const traceIds = (snapshot.simulation?.traces || []).map((trace) => trace.id);
    const validated = helper.validateActions(actions, snapshot.document, traceIds);
    if (!validated.length) return;
    const editing = validated.some((action) => helper.isEditingAction(action));
    const section = document.createElement('section');
    section.className = 'circuit-ai-proposal';
    section.setAttribute('aria-label', editing ? '电路修改建议' : '电路查看建议');
    const heading = document.createElement('h3');
    heading.textContent = editing ? '建议修改' : '在实验中查看';
    const list = document.createElement('ul');
    validated.forEach((action) => {
      const item = document.createElement('li');
      item.textContent = helper.describeAction(action);
      list.append(item);
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'circuit-ai-apply';
    button.textContent = editing
      ? '应用到草稿'
      : validated.every((action) => action.type === 'run_simulation')
        ? '运行仿真'
        : '在实验中查看';
    const note = document.createElement('p');
    note.className = 'circuit-ai-proposal-note';
    note.setAttribute('role', 'status');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'circuit-ai-reask';
    retry.textContent = '重新提问';
    retry.hidden = true;
    retry.addEventListener('click', () => showQuestion(question));
    const proposal = {
      actions: validated,
      editVersion: snapshot.editVersion,
      editing,
      applied: false,
      applying: false,
      button,
      note,
      retry,
    };
    button.addEventListener('click', async () => {
      if (state.sending) return;
      proposal.applying = true;
      button.disabled = true;
      try {
        const current = editor().getSnapshot();
        if (current.editVersion !== proposal.editVersion) {
          throw new Error('电路已变化，请基于当前草稿重新提问。');
        }
        const result = await editor().applyActions(proposal.actions, {
          expectedVersion: proposal.editVersion,
        });
        if (editing) {
          proposal.applied = true;
          retry.hidden = true;
          button.textContent = '已应用到草稿';
          note.textContent = '修改已应用，可用下方“撤销 AI 修改”恢复。';
        } else {
          note.textContent = '已在当前实验中显示。';
        }
        updateEditorState(result || editor().getSnapshot());
        status(editing ? '修改已应用到当前草稿。' : '已在实验中显示 Max 建议查看的内容。');
        if (!desktop.matches) setOpen(false, { focus: true });
      } catch (error) {
        note.textContent = error.message || '操作没有完成，请重新提问。';
        status('操作未应用，电路保持原状。', true);
      } finally {
        proposal.applying = false;
        const current = editor().getSnapshot();
        button.disabled =
          proposal.applied ||
          current.editVersion !== proposal.editVersion ||
          (proposal.editing && !current.canEdit);
      }
    });
    state.proposals.push(proposal);
    section.append(heading, list, button, retry, note);
    article.append(section);
    updateEditorState(editor().getSnapshot());
  }

  function agentEvent(event) {
    if (event.type === 'step') {
      state.agentStep = event.step;
      state.progressMessage = '';
      const article = appendMessage('assistant', '正在读取当前电路和操作结果…', {
        pending: true,
      });
      article.dataset.agentStep = event.step;
      article.querySelector('.circuit-ai-message-author').textContent = `Max · 第 ${event.step} 步`;
      state.agentArticles.set(event.step, article);
      status(`第 ${event.step} 步 · 正在决定下一步操作。`);
      updateRunbar();
      return;
    }
    const article = state.agentArticles.get(event.step);
    if (event.type === 'reasoning' && article) window.FreeBbsReasoning?.update(article, event);
    if (event.type === 'progress' && article) {
      if (typeof event.answer === 'string') {
        window.FreeBbsReasoning?.finish(article);
        article.querySelector('.circuit-ai-message-body').textContent = event.answer;
        article.dataset.streamAnswer = 'true';
      }
      if (event.message) {
        state.progressMessage = `第 ${event.step} 步 · ${event.message}`;
        status(state.progressMessage);
        updateRunbar();
      }
    }
    if (event.type === 'answer' && article) {
      window.FreeBbsReasoning?.finish(article);
      renderContent(article.querySelector('.circuit-ai-message-body'), event.answer);
      article.classList.remove('is-pending');
      delete article.dataset.streamAnswer;
    }
    if (event.type === 'actions' && article) {
      const section = document.createElement('section');
      section.className = 'circuit-agent-actions';
      section.setAttribute('aria-label', 'Max 执行操作');
      const list = document.createElement('ul');
      event.actions.forEach((action) => {
        const item = document.createElement('li');
        item.textContent = window.CircuitAIActions.describeAction(action);
        list.append(item);
      });
      const outcome = document.createElement('p');
      outcome.className = 'circuit-agent-outcome';
      outcome.dataset.agentOutcome = '';
      outcome.textContent = event.actions.some((action) => action.type === 'run_simulation')
        ? '正在执行并等待仿真结果…'
        : '正在执行…';
      section.append(list, outcome);
      article.append(section);
      state.progressMessage = `第 ${event.step} 步 · 正在执行 ${event.actions.length} 项操作。`;
      status(state.progressMessage);
      updateRunbar();
    }
    if (event.type === 'observation' && article) {
      let outcome = article.querySelector('[data-agent-outcome]');
      if (!outcome) {
        outcome = document.createElement('p');
        outcome.className = 'circuit-agent-outcome';
        outcome.dataset.agentOutcome = '';
        article.append(outcome);
      }
      outcome.dataset.status = event.status;
      outcome.textContent =
        event.status === 'success' ? '操作已完成，正在读取结果并决定下一步。' : event.summary;
      outcome.classList.toggle('is-error', event.status === 'error');
      article.classList.remove('is-pending');
      updateEditorState(editor().getSnapshot());
    }
    if (event.type === 'finish') {
      window.FreeBbsReasoning?.finish(article, { stopped: event.status !== 'complete' });
      if (article?.classList.contains('is-pending')) {
        article.classList.remove('is-pending');
        if (!article.dataset.streamAnswer)
          article.querySelector('.circuit-ai-message-body').textContent = event.reason;
      }
      const note = document.createElement('p');
      note.className = 'circuit-agent-outcome';
      note.dataset.agentFinish = event.status;
      note.textContent = event.reason;
      note.classList.toggle('is-error', event.status === 'error');
      (article || $('thread')).append(note);
      status(event.reason, ['error', 'stale', 'timeout'].includes(event.status));
    }
    $('thread').scrollTop = $('thread').scrollHeight;
  }

  async function requestAgentStep(payload, { signal, onProgress }) {
    try {
      const options = await window.FreeBbsMaxModels.circuitOptions(state.modelChoice);
      signal.throwIfAborted();
      return await app.streamCircuitChatResponse(
        { ...payload, ...options },
        { signal, onProgress },
      );
    } catch (error) {
      if (error.status === 401) {
        $('login').hidden = false;
        error.code = 'AGENT_STOPPED';
      }
      throw error;
    }
  }

  function circuitTaskScope(snapshot = editor().getSnapshot()) {
    return snapshot.cid || `draft:${app?.userState?.uid || 'user'}`;
  }

  async function waitForCircuitTask(task) {
    state.backgroundTaskId = task.id;
    let current = task;
    while (['queued', 'running'].includes(current.status)) {
      state.progressMessage = current.progress?.message || 'Max 正在后台运行，离开页面也会继续…';
      status(state.progressMessage);
      updateRunbar();
      await new Promise((resolve) => {
        window.setTimeout(resolve, 1500);
      });
      current = await app.getAiBackgroundTask(current.id, { watching: !document.hidden });
    }
    return current;
  }

  async function waitUntilVisible() {
    if (!document.hidden) return;
    await new Promise((resolve) => {
      const visible = () => {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', visible);
        resolve();
      };
      document.addEventListener('visibilitychange', visible);
    });
  }

  async function continueCircuitAgentTask(task, fallbackQuestion = '') {
    let current = task;
    let finalAnswer = '';
    while (true) {
      current = await waitForCircuitTask(current);
      if (current.status === 'failed') {
        await app.acknowledgeAiBackgroundTask(current.id).catch(() => {});
        state.backgroundTaskId = '';
        throw new Error(current.error || '电路后台任务失败。');
      }
      if (current.status === 'completed') {
        finalAnswer = String(current.result?.answer || '本轮自主执行已完成。');
        const article = appendMessage('assistant', finalAnswer);
        article.dataset.agentFinish = 'complete';
        await app.acknowledgeAiBackgroundTask(current.id).catch(() => {});
        state.backgroundTaskId = '';
        return finalAnswer;
      }
      if (current.status !== 'waiting' || !current.result?.actions?.length)
        throw new Error('电路后台任务返回了无效状态。');
      await waitUntilVisible();
      await app.setAiBackgroundTaskPresence(current.id, true).catch(() => {});
      const result = current.result;
      if (
        result.expectedDocument &&
        JSON.stringify(editor().getSnapshot().document) !== JSON.stringify(result.expectedDocument)
      ) {
        await app.cancelAiBackgroundTask(current.id).catch(() => {});
        await app.acknowledgeAiBackgroundTask(current.id).catch(() => {});
        state.backgroundTaskId = '';
        throw new Error('画布在任务等待期间已经变化，未执行后台生成的修改。请重新发起任务。');
      }
      agentEvent({ type: 'step', step: result.step });
      agentEvent({ type: 'answer', step: result.step, answer: result.answer });
      agentEvent({ type: 'actions', step: result.step, actions: result.actions });
      const opened = editor().beginAgentRun();
      let snapshot;
      try {
        snapshot = await editor().executeAgentActions(result.actions, {
          runId: opened.runId,
          expectedVersion: opened.snapshot.editVersion,
        });
      } finally {
        editor().endAgentRun(opened.runId);
      }
      const changed =
        JSON.stringify(opened.snapshot.document) !== JSON.stringify(snapshot.document);
      const observation = {
        step: result.step,
        status: 'success',
        summary: `操作已在用户返回页面后执行；${changed ? '画布已更新' : '画布状态未改变'}。`,
      };
      agentEvent({ type: 'observation', ...observation });
      const continuation = result.continuation || {};
      const observations = [...(continuation.observations || []), observation].slice(-24);
      const nextRequest = {
        question: continuation.question || fallbackQuestion,
        history: continuation.history || state.history.slice(-8),
        ...(continuation.model ? { model: continuation.model } : {}),
        ...(continuation.reasoning_effort
          ? { reasoning_effort: continuation.reasoning_effort }
          : {}),
        ...(continuation.vision_images?.length
          ? { vision_images: continuation.vision_images }
          : {}),
        document: snapshot.document,
        selection: snapshot.selection,
        simulation: snapshot.simulation,
        agent: {
          step: result.step + 1,
          canEdit: snapshot.canEdit === true,
          observations,
        },
      };
      current = await app.resumeAiBackgroundTask(current.id, {
        request: nextRequest,
        batches: [...(result.batches || []), result.actions].slice(-200),
      });
    }
  }

  async function submitAgent(question) {
    try {
      state.modelChoice = await window.FreeBbsMaxModels.selection();
      if (state.sending) return;
    } catch (error) {
      status(error.message, true);
      return;
    }
    state.sending = true;
    state.agentStep = 0;
    state.progressMessage = '';
    state.agentArticles = new Map();
    $('input').disabled = true;
    $('send').hidden = true;
    $('stop').hidden = false;
    $('login').hidden = true;
    $('thread').setAttribute('aria-busy', 'true');
    updateMode();
    appendMessage('user', question);
    try {
      const snapshot = editor().getSnapshot();
      const options = await window.FreeBbsMaxModels.circuitOptions(state.modelChoice);
      const task = await app.startAiBackgroundTask('circuit_agent', circuitTaskScope(snapshot), {
        request: {
          ...options,
          question,
          history: state.history.slice(-8),
          document: snapshot.document,
          selection: snapshot.selection,
          simulation: snapshot.simulation,
          agent: { step: 1, canEdit: snapshot.canEdit === true, observations: [] },
        },
        batches: [],
      });
      updateRunbar();
      const answer = await continueCircuitAgentTask(task, question);
      state.history.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer.slice(0, 4000) },
      );
      state.history = state.history.slice(-8);
      $('input').value = '';
      retainQuestion();
    } catch (error) {
      status(error.message || '无法继续自主执行，请重试。', true);
    } finally {
      state.sending = false;
      $('input').disabled = false;
      $('send').hidden = false;
      $('send').disabled = false;
      $('stop').hidden = true;
      $('thread').setAttribute('aria-busy', 'false');
      updateMode();
      updateRunbar();
      updateEditorState(editor().getSnapshot());
    }
  }

  async function restoreCircuitBackgroundTask() {
    if (state.sending || !app?.userState?.token) return;
    let task;
    const scope = circuitTaskScope();
    try {
      task = await app.getLatestAiBackgroundTask('circuit_agent', scope);
      if (!task) task = await app.getLatestAiBackgroundTask('circuit_suggest', scope);
    } catch {
      return;
    }
    if (!task || task.acknowledged) return;
    state.sending = true;
    state.backgroundTaskId = task.id;
    $('input').disabled = true;
    $('send').hidden = true;
    $('stop').hidden = false;
    $('thread').setAttribute('aria-busy', 'true');
    updateMode();
    updateRunbar();
    try {
      if (task.kind === 'circuit_agent') {
        const answer = await continueCircuitAgentTask(
          task,
          task.result?.continuation?.question || '继续电路任务',
        );
        state.history.push({ role: 'assistant', content: answer.slice(0, 4000) });
      } else {
        const finished = await waitForCircuitTask(task);
        if (finished.status !== 'completed')
          throw new Error(finished.error || '电路后台分析未能完成。');
        const result = finished.result || {};
        const snapshot = editor().getSnapshot();
        const article = appendMessage('assistant', result.answer || '分析已完成。');
        if (
          result.expectedDocument &&
          JSON.stringify(snapshot.document) === JSON.stringify(result.expectedDocument)
        ) {
          renderActions(article, result.actions, snapshot, '恢复后台分析');
        } else if (result.actions?.length) {
          status('画布已变化，回答已恢复，但旧操作建议不会应用。');
        }
        await app.acknowledgeAiBackgroundTask(finished.id).catch(() => {});
        state.backgroundTaskId = '';
      }
    } catch (error) {
      status(error.message || '恢复后台任务失败。', true);
    } finally {
      state.sending = false;
      $('input').disabled = false;
      $('send').hidden = false;
      $('send').disabled = false;
      $('stop').hidden = true;
      $('thread').setAttribute('aria-busy', 'false');
      updateMode();
      updateRunbar();
      updateEditorState(editor().getSnapshot());
    }
  }

  async function submit(event) {
    event.preventDefault();
    const question = $('input').value.trim();
    if (state.sending || !question) return;
    await app?.sessionReady;
    if (state.sending) return;
    if (!app?.userState?.token) {
      retainQuestion();
      status('登录后返回电路继续提问，输入内容会在此标签页保留。');
      $('login').hidden = false;
      return;
    }
    let snapshot;
    try {
      snapshot = editor().getSnapshot();
    } catch (error) {
      status(error.message, true);
      return;
    }
    if ($('mode').value === 'agent') {
      await submitAgent(question);
      return;
    }
    state.sending = true;
    updateMode();
    $('input').disabled = true;
    $('send').disabled = true;
    $('send').textContent = '思考中…';
    $('login').hidden = true;
    $('thread').setAttribute('aria-busy', 'true');
    updateEditorState(snapshot);
    appendMessage('user', question);
    const article = appendMessage('assistant', '正在读取当前电路与仿真结果…', { pending: true });
    const body = article.querySelector('.circuit-ai-message-body');
    status('Max 正在分析本次提问时的画布。');
    const controller = new AbortController();
    state.suggestionController = controller;
    state.agentStep = 0;
    state.progressMessage = 'Max 正在分析当前画布';
    $('send').hidden = true;
    $('stop').hidden = false;
    updateRunbar();
    try {
      const task = await app.startAiBackgroundTask('circuit_suggest', circuitTaskScope(snapshot), {
        request: {
          ...(await window.FreeBbsMaxModels.circuitOptions()),
          question,
          history: state.history.slice(-8).map((message) => ({
            role: message.role,
            content: message.content.slice(0, 4000),
          })),
          document: snapshot.document,
          selection: snapshot.selection,
          simulation: snapshot.simulation,
        },
      });
      const finished = await waitForCircuitTask(task);
      if (finished.status !== 'completed')
        throw new Error(finished.error || '电路后台分析未能完成。');
      const response = finished.result || {};
      await app.acknowledgeAiBackgroundTask(finished.id).catch(() => {});
      state.backgroundTaskId = '';
      const answer = String(response.answer || '').trim();
      if (!answer) throw new Error('Max 暂时没有返回回答，请重试。');
      window.FreeBbsReasoning?.finish(article);
      renderContent(body, answer);
      article.classList.remove('is-pending');
      state.history.push(
        { role: 'user', content: question },
        { role: 'assistant', content: answer },
      );
      state.history = state.history.slice(-8);
      $('input').value = '';
      retainQuestion();
      try {
        renderActions(article, response.actions, snapshot, question);
        status(response.actionWarning || '');
      } catch {
        status('回答已保留，操作建议未通过检查，请重新提问。', true);
      }
    } catch (error) {
      window.FreeBbsReasoning?.finish(article, { stopped: true });
      const stopped = error.code === 'AGENT_STOPPED' || error.name === 'AbortError';
      article.classList.remove('is-pending');
      article.classList.toggle('is-error', !stopped);
      body.textContent = stopped
        ? '已停止回答，你的问题仍保留在输入框。'
        : `暂时无法回答：${error.message || '请稍后重试。'}`;
      status('问题已保留，可以直接重试。', !stopped);
      if (error.status === 401) $('login').hidden = false;
    } finally {
      state.suggestionController = null;
      state.sending = false;
      updateMode();
      $('input').disabled = false;
      $('send').disabled = false;
      $('send').hidden = false;
      $('stop').hidden = true;
      $('send').textContent = '发送';
      $('thread').setAttribute('aria-busy', 'false');
      updateEditorState(editor().getSnapshot());
      updateRunbar();
      $('thread').scrollTop = $('thread').scrollHeight;
    }
  }

  $('toggle').addEventListener('click', () => setOpen(!state.open, { focus: true }));
  tabNames.forEach((name, index) => {
    const tab = sidebarTab(name);
    tab.addEventListener('click', () => selectTab(name));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabNames.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabNames.length) % tabNames.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabNames.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabNames[next], { focus: true });
    });
  });
  $('close').addEventListener('click', () => setOpen(false, { focus: true }));
  $('backdrop').addEventListener('click', () => setOpen(false, { focus: true }));
  $('form').addEventListener('submit', submit);
  $('mode').addEventListener('change', () => {
    updateMode();
    try {
      localStorage.setItem('free_bbs_circuit_max_mode', $('mode').value);
    } catch {
      // Mode selection remains available without browser storage.
    }
  });
  const stopAgent = () => {
    state.runner?.stop('已停止自主执行，已完成的修改保留在草稿中，可撤销。');
    state.suggestionController?.abort(
      Object.assign(new Error('已停止回答。'), { code: 'AGENT_STOPPED' }),
    );
    if (state.backgroundTaskId) {
      app
        ?.cancelAiBackgroundTask(state.backgroundTaskId)
        .then(() => status('后台任务已停止；已经应用的画布修改仍保留。'))
        .catch((error) => status(error.message || '暂时无法停止后台任务。', true));
    }
  };
  $('stop').addEventListener('click', stopAgent);
  $('header-stop').addEventListener('click', stopAgent);
  $('runbar-stop').addEventListener('click', stopAgent);
  $('runbar-open').addEventListener('click', () => setOpen(true, { focus: true, tab: 'max' }));
  $('input').addEventListener('input', retainQuestion);
  window.addEventListener('pagehide', () => {
    retainQuestion();
    app?.leaveAiBackgroundTask(state.backgroundTaskId);
  });
  document.addEventListener('visibilitychange', () => {
    if (!state.backgroundTaskId) return;
    if (document.hidden) app?.leaveAiBackgroundTask(state.backgroundTaskId);
    else app?.setAiBackgroundTaskPresence(state.backgroundTaskId, true).catch(() => {});
  });
  $('input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      $('form').requestSubmit();
    }
  });
  document.querySelectorAll('[data-circuit-ai-question]').forEach((button) => {
    button.addEventListener('click', () => showQuestion(button.dataset.circuitAiQuestion));
  });
  $('login').addEventListener('click', () => {
    if (!retainQuestion()) {
      status('浏览器暂时无法保留输入，请复制问题后通过页面顶部登录。', true);
      return;
    }
    setOpen(false);
    document.getElementById('user-name')?.click();
  });
  $('clear-highlights').addEventListener('click', () => {
    editor().clearHighlights();
    status('已清除电路和波形的高亮。');
  });
  $('undo').addEventListener('click', () => {
    try {
      updateEditorState(editor().undoAiActions());
      const proposal = [...state.proposals].reverse().find((item) => item.applied && !item.undone);
      if (proposal) {
        proposal.undone = true;
        proposal.button.textContent = '已撤销';
        proposal.note.textContent = '这批修改已撤销，电路已恢复。';
      }
      status('已撤销最近一轮 Max 修改。');
    } catch (error) {
      status(error.message, true);
    }
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false, { focus: true });
    }
    if (event.key !== 'Tab' || desktop.matches) return;
    const targets = [
      ...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]'),
    ].filter(
      (element) =>
        !element.disabled &&
        !element.hidden &&
        element.tabIndex >= 0 &&
        element.getClientRects().length,
    );
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  desktop.addEventListener('change', () => {
    setOpen(desktop.matches);
  });
  window.addEventListener('freebbs:circuit-editor-ready', () => {
    updateEditorState(editor().getSnapshot());
    restoreCircuitBackgroundTask();
  });
  window.addEventListener('freebbs:circuit-editor-change', (event) => {
    updateEditorState(event.detail);
  });
  window.addEventListener('freebbs:circuit-sidebar-request', (event) => {
    setOpen(true, { focus: true, tab: event.detail?.tab || 'max' });
  });
  window.FreeBbsCircuitSidebar = {
    open: (tab = 'max') => setOpen(true, { focus: true, tab }),
    close: ({ mobileOnly = false } = {}) => {
      if (state.open && (!mobileOnly || !desktop.matches)) setOpen(false, { focus: true });
    },
  };
  window.FreeBbsCircuitAssistant = {
    open: () => setOpen(true, { focus: true, tab: 'max' }),
  };
  if (window.FreeBbsCircuitEditor) {
    updateEditorState(editor().getSnapshot());
    restoreCircuitBackgroundTask();
  }
  try {
    if (localStorage.getItem('free_bbs_circuit_max_mode') === 'suggest')
      $('mode').value = 'suggest';
  } catch {
    // Autonomous execution is the default when storage is unavailable.
  }
  updateMode();
  restoreQuestion();
  setOpen(desktop.matches);
})();
