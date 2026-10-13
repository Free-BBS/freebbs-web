/* Course tools: private records are server-backed; browser storage holds view preferences only. */
(() => {
  const labels = {
    content: ['知识正文', '正文', ''],
    resources: ['学习资源', '资源', ''],
    feedback: ['学习反馈', '题目', ''],
    continue: ['继续学习', '继续', ''],
    notes: ['我的批注', '批注', ''],
    contribute: ['参与共建', '共建', ''],
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { labels };
    return;
  }
  const page = document.querySelector('[data-knowledge-page]');
  const root = document.getElementById('learning-workspace');
  const app = window.freeBbsApp;
  if (!page || !root || !app) return;
  page.dataset.learningToolsReady = 'true';
  const el = (id) => document.getElementById(`learning-${id}`);
  const state = {
    ready: false,
    tool: 'content',
    entries: [],
    cursor: null,
    generation: 0,
    editing: null,
    busy: false,
    plan: null,
    planRecord: null,
    latestPath: null,
    annotationEntries: [],
    annotationCursor: null,
    planDirty: false,
    planPaused: false,
    planKey: null,
    attempts: [],
    currentAttempts: undefined,
    questions: [],
    practiceQuestions: [],
    resources: [],
    planGoal: '',
    contributionAnchor: null,
    uid: '',
    token: '',
    loaded: false,
    positions: {},
    reviewEntries: [],
    reviewCursor: null,
    reviewLoaded: false,
    reviewLoading: false,
    reviewVisible: false,
    reviewMessage: '',
    reviewEpoch: 0,
    reviewDrafts: new Map(),
    reviewErrors: new Map(),
    reviewSaving: new Set(),
    reviewHandled: new Set(),
  };
  const show = (element, visible) => {
    if (!element) return;
    element.hidden = !visible;
    element.classList.toggle('hidden', !visible);
  };
  const text = (tag, value, className) => {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  };
  const endpoint = () =>
    `/learning/${encodeURIComponent(state.course.slug)}/${encodeURIComponent(state.node.id)}`;
  const prefKey = () =>
    `free_bbs_learning_view_v2:${JSON.stringify([state.uid, state.course?.slug, state.node?.id])}`;
  const scrollHost = () => window.FreeBbsLearningReader?.getScrollHost?.() || window;
  const scrollPosition = () => (scrollHost() === window ? window.scrollY : scrollHost().scrollTop);
  const loggedIn = () => Boolean(app.userState?.token && app.userState?.isLoggedIn && !state.stale);
  function currentPlanGoal() {
    return !state.stale &&
      state.ready &&
      state.uid === (app.userState?.uid || '') &&
      state.token === (app.userState?.token || '') &&
      ['concepts', 'practice', 'explore'].includes(state.planGoal)
      ? state.planGoal
      : '';
  }
  // A read-only, same-page intention; it is not a saved preference or ability estimate.
  window.FreeBbsLearningWorkspace = { currentGoal: currentPlanGoal };
  function sessionMessage(message) {
    el('session').textContent = message || (loggedIn() ? '' : '登录后可保存学习记录。');
  }
  function status(form, message) {
    form.querySelector('[role="status"]').textContent = message;
  }
  function keepPreference() {
    if (!state.ready) return;
    try {
      localStorage.setItem(
        prefKey(),
        JSON.stringify({ tool: state.tool, positions: state.positions }),
      );
    } catch {
      /* Interaction stays usable. */
    }
  }
  function switchTool(tool, { focus = false, restore = true, preserveView = false } = {}) {
    if (!labels[tool]) return;
    if (
      tool === 'notes' &&
      state.ready &&
      state.node &&
      !window.FreeBbsLearningNextSteps?.hasReadableContent?.(state.node) &&
      !window.FreeBbsLearningContent?.originMarkdown?.(state.node.sections)
    ) {
      openInteraction('max');
      return;
    }
    const changed = state.tool !== tool;
    const readingTools = ['content', 'notes'];
    if (changed) page.dispatchEvent(new CustomEvent('knowledge:before-tool-change'));
    if (!state.restoring) {
      state.positions[state.tool] = scrollPosition();
      if (readingTools.includes(state.tool)) state.positions.content = scrollPosition();
    }
    state.tool = tool;
    page.dataset.learningTool = tool;
    show(root, tool !== 'content' && tool !== 'notes');
    document.querySelectorAll('[data-knowledge-tool]').forEach((button) => {
      const selected = button.dataset.knowledgeTool === tool;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (tool === 'content' || tool === 'notes') {
      if (!preserveView || tool === 'notes')
        page.dispatchEvent(new CustomEvent('knowledge:show-content'));
    } else {
      show(document.getElementById('knowledge-overview'), false);
      show(document.getElementById('knowledge-reading'), false);
    }
    root
      .querySelectorAll('[data-learning-panel]')
      .forEach((panel) => show(panel, panel.dataset.learningPanel === tool));
    // The notes tool opens the annotation layer on the canonical body, never
    // a second notebook/record list in the normal reading layout.
    show(document.querySelector('[data-learning-panel="notes"]'), false);
    el('heading').textContent = labels[tool][0];
    el('description').textContent = labels[tool][2];
    show(el('description'), Boolean(labels[tool][2]));
    if (tool === 'continue') refreshPlan();
    if (tool === 'notes') {
      window.FreeBbsKnowledgeAnnotations?.setEditing?.(true);
      window.FreeBbsKnowledgeAnnotations?.refresh?.();
    } else window.FreeBbsKnowledgeAnnotations?.setEditing?.(false);
    show(
      el('load-more'),
      Boolean(state.cursor) && ['notes', 'feedback', 'contribute'].includes(tool),
    );
    const toolsStatus = document.querySelector('#knowledge-tools-status p');
    if (toolsStatus) toolsStatus.textContent = `正在查看${labels[tool][0]}`;
    if (restore && !(readingTools.includes(tool) && readingTools.includes(state.previousTool))) {
      const generation = state.generation;
      const owner = [state.uid, state.token];
      window.requestAnimationFrame(() => {
        if (
          generation !== state.generation ||
          tool !== state.tool ||
          owner[0] !== (app.userState?.uid || '') ||
          owner[1] !== (app.userState?.token || '') ||
          state.stale
        )
          return;
        if (
          !state.restoring &&
          readingTools.includes(tool) &&
          window.FreeBbsLearningReader?.restore?.()
        )
          return;
        scrollHost().scrollTo({
          top: state.positions[readingTools.includes(tool) ? 'content' : tool] || 0,
          behavior: 'instant',
        });
      });
    }
    state.previousTool = tool;
    if (focus && tool !== 'content' && tool !== 'notes')
      el('heading').focus({ preventScroll: true });
    keepPreference();
    if (changed && state.ready && !state.restoring)
      page.dispatchEvent(new CustomEvent('knowledge:tool-change', { detail: { tool } }));
    if (
      state.ready &&
      loggedIn() &&
      !state.loaded &&
      ['notes', 'feedback', 'contribute', 'continue'].includes(tool)
    )
      loadEntries();
  }
  function requestTool(tool) {
    page.dispatchEvent(new CustomEvent('knowledge:tool-select', { detail: { tool } }));
  }
  function resetNote() {
    el('note-dialog')?.close?.();
    state.editing = null;
    el('note-form').reset();
    delete el('note-form').dataset.requestKey;
    el('note-form-title').textContent = '补充笔记';
    show(el('note-cancel'), false);
  }
  function recordCard(entry, review = false) {
    const card = text('article', '', 'learning-record');
    card.dataset.recordId = entry.id;
    card.append(text('h3', entry.title || '学习复盘'));
    card.append(text('time', new Date(entry.updatedAt).toLocaleString('zh-CN')));
    if (entry.kind === 'contribution')
      card.append(
        text(
          'span',
          { pending: '待课程组处理', handled: '已处理', declined: '暂不采纳' }[entry.status] ||
            '待处理',
          'learning-badge',
        ),
      );
    if (entry.feeling)
      card.append(
        text(
          'span',
          { stuck: '还没理顺', getting: '能说出思路', practice: '想做点练习' }[entry.feeling],
          'learning-badge',
        ),
      );
    if (entry.excerpt) card.append(text('blockquote', entry.excerpt));
    if (entry.annotation?.anchor?.quote)
      card.append(text('blockquote', entry.annotation.anchor.quote));
    if (entry.resource?.sourceUrl) {
      const link = text('a', '查看投稿资料');
      try {
        const url = new URL(entry.resource.sourceUrl);
        if (['https:', 'http:'].includes(url.protocol)) {
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          card.append(link);
        }
      } catch {
        /* An invalid old link is not made clickable. */
      }
    }
    card.append(text('p', entry.content));
    if (entry.response) card.append(text('blockquote', `课程组回复：${entry.response}`));
    const actions = text('div', '', 'learning-actions');
    function action(label, handler) {
      const button = text('button', label);
      button.type = 'button';
      button.addEventListener('click', handler);
      actions.append(button);
    }
    if (review && entry.status === 'pending') {
      const draftKey = reviewKey(entry);
      const generation = state.generation;
      const epoch = state.reviewEpoch;
      const scope = reviewScope();
      const currentScope = () => reviewCurrent(generation, epoch, scope);
      const currentEntry = () =>
        currentScope() && state.reviewEntries.some((record) => reviewKey(record) === draftKey);
      const reply = document.createElement('textarea');
      reply.maxLength = 1000;
      reply.placeholder = '给同学的处理说明（必填）';
      reply.setAttribute('aria-label', `回复：${entry.title}`);
      reply.dataset.reviewKey = draftKey;
      reply.value = state.reviewDrafts.get(draftKey) ?? '';
      reply.disabled = state.reviewSaving.has(draftKey);
      reply.addEventListener('input', () => {
        if (!currentEntry() || state.reviewSaving.has(draftKey)) return;
        state.reviewDrafts.set(draftKey, reply.value);
        state.reviewErrors.delete(draftKey);
        result.textContent = '';
      });
      const result = text('p', state.reviewErrors.get(draftKey) || '', 'learning-form-status');
      result.setAttribute('role', 'status');
      card.append(reply, result);
      ['handled', 'declined'].forEach((decision) =>
        action(decision === 'handled' ? '标记已处理' : '暂不采纳', async () => {
          if (!currentEntry() || state.reviewSaving.has(draftKey)) return;
          if (!reply.value.trim()) {
            result.textContent = '请填写处理说明。';
            return;
          }
          state.reviewDrafts.set(draftKey, reply.value);
          state.reviewErrors.delete(draftKey);
          state.reviewSaving.add(draftKey);
          reply.disabled = true;
          actions.querySelectorAll('button').forEach((button) => {
            button.disabled = true;
          });
          let saved = false;
          try {
            await app.callApi(`${endpoint()}/entries/${encodeURIComponent(entry.id)}/review`, {
              method: 'PATCH',
              body: JSON.stringify({ status: decision, response: reply.value }),
            });
            if (!currentScope()) return;
            state.reviewHandled.add(String(entry.id));
            state.reviewEntries = state.reviewEntries.filter(
              (record) => String(record.id) !== String(entry.id),
            );
            state.reviewDrafts.delete(draftKey);
            state.reviewErrors.delete(draftKey);
            state.reviewSaving.delete(draftKey);
            saved = true;
            // Leave unrelated reply nodes connected: a teacher can keep typing
            // in B while A finishes, without a blur/refocus cycle or IME reset.
            el('review-records')
              .querySelectorAll('.learning-record')
              .forEach((record) => {
                if (record.dataset.recordId === String(entry.id)) record.remove();
              });
            const count = el('review-records').querySelector('.learning-review-count');
            if (count) count.textContent = reviewCountText();
            if (!state.reviewEntries.length) renderReview();
            await loadEntries();
          } catch (error) {
            if (!currentScope()) return;
            if (error.status === 401 || error.status === 403) {
              resetReviewQueue();
              show(el('review-section'), false);
              el('review-records').replaceChildren();
              el('review-refresh').disabled = false;
              return;
            }
            state.reviewErrors.set(draftKey, error.message || '处理保存失败，回复仍保留，可重试。');
          } finally {
            if (currentScope()) {
              state.reviewSaving.delete(draftKey);
              if (!saved) renderReview();
            }
          }
        }),
      );
      actions.querySelectorAll('button').forEach((button) => {
        button.disabled = state.reviewSaving.has(draftKey);
      });
    } else if (!review && entry.kind === 'note')
      action('编辑', () => {
        if (state.busy) {
          sessionMessage('请等待当前保存完成后再编辑。');
          return;
        }
        if (
          el('note-form').elements.content.value.trim() &&
          !window.confirm('当前有未保存的笔记，改为编辑这条记录吗？')
        )
          return;
        state.editing = entry;
        el('note-form').elements.title.value = entry.title;
        el('note-form').elements.content.value = entry.content;
        el('note-form-title').textContent = '编辑个人笔记';
        el('note-composer').open = true;
        show(el('note-cancel'), true);
        el('note-form').scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    if (!review && ['note', 'reflection'].includes(entry.kind))
      action('删除', async () => {
        if (!window.confirm('确定删除这条个人记录？此操作不能撤销。')) return;
        const generation = state.generation;
        try {
          await app.callApi(`${endpoint()}/entries/${entry.id}`, { method: 'DELETE' });
          if (generation !== state.generation) return;
          if (state.editing?.id === entry.id) resetNote();
          await loadEntries();
          if (generation === state.generation)
            page.dispatchEvent(
              new CustomEvent('knowledge:personal-saved', { detail: { kind: entry.kind } }),
            );
        } catch (error) {
          if (generation === state.generation) sessionMessage(error.message);
        }
      });
    card.append(actions);
    return card;
  }
  function renderEntries() {
    [
      ['notes', 'note', '暂无补充笔记。'],
      ['reflections', 'reflection', '暂无复盘。'],
      ['contributions', 'contribution', '暂无提交。'],
    ].forEach(([id, kind, empty]) => {
      const container = el(id);
      container.replaceChildren();
      const entries = state.entries.filter((entry) => entry.kind === kind && !entry.annotation);
      entries.forEach((entry) => container.append(recordCard(entry)));
      if (!entries.length)
        container.append(text('p', state.loaded ? empty : '记录尚未加载。', 'learning-caption'));
    });
    page.dispatchEvent(
      new CustomEvent('knowledge:entries-loaded', {
        detail: { entries: state.entries, course: state.course, node: state.node },
      }),
    );
    refreshPlan();
    show(
      el('load-more'),
      Boolean(state.cursor) && ['notes', 'feedback', 'contribute'].includes(state.tool),
    );
  }
  async function loadEntries(more = false) {
    if (!state.ready || !loggedIn()) {
      sessionMessage();
      return;
    }
    const generation = state.generation;
    const request = (state.loadRequest || 0) + 1;
    state.loadRequest = request;
    el('load-more').disabled = true;
    try {
      const [payload, paths] = await Promise.all([
        app.callApi(
          `${endpoint()}/entries${more && state.cursor ? `?before=${encodeURIComponent(state.cursor)}` : ''}`,
          { method: 'GET' },
        ),
        app.callApi(`${endpoint()}/entries?kind=path`, { method: 'GET' }),
      ]);
      if (generation !== state.generation || request !== state.loadRequest) return;
      state.entries = more
        ? [
            ...new Map(
              [...state.entries, ...payload.entries].map((item) => [item.id, item]),
            ).values(),
          ]
        : payload.entries;
      state.cursor = payload.nextCursor;
      state.latestPath = paths.entries.find((entry) => entry.kind === 'path') || null;
      state.loaded = true;
      renderEntries();
      if (!more) await loadAnnotationRecords();
      sessionMessage();
    } catch (error) {
      if (generation === state.generation && request === state.loadRequest)
        sessionMessage(`记录加载失败：${error.message}。可点击刷新记录重试。`);
    } finally {
      if (generation === state.generation && request === state.loadRequest)
        el('load-more').disabled = false;
    }
  }
  function reviewScope() {
    return JSON.stringify([
      state.uid,
      state.token,
      state.course?.slug,
      state.node?.id,
      state.node?.documentVersion,
    ]);
  }
  function reviewKey(entry) {
    return JSON.stringify([state.course?.slug, state.node?.id, String(entry.id), entry.revision]);
  }
  function reviewCurrent(generation, epoch, scope) {
    return (
      generation === state.generation &&
      epoch === state.reviewEpoch &&
      scope === reviewScope() &&
      state.uid === (app.userState?.uid || '') &&
      state.token === (app.userState?.token || '') &&
      loggedIn()
    );
  }
  function resetReviewQueue(preserveDrafts = false) {
    state.reviewEpoch += 1;
    state.reviewEntries = [];
    state.reviewCursor = null;
    state.reviewLoaded = false;
    state.reviewLoading = false;
    state.reviewVisible = false;
    state.reviewMessage = '';
    state.reviewSaving.clear();
    state.reviewHandled.clear();
    state.reviewErrors.clear();
    if (!preserveDrafts) state.reviewDrafts.clear();
  }
  function reviewCountText() {
    return `已加载待处理 ${state.reviewEntries.length} 条。${state.reviewCursor ? '还有更早的建议。' : '本次队列已加载完毕，可刷新查看新建议。'}`;
  }
  function renderReview() {
    show(el('review-section'), state.reviewVisible || Boolean(state.course?.canEditMap));
    el('review-refresh').disabled = state.reviewLoading;
    const records = el('review-records');
    const active = document.activeElement;
    const focus =
      active?.dataset?.reviewKey && records.contains?.(active)
        ? { key: active.dataset.reviewKey, start: active.selectionStart, end: active.selectionEnd }
        : null;
    records.replaceChildren();
    if (state.reviewMessage) {
      const message = text('p', state.reviewMessage, 'learning-form-status');
      message.setAttribute('role', 'status');
      records.append(message);
    }
    if (state.reviewLoaded) {
      records.append(text('p', reviewCountText(), 'learning-caption learning-review-count'));
      if (!state.reviewEntries.length) records.append(text('p', '当前没有待处理的建议。'));
    }
    state.reviewEntries.forEach((entry) => records.append(recordCard(entry, true)));
    if (state.reviewCursor) {
      const more = text(
        'button',
        state.reviewLoading ? '正在加载更早建议…' : '加载更早的待处理建议',
        'button button-ghost learning-review-more',
      );
      more.type = 'button';
      more.disabled = state.reviewLoading;
      more.addEventListener('click', () => loadReview(true));
      records.append(more);
    }
    if (focus) {
      const reply = [...records.querySelectorAll('textarea')].find(
        (item) => item.dataset.reviewKey === focus.key,
      );
      if (reply && !reply.disabled) {
        reply.focus({ preventScroll: true });
        reply.setSelectionRange(focus.start, focus.end);
      }
    }
  }
  async function loadReview(more = false) {
    if (!state.ready || !loggedIn() || state.reviewLoading) return;
    const cursor = more ? state.reviewCursor : null;
    if (more && !cursor) return;
    const generation = state.generation;
    const epoch = state.reviewEpoch;
    const scope = reviewScope();
    const request = (state.reviewRequest || 0) + 1;
    state.reviewRequest = request;
    const current = () =>
      reviewCurrent(generation, epoch, scope) && request === state.reviewRequest;
    state.reviewLoading = true;
    state.reviewMessage = more ? '正在加载更早的待处理建议…' : '正在刷新课程组收件箱…';
    renderReview();
    try {
      const payload = await app.callApi(
        `${endpoint()}/entries?review=pending${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`,
        { method: 'GET' },
      );
      if (!current()) return;
      if (!Array.isArray(payload.entries) || (cursor && payload.nextCursor === cursor))
        throw new Error('收件箱分页返回格式无效，请重试。');
      const entries = [...(more ? state.reviewEntries : []), ...payload.entries].filter(
        (entry) =>
          entry.kind === 'contribution' &&
          entry.status === 'pending' &&
          !state.reviewHandled.has(String(entry.id)),
      );
      state.reviewEntries = [
        ...new Map(entries.map((entry) => [String(entry.id), entry])).values(),
      ];
      state.reviewCursor = payload.nextCursor || null;
      state.reviewLoaded = true;
      state.reviewVisible = true;
      state.reviewMessage = '';
    } catch (error) {
      if (!current()) return;
      if (error.status === 401 || error.status === 403) {
        resetReviewQueue();
        show(el('review-section'), false);
        el('review-records').replaceChildren();
        el('review-refresh').disabled = false;
        return;
      }
      state.reviewMessage = `${error.message || '课程组收件箱暂时不可用'}；${more ? '已加载建议与回复保留，可再次加载更早建议。' : '可点击刷新待处理重试，当前回复仍保留。'}`;
    } finally {
      if (current()) {
        state.reviewLoading = false;
        renderReview();
      }
    }
  }
  async function loadAnnotationRecords(more = false) {
    if (!state.ready || !loggedIn()) return;
    const generation = state.generation;
    const request = (state.annotationRequest || 0) + 1;
    state.annotationRequest = request;
    let cursor = more ? state.annotationCursor : null;
    if (more && !cursor) return;
    const entries = more ? [...state.annotationEntries] : [];
    try {
      for (let index = 0; index < 10; index += 1) {
        const payload = await app.callApi(
          `${endpoint()}/entries?kind=note&annotations=1${cursor ? `&before=${encodeURIComponent(cursor)}` : ''}`,
          { method: 'GET' },
        );
        if (generation !== state.generation || request !== state.annotationRequest) return;
        entries.push(...payload.entries);
        cursor = payload.nextCursor;
        if (!cursor) break;
      }
      state.annotationEntries = [...new Map(entries.map((entry) => [entry.id, entry])).values()];
      state.annotationCursor = cursor;
      page.dispatchEvent(
        new CustomEvent('knowledge:annotation-records-loaded', {
          detail: {
            entries: state.annotationEntries,
            nextCursor: cursor,
            course: state.course,
            node: state.node,
          },
        }),
      );
    } catch (error) {
      if (generation === state.generation && request === state.annotationRequest)
        el('annotation-status').textContent = `评注加载失败：${error.message}。可刷新记录重试。`;
    }
  }
  async function saveForm(form, kind) {
    if (!loggedIn()) {
      status(form, '请先登录后保存。');
      return;
    }
    if (state.busy) return;
    const generation = state.generation;
    const data = Object.fromEntries(new FormData(form));
    data.kind = kind;
    if (kind === 'contribution') {
      if (data.category === 'correction' && state.contributionAnchor)
        data.anchor = state.contributionAnchor;
      if (data.category === 'resource')
        data.resource = {
          resourceLevel: data.resourceLevel,
          coverage:
            data.resourceLevel === 'knowledge'
              ? `${state.node.id} ${state.node.title}`
              : data.coverage,
          sourceUrl: data.sourceUrl,
          permission: { source: data.resourceSource, license: data.resourceLicense },
        };
    }
    if (!form.dataset.requestKey) form.dataset.requestKey = window.crypto.randomUUID();
    data.requestKey = form.dataset.requestKey;
    const editing = kind === 'note' ? state.editing : null;
    if (editing) data.revision = editing.revision;
    state.busy = true;
    form.querySelectorAll('input, textarea, select, button').forEach((input) => {
      input.disabled = true;
    });
    status(form, '正在保存…');
    try {
      await app.callApi(`${endpoint()}/entries${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(data),
      });
      if (generation !== state.generation) return;
      form.reset();
      delete form.dataset.requestKey;
      if (kind === 'note') resetNote();
      if (kind === 'contribution') {
        state.contributionAnchor = null;
        syncContributionForm();
      }
      status(
        form,
        kind === 'contribution' ? '已提交给课程组，可在下方查看处理状态。' : '已保存到你的账号。',
      );
      await loadEntries();
      if (generation !== state.generation) return;
      if (kind === 'contribution')
        page.dispatchEvent(
          new CustomEvent('knowledge:contribution-saved', { detail: { success: true } }),
        );
      else if (kind === 'note' || kind === 'reflection')
        page.dispatchEvent(new CustomEvent('knowledge:personal-saved', { detail: { kind } }));
    } catch (error) {
      if (generation === state.generation)
        status(form, `保存失败：${error.message}。输入仍在，请核对后重试。`);
    } finally {
      if (generation === state.generation) {
        state.busy = false;
        form.querySelectorAll('input, textarea, select, button').forEach((input) => {
          input.disabled = false;
        });
        if (kind === 'contribution') syncContributionForm();
      }
    }
  }
  function draftAnswer(answer) {
    if (state.busy) {
      sessionMessage('请等待当前保存完成后再整理回答。');
      return;
    }
    if (
      el('note-form').elements.content.value.trim() &&
      !window.confirm('当前有未保存的笔记，是否改为保存这条 Max 回答？')
    )
      return;
    resetNote();
    el('note-form').elements.title.value = `Max 回答 · ${state.node.title}`.slice(0, 120);
    el('note-form').elements.content.value = answer.slice(0, 8000);
    el('note-composer').open = true;
    status(
      el('note-form'),
      answer.length > 8000
        ? '回答较长，已取前 8000 字。请整理后点击保存；AI 内容请结合课程核验。'
        : '已放入笔记草稿，点击保存才会写入账号；AI 内容请结合课程核验。',
    );
    // Saving a Max answer is an explicitly requested supplemental note, not
    // a reason to expand a notebook underneath the course text.
    let dialog = el('note-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'learning-note-dialog';
      dialog.className = 'learning-note-dialog';
      dialog.setAttribute('aria-labelledby', 'learning-note-form-title');
      const close = text('button', '×', 'learning-note-dialog-close');
      close.type = 'button';
      close.setAttribute('aria-label', '关闭补充笔记，保留草稿');
      close.addEventListener('click', () => dialog.close());
      dialog.append(close, el('note-form'));
      document.body.append(dialog);
    }
    window.FreeBbsKnowledgeAnnotations?.setEditing?.(false);
    show(el('note-cancel'), true);
    el('note-cancel').textContent = '取消';
    if (!dialog.open) dialog.showModal();
  }
  function openInteraction(tab = 'max', prompt = '', selectionContext = null) {
    page.dispatchEvent(
      new CustomEvent('knowledge:open-interaction', {
        detail: { tab, prompt, ...(selectionContext ? { selectionContext } : {}) },
      }),
    );
  }
  function refreshPlan(reset = false) {
    if (!state.ready || !window.FreeBbsLearningNextSteps) return;
    if ((state.planDirty || state.planPaused) && !reset) return;
    const context = window.freeBbsKnowledge?.getLearningContext?.() || {};
    const tags = context.tags || {};
    const record =
      !reset && (state.latestPath || state.entries.find((entry) => entry.kind === 'path'));
    state.planRecord = record || null;
    state.plan = window.FreeBbsLearningNextSteps.recommend({
      node: state.node,
      map: context.map || {},
      status: tags.learned
        ? 'completed'
        : record || state.attempts.length
          ? 'learning'
          : 'unlearned',
      important: Boolean(tags.important),
      recentAttempts: state.attempts,
      currentAttempts: state.currentAttempts,
      questions: state.questions,
      practiceQuestions: state.practiceQuestions,
      resources: state.resources,
      hasOrigin: Boolean(window.FreeBbsLearningContent?.originMarkdown?.(state.node.sections)),
      activeGoal: state.planGoal,
      documentVersion: state.node.documentVersion,
      existingPath: record?.path,
      learningStartPreference: window.FreeBbsLearningStart?.currentPreference?.(),
    });
    if (record?.documentVersion && record.documentVersion !== state.node.documentVersion)
      state.plan.reason = `这条路径保存于旧正文版本，请核对后再保存。${state.plan.reason}`;
    state.planDirty = false;
    renderPlan();
  }
  function setPlanPaused(paused) {
    if (
      !state.ready ||
      !state.plan ||
      state.stale ||
      state.uid !== (app.userState?.uid || '') ||
      state.token !== (app.userState?.token || '')
    )
      return false;
    state.planPaused = Boolean(paused);
    renderPlan();
    return true;
  }
  function changePlan(action) {
    action();
    state.planDirty = true;
    state.planKey = null;
    el('plan-status').textContent = '尚未保存';
    const current = state.plan.presentation;
    state.plan.presentation = window.FreeBbsLearningNextSteps.presentation(state.plan, {
      primary:
        current?.primary && !state.plan.steps.some((entry) => entry.id === current.primary.id)
          ? current.primary
          : null,
      alternatives:
        current?.alternatives?.filter(
          (entry) => !state.plan.steps.some((step) => step.id === entry.id),
        ) || [],
    });
    renderPlan();
  }
  function runStep(step, pathType = 'recommended') {
    if (state.planPaused) setPlanPaused(false);
    const preference = window.FreeBbsLearningStart?.currentPreference?.();
    if (
      !state.stale &&
      state.uid === (app.userState?.uid || '') &&
      state.token === (app.userState?.token || '')
    )
      window.FreeBbsLearningAnalytics?.recordLearningChoice?.({
        action: 'recommendation_choose',
        courseSlug: state.course.slug,
        nodeId: state.node.id,
        level: preference?.level || null,
        goal: step.goal || state.planGoal || preference?.goal || null,
        pathType,
        ...(/^[a-f0-9]{64}$/.test(state.node.documentVersion || '')
          ? { documentVersion: state.node.documentVersion }
          : {}),
      });
    if (step.goal && ['concepts', 'practice', 'explore'].includes(step.goal)) {
      state.planGoal = step.goal;
      if (!state.planDirty) {
        refreshPlan();
        const next = state.plan?.presentation?.primary;
        if (next) navigateStep(next);
      } else navigateStep(step);
      return;
    }
    navigateStep(step);
  }
  function navigateStep(step) {
    if (step.point && step.point !== state.node.id) {
      const target = new URLSearchParams({
        course: state.course.slug,
        point: step.point,
        view: 'reading',
        tool: step.tool === 'discussion' ? 'content' : step.tool,
        ...(step.tool === 'discussion'
          ? { interaction: step.taskId === 'ask-max' ? 'max' : 'discussion' }
          : {}),
        ...(step.view ? { focus: step.view } : {}),
        ...(step.questionId ? { question: step.questionId } : {}),
        ...(step.quizView ? { quiz: step.quizView } : {}),
        ...(step.taskId === 'annotate-origin' ? { annotation: 'origin' } : {}),
      });
      window.location.assign(`/knowledge?${target}`);
    } else if (step.taskId === 'ask-max') openInteraction('max');
    else if (
      step.tool === 'notes' &&
      !window.FreeBbsLearningNextSteps?.hasReadableContent?.(state.node)
    ) {
      if (window.FreeBbsLearningContent?.originMarkdown?.(state.node.sections)) {
        requestTool('content');
        page.dispatchEvent(
          new CustomEvent('knowledge:navigate', { detail: { tool: 'content', view: 'origin' } }),
        );
        window.FreeBbsKnowledgeAnnotations?.setEditing?.(true);
      } else openInteraction('max');
    } else if (step.tool === 'discussion') openInteraction('discussion');
    else {
      requestTool(step.tool);
      page.dispatchEvent(
        new CustomEvent('knowledge:navigate', {
          detail: {
            tool: step.tool,
            view: step.view || 'reading',
            quizView: step.quizView,
            questionId: step.questionId,
            taskId: step.taskId,
          },
        }),
      );
      if (step.taskId === 'annotate-origin') window.FreeBbsKnowledgeAnnotations?.setEditing?.(true);
    }
  }
  function renderPlan() {
    if (!state.plan) return;
    el('plan-title').textContent = state.plan.label;
    el('plan-reason').textContent = state.planPaused
      ? '已暂停，想继续时再回来。'
      : state.plan.reason;
    el('plan-tip').textContent = state.plan.tip;
    const list = el('plan-steps');
    let summary = el('plan-summary');
    let editor = el('plan-editor');
    if (!summary) {
      summary = text('section', '', 'learning-plan-summary');
      summary.id = 'learning-plan-summary';
      list.before(summary);
    }
    if (!editor) {
      editor = text('details', '', 'learning-plan-editor');
      editor.id = 'learning-plan-editor';
      const heading = text('summary', '完整路径与调整');
      heading.id = 'learning-plan-editor-heading';
      const chain = text('p', '', 'learning-plan-chain');
      chain.id = 'learning-plan-chain';
      list.before(editor);
      editor.append(heading, chain, list);
    }
    const current =
      state.plan.presentation || window.FreeBbsLearningNextSteps.presentation(state.plan);
    summary.replaceChildren();
    if (current.primary) {
      const step = current.primary;
      const main = text('article', '', 'learning-plan-primary');
      main.append(
        text('small', state.planPaused ? '暂存的下一步' : '下一步'),
        text('h3', step.title),
        text('p', step.description),
        text('small', `约 ${step.minutes} 分钟`),
      );
      const start = text('button', '开始', 'learning-primary');
      start.type = 'button';
      start.addEventListener('click', () => runStep(step));
      main.append(start);
      if (state.plan.steps.some((entry) => entry.id === step.id)) {
        const done = text('button', '完成这一步');
        done.type = 'button';
        done.addEventListener('click', () =>
          changePlan(() => {
            state.plan.steps = window.FreeBbsLearningNextSteps.toggleStep(
              state.plan.steps,
              step.id,
            );
          }),
        );
        main.append(done);
      }
      summary.append(main);
    } else summary.append(text('p', '这条路径已处理完，可回看或换个方向。'));
    if (current.alternatives.length) {
      const alternatives = text('div', '', 'learning-plan-alternatives');
      alternatives.append(text('span', '也可以'));
      current.alternatives.slice(0, 2).forEach((step) => {
        const button = text('button', step.title);
        button.type = 'button';
        button.addEventListener('click', () => runStep(step, 'alternative'));
        alternatives.append(button);
      });
      summary.append(alternatives);
    }
    const direct = text('details', '', 'learning-task-shortcuts');
    direct.append(text('summary', '换个任务'));
    const shortcuts = text('div', '', 'learning-task-options');
    window.FreeBbsLearningNextSteps.taskEntries({
      node: state.node,
      questions: state.questions,
      practiceQuestions: state.practiceQuestions,
      hasOrigin: Boolean(window.FreeBbsLearningContent?.originMarkdown?.(state.node.sections)),
    }).forEach((step) => {
      const button = text('button', step.title);
      button.type = 'button';
      button.addEventListener('click', () => navigateStep(step));
      shortcuts.append(button);
    });
    direct.append(shortcuts);
    summary.append(direct);
    el('plan-editor-heading').textContent = `完整路径（${state.plan.steps.length} 步，可调整）`;
    el('plan-chain').textContent = state.plan.steps
      .map((step) => `${step.completed ? '✓ ' : step.skipped ? '已跳过 ' : ''}${step.title}`)
      .join(' → ');
    list.replaceChildren();
    state.plan.steps.forEach((step, index) => {
      const item = text('li', '', 'learning-plan-step');
      item.classList.toggle('is-complete', step.completed);
      item.classList.toggle('is-skipped', step.skipped);
      item.draggable = true;
      item.dataset.stepId = step.id;
      const number = text('span', String(index + 1).padStart(2, '0'), 'learning-plan-number');
      const copy = text('div', '', 'learning-plan-copy');
      copy.append(
        text('strong', step.title),
        text('p', step.description || ''),
        text('small', `约 ${step.minutes} 分钟`),
      );
      const actions = text('div', '', 'learning-plan-step-actions');
      const button = (label, handler, disabled = false) => {
        const control = text('button', label);
        control.type = 'button';
        control.disabled = disabled;
        control.addEventListener('click', handler);
        actions.append(control);
        return control;
      };
      button(step.completed ? '再看看' : '开始', () => runStep(step, 'custom'));
      button(step.completed ? '撤销完成' : '完成', () =>
        changePlan(() => {
          state.plan.steps = window.FreeBbsLearningNextSteps.toggleStep(
            state.plan.steps,
            step.id,
            'completed',
          );
        }),
      );
      const up = button(
        '↑',
        () =>
          changePlan(() => {
            state.plan.steps = window.FreeBbsLearningNextSteps.reorderStep(
              state.plan.steps,
              step.id,
              -1,
            );
          }),
        index === 0,
      );
      up.setAttribute('aria-label', `上移 ${step.title}`);
      const down = button(
        '↓',
        () =>
          changePlan(() => {
            state.plan.steps = window.FreeBbsLearningNextSteps.reorderStep(
              state.plan.steps,
              step.id,
              1,
            );
          }),
        index === state.plan.steps.length - 1,
      );
      down.setAttribute('aria-label', `下移 ${step.title}`);
      button(step.skipped ? '恢复' : '跳过', () =>
        changePlan(() => {
          state.plan.steps = window.FreeBbsLearningNextSteps.toggleStep(
            state.plan.steps,
            step.id,
            'skipped',
          );
        }),
      );
      button('移除', () =>
        changePlan(() => {
          state.plan.steps.splice(index, 1);
        }),
      );
      item.append(number, copy, actions);
      item.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData('text/plain', step.id);
      });
      item.addEventListener('dragover', (event) => event.preventDefault());
      item.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = state.plan.steps.findIndex(
          (candidate) => candidate.id === event.dataTransfer.getData('text/plain'),
        );
        if (from < 0 || from === index) return;
        changePlan(() => {
          const [moved] = state.plan.steps.splice(from, 1);
          state.plan.steps.splice(index, 0, moved);
        });
      });
      list.append(item);
    });
    el('plan-total').textContent = state.planPaused
      ? '暂停中'
      : `剩余约 ${state.plan.steps.filter((step) => !step.completed && !step.skipped).reduce((sum, step) => sum + step.minutes, 0)} 分钟`;
    let pause = el('plan-pause');
    if (!pause && el('plan-reset')) {
      pause = text('button', '先停一下');
      pause.id = 'learning-plan-pause';
      pause.type = 'button';
      pause.addEventListener('click', () => setPlanPaused(!state.planPaused));
      el('plan-reset').after(pause);
    }
    if (pause) {
      pause.textContent = state.planPaused ? '继续这条路径' : '先停一下';
      pause.setAttribute('aria-pressed', String(Boolean(state.planPaused)));
    }
    let prompts = el('plan-prompts');
    if (!prompts) {
      prompts = text('details', '', 'learning-plan-prompts');
      prompts.id = 'learning-plan-prompts';
      list.after(prompts);
    }
    prompts.replaceChildren();
    const questions = Array.isArray(state.plan.questions)
      ? state.plan.questions
          .filter((question) => typeof question === 'string' && question.trim())
          .slice(0, 3)
      : [];
    show(prompts, questions.length > 0);
    if (questions.length) {
      prompts.append(text('summary', '可选思考问题'));
      questions.forEach((question) => {
        const item = text('div', '', 'learning-plan-question');
        item.append(text('p', question));
        const button = text('button', '请 Max 帮我想想');
        button.type = 'button';
        button.addEventListener('click', () => openInteraction('max', question));
        item.append(button);
        prompts.append(item);
      });
    }
    el('plan-save').disabled = state.busy || !state.plan.steps.length;
  }
  async function savePlan() {
    if (!loggedIn()) {
      el('plan-status').textContent = '请先登录。';
      return;
    }
    if (state.busy || !state.plan?.steps.length) return;
    const generation = state.generation;
    state.planKey ||= window.crypto.randomUUID();
    const record = state.planRecord;
    const submittedSnapshot = JSON.stringify([
      state.plan.label,
      state.plan.reason,
      state.plan.steps,
    ]);
    const data = {
      kind: 'path',
      title: state.plan.label,
      content: state.plan.reason || '我的学习路径',
      path: state.plan.steps.map(
        ({
          id,
          title,
          description,
          tool,
          minutes,
          completed,
          skipped,
          point,
          view,
          quizView,
          questionId,
          taskId,
        }) => ({
          id,
          title,
          description,
          tool,
          minutes,
          completed: Boolean(completed),
          skipped: Boolean(skipped),
          ...(point ? { point } : {}),
          ...(view ? { view } : {}),
          ...(quizView ? { quizView } : {}),
          ...(questionId ? { questionId } : {}),
          ...(taskId ? { taskId } : {}),
        }),
      ),
      requestKey: state.planKey,
      ...(record ? { revision: record.revision } : {}),
    };
    state.busy = true;
    renderPlan();
    el('plan-status').textContent = '正在保存…';
    try {
      const payload = await app.callApi(`${endpoint()}/entries${record ? `/${record.id}` : ''}`, {
        method: record ? 'PUT' : 'POST',
        body: JSON.stringify(data),
      });
      if (generation !== state.generation) return;
      const unchanged =
        state.planKey === data.requestKey &&
        submittedSnapshot ===
          JSON.stringify([state.plan.label, state.plan.reason, state.plan.steps]);
      // The acknowledgement confirms A, not any path edits made while A saved.
      // Keep B dirty, but retain this own confirmed base for its next explicit PUT.
      if (
        record &&
        String(state.planRecord?.id) === String(record.id) &&
        state.planRecord.revision === record.revision
      )
        state.planRecord = { ...state.planRecord, revision: record.revision + 1 };
      else if (!record && !state.planRecord && payload?.entry?.kind === 'path')
        state.planRecord = payload.entry;
      state.planDirty = !unchanged;
      if (unchanged) state.planKey = null;
      el('plan-status').textContent = unchanged ? '已保存' : '之前的路径已保存，当前调整还未保存。';
      await loadEntries();
      if (generation === state.generation)
        page.dispatchEvent(
          new CustomEvent('knowledge:path-saved', { detail: { stepCount: data.path.length } }),
        );
    } catch (error) {
      if (generation === state.generation)
        el('plan-status').textContent = `保存失败：${error.message}`;
    } finally {
      if (generation === state.generation) {
        state.busy = false;
        renderPlan();
      }
    }
  }
  function syncContributionForm() {
    const form = el('contribution-form');
    const category = form.elements.category.value;
    show(el('contribution-excerpt-field'), category === 'correction');
    show(el('contribution-scope-field'), category === 'improvement');
    show(el('resource-fields'), category === 'resource');
    el('resource-fields')
      .querySelectorAll('input, select')
      .forEach((input) => {
        input.disabled = category !== 'resource';
        input.required = category === 'resource' && input.name !== 'coverage';
      });
    const courseResource =
      category === 'resource' && form.elements.resourceLevel.value === 'course';
    show(el('resource-coverage-field'), courseResource);
    form.elements.coverage.required = courseResource;
  }
  async function saveAnnotation(detail) {
    if (!loggedIn() || state.busy) {
      const message = !loggedIn() ? '请先登录。' : '上一项操作尚未完成，请稍后重试。';
      el('annotation-status').textContent = message;
      page.dispatchEvent(
        new CustomEvent('knowledge:annotation-error', {
          detail: { requestKey: detail?.requestKey, message },
        }),
      );
      return;
    }
    const generation = state.generation;
    const entry = detail.entry;
    const acknowledgment = {
      requestKey: detail.requestKey,
      signature: detail.signature,
      scope: detail.scope,
      ...(entry
        ? { entryId: entry.id, previousRevision: entry.revision, revision: entry.revision + 1 }
        : {}),
    };
    state.busy = true;
    el('annotation-status').textContent = '正在保存…';
    try {
      const payload = await app.callApi(
        `${endpoint()}/entries${entry ? `/${encodeURIComponent(entry.id)}` : ''}`,
        {
          method: entry ? 'PUT' : 'POST',
          body: JSON.stringify({
            kind: 'note',
            title: detail.title || '原文评注',
            content: detail.content || detail.annotation.anchor.quote,
            annotation: detail.annotation,
            requestKey: detail.requestKey || window.crypto.randomUUID(),
            ...(entry ? { revision: entry.revision } : {}),
          }),
        },
      );
      if (generation !== state.generation) return;
      acknowledgment.before = entry || null;
      acknowledgment.after = entry
        ? {
            ...entry,
            title: detail.title || '原文评注',
            content: detail.content || detail.annotation.anchor.quote,
            annotation: detail.annotation,
            revision: entry.revision + 1,
          }
        : payload?.entry;
      if (acknowledgment.after) {
        acknowledgment.entryId = acknowledgment.after.id;
        acknowledgment.revision = acknowledgment.after.revision;
      }
      el('annotation-status').textContent = '已保存';
      await loadEntries();
      if (generation === state.generation)
        page.dispatchEvent(
          new CustomEvent('knowledge:annotation-saved', { detail: acknowledgment }),
        );
    } catch (error) {
      if (generation === state.generation)
        el('annotation-status').textContent = `保存失败：${error.message}`;
      if (generation === state.generation)
        page.dispatchEvent(
          new CustomEvent('knowledge:annotation-error', {
            detail: {
              requestKey: detail.requestKey,
              status: error.status,
              message: `保存失败：${error.message}`,
            },
          }),
        );
    } finally {
      if (generation === state.generation) state.busy = false;
    }
  }
  function resetSession(stale = false) {
    state.generation += 1;
    state.uid = app.userState?.uid || '';
    state.token = app.userState?.token || '';
    state.stale = stale;
    state.entries = [];
    state.cursor = null;
    state.loaded = false;
    state.busy = false;
    state.plan = null;
    state.planRecord = null;
    state.latestPath = null;
    state.annotationEntries = [];
    state.annotationCursor = null;
    state.planDirty = false;
    state.planPaused = false;
    state.planKey = null;
    state.attempts = [];
    state.currentAttempts = undefined;
    state.questions = [];
    state.practiceQuestions = [];
    state.resources = [];
    state.planGoal = '';
    state.contributionAnchor = null;
    state.positions = {};
    state.previousTool = null;
    state.reviewEpoch += 1;
    state.reviewEntries = [];
    state.reviewCursor = null;
    state.reviewLoaded = false;
    state.reviewLoading = false;
    state.reviewVisible = false;
    state.reviewMessage = '';
    state.reviewDrafts = new Map();
    state.reviewErrors = new Map();
    state.reviewSaving = new Set();
    state.reviewHandled = new Set();
    el('review-refresh').disabled = false;
    page
      .querySelectorAll('#learning-workspace form, [data-learning-panel="notes"] form')
      .forEach((form) => {
        form.reset();
        delete form.dataset.requestKey;
        status(form, '');
      });
    page
      .querySelectorAll(
        '#learning-workspace button, #learning-workspace input, #learning-workspace textarea, #learning-workspace select, [data-learning-panel="notes"] button, [data-learning-panel="notes"] input, [data-learning-panel="notes"] textarea',
      )
      .forEach((button) => {
        button.disabled = false;
      });
    resetNote();
    el('plan-steps').replaceChildren();
    el('plan-title').textContent = '下一步';
    ['plan-reason', 'plan-tip', 'plan-total'].forEach((id) => {
      el(id).textContent = '';
    });
    el('plan-summary')?.replaceChildren();
    if (el('plan-chain')) el('plan-chain').textContent = '';
    if (el('plan-editor-heading')) el('plan-editor-heading').textContent = '完整路径';
    if (el('plan-editor')) el('plan-editor').open = false;
    el('plan-prompts')?.remove();
    el('plan-pause')?.remove();
    el('plan-status').textContent = '';
    el('annotation-status').textContent = '';
    el('note-composer').open = false;
    syncContributionForm();
    el('review-records').replaceChildren();
    show(el('review-section'), false);
    renderEntries();
    sessionMessage(stale ? '账号已在其他页面变更，请刷新后继续。' : '');
    if (state.ready && !stale) {
      loadEntries();
      loadReview();
    }
  }
  document.querySelectorAll('[data-knowledge-tool]').forEach((button) => {
    const value = labels[button.dataset.knowledgeTool];
    button.dataset.shortLabel = value[1];
    button.title = value[0];
    button.setAttribute('aria-label', value[0]);
  });
  page.addEventListener('knowledge:tool-select', (event) =>
    switchTool(event.detail?.tool, {
      focus: true,
      preserveView: Boolean(event.detail?.preserveView),
    }),
  );
  page.addEventListener('knowledge:view-change', (event) => {
    if (event.detail?.activateContent && state.tool !== 'content')
      switchTool('content', { preserveView: true, restore: false });
    else if (state.tool !== 'content' && state.tool !== 'notes') {
      show(document.getElementById('knowledge-overview'), false);
      show(document.getElementById('knowledge-reading'), false);
    }
    if (state.tool === 'content' || state.tool === 'notes') {
      show(document.getElementById('knowledge-overview'), event.detail?.view === 'overview');
      show(document.getElementById('knowledge-reading'), event.detail?.view !== 'overview');
    }
  });
  page.addEventListener('knowledge:answer', (event) => {
    const { answer, element } = event.detail;
    const button = text('button', '保存到个人笔记', 'learning-save-answer');
    button.type = 'button';
    button.addEventListener('click', () => draftAnswer(answer));
    element?.after(button);
  });
  page.addEventListener('knowledge:loaded', (event) => {
    state.course = event.detail.course;
    state.node = event.detail.node;
    state.ready = true;
    resetSession();
    let tool = 'content';
    try {
      const pref = JSON.parse(localStorage.getItem(prefKey()) || '{}');
      if (labels[pref.tool] && pref.tool !== 'notes') tool = pref.tool;
      if (pref.positions && typeof pref.positions === 'object') state.positions = pref.positions;
    } catch {
      /* Defaults remain usable. */
    }
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('tool');
    if (params.has('view')) tool = 'content';
    state.restoring = true;
    page.dispatchEvent(
      new CustomEvent('knowledge:tool-select', {
        detail: { tool: labels[requested] ? requested : tool, preserveView: true },
      }),
    );
    state.restoring = false;
    if (params.get('interaction') === 'discussion') openInteraction('discussion');
    else if (params.get('interaction') === 'max') openInteraction('max');
    if (params.get('annotation') === 'origin' && params.get('focus') === 'origin') {
      const { generation } = state;
      window.requestAnimationFrame(() => {
        if (generation === state.generation && !state.stale)
          window.FreeBbsKnowledgeAnnotations?.setEditing?.(true);
      });
    }
  });
  page.addEventListener('knowledge:document-saved', (event) => {
    if (event.detail?.node) {
      const oldNode = state.node;
      state.node = event.detail.node;
      if (
        oldNode?.documentVersion !== state.node.documentVersion ||
        oldNode?.id !== state.node.id
      ) {
        resetReviewQueue(oldNode?.id === state.node.id);
        if (state.ready && loggedIn()) loadReview();
      }
    }
    refreshPlan();
  });
  page.addEventListener('knowledge:assessment-updated', (event) => {
    if (!state.ready || !state.node) return;
    state.attempts = event.detail?.attempts || [];
    state.currentAttempts = Array.isArray(event.detail?.currentAttempts)
      ? event.detail.currentAttempts
      : undefined;
    state.questions = event.detail?.questions || [];
    state.practiceQuestions = event.detail?.practiceQuestions || [];
    if (!state.node.documentVersion && event.detail?.documentVersion)
      state.node.documentVersion = event.detail.documentVersion;
    refreshPlan();
  });
  page.addEventListener('knowledge:tags-change', () => refreshPlan());
  page.addEventListener('knowledge:resources-updated', (event) => {
    const detail = event.detail || {};
    if (
      !state.ready ||
      detail.courseSlug !== state.course?.slug ||
      detail.nodeId !== state.node?.id
    )
      return;
    state.resources =
      detail.status === 'ready' && Array.isArray(detail.resources) ? detail.resources : [];
    refreshPlan();
  });
  window.addEventListener('learning:start-change', () => {
    if (
      state.stale ||
      state.uid !== (app.userState?.uid || '') ||
      state.token !== (app.userState?.token || '')
    )
      return;
    state.planGoal = '';
    refreshPlan();
  });
  page.addEventListener('knowledge:annotation-save', (event) => saveAnnotation(event.detail));
  page.addEventListener('knowledge:annotations-more', () => loadAnnotationRecords(true));
  page.addEventListener('knowledge:annotation-ask', (event) => {
    const detail = event.detail || {};
    const anchor = detail.annotation?.anchor;
    openInteraction(
      'max',
      detail.prompt || '',
      anchor?.quote
        ? {
            quote: anchor.quote,
            source:
              anchor.section === 'origin' || detail.source === 'origin' ? 'origin' : 'annotation',
            nodeId: anchor.nodeId,
            documentVersion: anchor.documentVersion,
          }
        : null,
    );
  });
  page.addEventListener('knowledge:annotation-correction', (event) => {
    const form = el('contribution-form');
    if (
      form.elements.content.value.trim() &&
      !window.confirm('保留现有建议，还是改为提交这段原文？点击确定替换。')
    )
      return;
    form.reset();
    delete form.dataset.requestKey;
    form.elements.category.value = 'correction';
    form.elements.excerpt.value = event.detail?.excerpt || '';
    form.elements.content.value = event.detail?.content || '';
    state.contributionAnchor = event.detail?.annotation?.anchor || event.detail?.annotation || null;
    syncContributionForm();
    requestTool('contribute');
    form.elements.title.focus();
  });
  page.addEventListener('knowledge:annotation-remove', async (event) => {
    const entry = event.detail?.entry;
    if (!loggedIn() || !entry || state.busy) {
      page.dispatchEvent(
        new CustomEvent('knowledge:annotation-error', {
          detail: {
            requestKey: event.detail?.requestKey,
            message: !loggedIn() ? '请先登录。' : '当前无法删除，请稍后重试。',
          },
        }),
      );
      return;
    }
    const generation = state.generation;
    state.busy = true;
    try {
      await app.callApi(`${endpoint()}/entries/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ revision: entry.revision }),
      });
      if (generation === state.generation) {
        page.dispatchEvent(
          new CustomEvent('knowledge:annotation-removed', {
            detail: {
              entryId: entry.id,
              before: entry,
              requestKey: event.detail?.requestKey,
              scope: event.detail?.scope,
            },
          }),
        );
        await loadEntries();
      }
    } catch (error) {
      if (generation === state.generation) el('annotation-status').textContent = error.message;
      if (generation === state.generation)
        page.dispatchEvent(
          new CustomEvent('knowledge:annotation-error', {
            detail: {
              requestKey: event.detail?.requestKey,
              status: error.status,
              message: error.message,
            },
          }),
        );
    } finally {
      if (generation === state.generation) state.busy = false;
    }
  });
  page.addEventListener('knowledge:annotation-undo', async (event) => {
    const operation = event.detail?.operation;
    if (!loggedIn() || !operation || state.busy) {
      page.dispatchEvent(
        new CustomEvent('knowledge:annotation-error', {
          detail: {
            requestKey: operation?.requestKey,
            undo: true,
            message: !loggedIn() ? '请先登录。' : '当前无法撤销，请稍后重试。',
          },
        }),
      );
      return;
    }
    const generation = state.generation;
    const { before, after, requestKey } = operation;
    const scope = JSON.stringify([
      state.uid,
      state.token,
      state.course?.slug,
      state.node?.id,
      state.node?.documentVersion,
      ...(state.node?.originDocumentVersion ? [state.node.originDocumentVersion] : []),
    ]);
    if (operation.scope !== scope) {
      page.dispatchEvent(
        new CustomEvent('knowledge:annotation-error', {
          detail: {
            requestKey,
            undo: true,
            message: '当前账号或正文已变化，无法撤销之前的操作。',
          },
        }),
      );
      return;
    }
    if (
      (!before && !after) ||
      ![before, after]
        .filter(Boolean)
        .every(
          (entry) =>
            entry.kind === 'note' &&
            entry.status === 'private' &&
            entry.annotation?.anchor?.nodeId === state.node.id,
        )
    ) {
      page.dispatchEvent(
        new CustomEvent('knowledge:annotation-error', {
          detail: { requestKey, undo: true, message: '这条记录不支持撤销。' },
        }),
      );
      return;
    }
    state.busy = true;
    try {
      let restored = null;
      if (!before && after) {
        await app.callApi(`${endpoint()}/entries/${encodeURIComponent(after.id)}`, {
          method: 'DELETE',
          body: JSON.stringify({ revision: after.revision }),
        });
      } else if (before) {
        const payload = await app.callApi(
          `${endpoint()}/entries${after ? `/${encodeURIComponent(after.id)}` : ''}`,
          {
            method: after ? 'PUT' : 'POST',
            body: JSON.stringify({
              kind: 'note',
              title: before.title,
              content: before.content,
              annotation: before.annotation,
              requestKey: operation.undoRequestKey,
              ...(after ? { revision: after.revision } : {}),
            }),
          },
        );
        restored = after
          ? { ...before, id: after.id, revision: after.revision + 1 }
          : payload?.entry;
      }
      if (generation !== state.generation) return;
      page.dispatchEvent(
        new CustomEvent('knowledge:annotation-undo-completed', {
          detail: {
            requestKey,
            after: restored,
          },
        }),
      );
      await loadEntries();
    } catch (error) {
      if (generation === state.generation)
        page.dispatchEvent(
          new CustomEvent('knowledge:annotation-error', {
            detail: {
              requestKey,
              undo: true,
              status: error.status,
              message: `撤销失败：${error.message}`,
            },
          }),
        );
    } finally {
      if (generation === state.generation) state.busy = false;
    }
  });
  page.querySelectorAll('[data-learning-go]').forEach((button) =>
    button.addEventListener('click', () => {
      if (
        button.dataset.learningGo === 'notes' &&
        !document.getElementById('learning-annotation-toolbar')?.hidden
      )
        window.FreeBbsKnowledgeAnnotations?.setEditing?.(false);
      else requestTool(button.dataset.learningGo);
    }),
  );
  root
    .querySelectorAll('[data-learning-prompt]')
    .forEach((button) =>
      button.addEventListener('click', () =>
        page.dispatchEvent(
          new CustomEvent('knowledge:ask', { detail: { prompt: button.dataset.learningPrompt } }),
        ),
      ),
    );
  page
    .querySelectorAll('[data-learning-refresh]')
    .forEach((button) => button.addEventListener('click', () => loadEntries()));
  [
    ['reflection', 'reflection'],
    ['note', 'note'],
    ['contribution', 'contribution'],
  ].forEach(([name, kind]) => {
    const form = el(`${name}-form`);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      saveForm(form, kind);
    });
    form.addEventListener('input', () => {
      delete form.dataset.requestKey;
    });
  });
  el('note-cancel').addEventListener('click', resetNote);
  el('load-more').addEventListener('click', () => loadEntries(true));
  el('review-refresh').addEventListener('click', () => loadReview());
  el('plan-save').addEventListener('click', savePlan);
  el('plan-reset').addEventListener('click', () => {
    if (state.planDirty && !window.confirm('舍弃未保存的路径调整？')) return;
    refreshPlan(true);
    state.planDirty = true;
    el('plan-status').textContent = '尚未保存';
  });
  el('open-max').addEventListener('click', () => openInteraction());
  el('contribution-form').elements.category.addEventListener('change', () => {
    state.contributionAnchor = null;
    syncContributionForm();
  });
  el('contribution-form').elements.resourceLevel.addEventListener('change', syncContributionForm);
  el('resource-submit')?.addEventListener('click', () => {
    const form = el('contribution-form');
    if (
      form.elements.content.value.trim() &&
      form.elements.category.value !== 'resource' &&
      !window.confirm('当前建议尚未提交，改为资料投稿吗？原输入会保留。')
    )
      return;
    form.elements.category.value = 'resource';
    syncContributionForm();
    requestTool('contribute');
    form.elements.title.focus({ preventScroll: true });
  });
  el('annotation-toggle').addEventListener('click', () => {
    const button = el('annotation-toggle');
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = enabled ? '评注已开启' : '开启评注';
    page.dispatchEvent(new CustomEvent('knowledge:annotation-toggle', { detail: { enabled } }));
  });
  window.addEventListener('freebbs:session-change', () => {
    if (state.uid !== (app.userState?.uid || '') || state.token !== (app.userState?.token || ''))
      resetSession();
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) resetSession(true);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });
  window.addEventListener('beforeunload', (event) => {
    state.positions[state.tool] = scrollPosition();
    keepPreference();
    if (
      state.busy ||
      state.planDirty ||
      state.reviewSaving.size ||
      [...state.reviewDrafts.values()].some((reply) => String(reply).trim()) ||
      el('annotation-comment')?.value.trim() ||
      el('note-form')?.elements?.content?.value?.trim() ||
      [
        ...page.querySelectorAll(
          '#learning-workspace form textarea, [data-learning-panel="notes"] form textarea',
        ),
      ].some((input) => input.value.trim())
    )
      event.preventDefault();
  });
})();
