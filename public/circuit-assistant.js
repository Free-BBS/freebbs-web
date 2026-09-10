(() => {
  const panel = document.getElementById('circuit-ai-panel');
  if (!panel || window.location.pathname.replace(/\/$/, '') === '/circuits') return;

  const $ = (id) => document.getElementById(`circuit-ai-${id}`);
  const app = window.freeBbsApp;
  const desktop = window.matchMedia('(min-width: 1250px)');
  const layout = document.getElementById('circuit-editor-layout');
  const state = {
    open: false,
    sending: false,
    history: [],
    proposals: [],
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

  function setOpen(open, { focus = false } = {}) {
    if (open && !state.open) state.returnFocus = document.activeElement;
    state.open = open;
    panel.hidden = !open;
    layout.classList.toggle('has-assistant', open);
    $('toggle').setAttribute('aria-expanded', String(open));
    updateModalState();
    if (open && focus) {
      ($('input').disabled ? panel : $('input')).focus({ preventScroll: true });
      if (desktop.matches) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else if (!open && focus) {
      const target = state.returnFocus?.isConnected ? state.returnFocus : $('toggle');
      target.focus({ preventScroll: true });
    }
    window.dispatchEvent(new Event('resize'));
  }

  function showQuestion(question) {
    setOpen(true, { focus: true });
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
    state.proposals.forEach((proposal) => {
      if (proposal.applied) return;
      const stale = proposal.editVersion !== snapshot.editVersion;
      const readOnly = proposal.editing && !snapshot.canEdit;
      proposal.button.disabled = stale || readOnly || proposal.applying;
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
    state.sending = true;
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
    const timeout = window.setTimeout(() => controller.abort(), 180000);
    try {
      const response = await app.callApi('/ai/circuit/chat', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({
          question,
          history: state.history.slice(-8).map((message) => ({
            role: message.role,
            content: message.content.slice(0, 4000),
          })),
          document: snapshot.document,
          selection: snapshot.selection,
          simulation: snapshot.simulation,
        }),
      });
      const answer = String(response.answer || '').trim();
      if (!answer) throw new Error('Max 暂时没有返回回答，请重试。');
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
      article.classList.remove('is-pending');
      article.classList.add('is-error');
      body.textContent =
        error.name === 'AbortError'
          ? '这次回答等待时间较长，请稍后重试。你的问题仍保留在输入框。'
          : `暂时无法回答：${error.message || '请稍后重试。'}`;
      status('问题已保留，可以直接重试。', true);
      if (error.status === 401) $('login').hidden = false;
    } finally {
      window.clearTimeout(timeout);
      state.sending = false;
      $('input').disabled = false;
      $('send').disabled = false;
      $('send').textContent = '发送';
      $('thread').setAttribute('aria-busy', 'false');
      updateEditorState(editor().getSnapshot());
      $('thread').scrollTop = $('thread').scrollHeight;
    }
  }

  $('toggle').addEventListener('click', () => setOpen(!state.open, { focus: true }));
  $('close').addEventListener('click', () => setOpen(false, { focus: true }));
  $('backdrop').addEventListener('click', () => setOpen(false, { focus: true }));
  $('form').addEventListener('submit', submit);
  $('input').addEventListener('input', retainQuestion);
  window.addEventListener('pagehide', retainQuestion);
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
      status('已撤销最近一次 AI 修改。');
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
    const targets = [...panel.querySelectorAll('button, textarea, a[href], [tabindex="0"]')].filter(
      (element) => !element.disabled && !element.hidden && element.getClientRects().length,
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
  });
  window.addEventListener('freebbs:circuit-editor-change', (event) => {
    updateEditorState(event.detail);
  });
  window.FreeBbsCircuitAssistant = {
    open: () => setOpen(true, { focus: true }),
  };
  if (window.FreeBbsCircuitEditor) updateEditorState(editor().getSnapshot());
  restoreQuestion();
  setOpen(desktop.matches);
})();
