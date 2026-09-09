(() => {
  const app = window.freeBbsApp;
  const form = document.getElementById('discussion-compose-form');
  const notice = document.getElementById('circuit-discussion-handoff');
  if (!app || !form || !notice) return;

  const title = document.getElementById('discussion-compose-title');
  const content = document.getElementById('discussion-compose-content');
  const board = document.getElementById('discussion-compose-board');
  const message = document.getElementById('circuit-discussion-status');
  const append = document.getElementById('circuit-discussion-append');
  const login = document.getElementById('circuit-discussion-login');
  const pointerKey = 'free_bbs_circuit_discussion_intent_v1';
  const defaultTitle = '看看我的神秘电路！';
  const state = {
    intent: null,
    initialized: false,
    applied: false,
    verified: false,
    cancelled: false,
    uid: '',
    generation: 0,
    edits: 0,
    boards: [],
  };

  function validIntent(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!/^c_[a-f0-9]{24}$/.test(value.cid || '')) return null;
    if (!/^[1-9]\d*$/.test(String(value.revision || ''))) return null;
    const revision = Number(value.revision);
    if (!Number.isSafeInteger(revision)) return null;
    return { cid: value.cid, revision };
  }

  function currentUid() {
    return app.userState.isLoggedIn ? app.userState.uid : '';
  }

  function key(intent = state.intent) {
    return `free_bbs_circuit_discussion_draft_v1:${intent.cid}:${intent.revision}`;
  }

  function removeStorage(storageKey) {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage may be unavailable. */
    }
  }

  function readStored(storageKey) {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    } catch {
      return null;
    }
  }

  function readDraft(intent = state.intent) {
    const saved = readStored(key(intent));
    if (!saved) return null;
    if (saved.uid && saved.uid !== currentUid()) {
      removeStorage(key(intent));
      return null;
    }
    return typeof saved.title === 'string' &&
      typeof saved.content === 'string' &&
      saved.title.length <= 120 &&
      saved.content.length <= 20000
      ? saved
      : null;
  }

  function writePointer() {
    if (!state.intent || state.cancelled) return;
    try {
      sessionStorage.setItem(pointerKey, JSON.stringify({ ...state.intent, uid: currentUid() }));
    } catch {
      /* The URL still contains the handoff intent. */
    }
  }

  function persist() {
    if (!state.applied || !state.intent || state.cancelled) return true;
    try {
      sessionStorage.setItem(
        key(),
        JSON.stringify({
          uid: currentUid(),
          title: title.value.slice(0, 120),
          content: content.value.slice(0, 20000),
          board: board.value,
        }),
      );
      writePointer();
      return true;
    } catch {
      return false;
    }
  }

  function showMessage(text, { error = false, offerAppend = false } = {}) {
    notice.classList.remove('hidden');
    notice.hidden = false;
    message.textContent = text;
    message.classList.toggle('is-error', error);
    append.hidden = !offerAppend;
    login.hidden = !state.verified || app.userState.isLoggedIn;
  }

  function showComposer() {
    form.classList.remove('hidden');
    form.hidden = false;
    form.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  function markdown() {
    const query = new URLSearchParams({
      cid: state.intent.cid,
      revision: String(state.intent.revision),
      view: 'live',
    });
    return `[电路动态图](/circuit?${query.toString()})`;
  }

  function draftStatus(restored = false) {
    const action = restored ? '已恢复未发布的电路草稿' : '已准备电路发帖草稿';
    showMessage(
      app.userState.isLoggedIn
        ? `${action}。版块、标题和正文都可以修改，确认后点击“发布”。`
        : `${action}。可继续编辑；登录后返回此页，再确认发布。`,
    );
  }

  function markApplied() {
    state.applied = true;
    form.dataset.circuitHandoff = `${state.intent.cid}:${state.intent.revision}`;
    persist();
    showComposer();
  }

  function applyDraft(saved = null) {
    if (state.cancelled || !state.verified) return;
    title.value = saved ? saved.title : defaultTitle;
    content.value = saved ? saved.content : markdown();
    const selectedBoard = saved?.board || 'circuit';
    board.value = state.boards.some((entry) => entry.slug === selectedBoard)
      ? selectedBoard
      : 'circuit';
    markApplied();
    const boardChip = document.querySelector(`[data-board-slug="${board.value}"]`);
    if (boardChip?.getAttribute('aria-pressed') !== 'true') boardChip?.click();
    draftStatus(Boolean(saved));
  }

  function clearIntentUrl() {
    const url = new URL(window.location.href);
    ['compose', 'cid', 'revision'].forEach((name) => url.searchParams.delete(name));
    window.history.replaceState({}, '', url);
  }

  function finish({ clearFields = false } = {}) {
    state.generation += 1;
    state.cancelled = true;
    if (state.intent) removeStorage(key());
    removeStorage(pointerKey);
    if (clearFields && state.applied) {
      title.value = '';
      content.value = '';
      form.classList.add('hidden');
    }
    delete form.dataset.circuitHandoff;
    state.applied = false;
    notice.classList.add('hidden');
    clearIntentUrl();
  }

  function resolveIntent() {
    const query = new URLSearchParams(window.location.search);
    if (query.has('compose')) {
      if (query.get('compose') !== 'circuit') return null;
      if (['compose', 'cid', 'revision', 'board'].some((name) => query.getAll(name).length !== 1)) {
        throw new Error('电路发帖链接无效，请返回电路页面重新打开。');
      }
      const intent = validIntent({ cid: query.get('cid'), revision: query.get('revision') });
      if (!intent) throw new Error('电路 CID 或版本号无效，未生成引用。');
      // The discussion router updates board after a user changes their destination.
      // Only an existing draft from this tab may resume through that changed URL.
      if (query.get('board') !== 'circuit' && !readDraft(intent)) {
        throw new Error('电路发帖链接无效，请返回电路页面重新打开。');
      }
      return intent;
    }
    if (query.has('post') || (query.has('board') && query.get('board') !== 'circuit')) return null;
    const pointer = readStored(pointerKey);
    const intent = validIntent(pointer);
    if (!intent) return null;
    if (pointer.uid && pointer.uid !== currentUid()) {
      removeStorage(pointerKey);
      return null;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('board', 'circuit');
    url.searchParams.set('compose', 'circuit');
    url.searchParams.set('cid', intent.cid);
    url.searchParams.set('revision', String(intent.revision));
    window.history.replaceState({}, '', url);
    return intent;
  }

  async function verifyAndPrepare(ready) {
    if (!state.intent || state.cancelled || state.applied) return;
    state.generation += 1;
    const { generation, edits } = state;
    const initialBoard = new URLSearchParams(window.location.search).get('board');
    showMessage('正在验证电路版本…');
    try {
      if (
        ready?.isFallback ||
        !Array.isArray(ready?.boards) ||
        !ready.boards.some((entry) => entry.slug === 'circuit')
      ) {
        throw new Error('电路讨论版块暂不可用，未生成草稿。请刷新后重试。');
      }
      state.boards = ready.boards.filter(
        (entry) => entry.slug !== 'changelog' || app.userState.isAdmin,
      );
      const payload = await app.callApi(
        `/circuits/${encodeURIComponent(state.intent.cid)}?revision=${state.intent.revision}`,
        { method: 'GET' },
      );
      if (generation !== state.generation || state.cancelled) return;
      if (
        payload.circuit?.cid !== state.intent.cid ||
        Number(payload.circuit.revision) !== state.intent.revision
      ) {
        throw new Error('电路版本未通过验证，未生成引用。');
      }
      state.verified = true;
      const saved = readDraft();
      const currentBoard = new URLSearchParams(window.location.search).get('board');
      if (title.value || content.value || state.edits !== edits || currentBoard !== initialBoard) {
        showMessage(
          '当前已有草稿或已更改版块，未覆盖任何内容。需要时可将这份电路引用追加到正文。',
          { offerAppend: true },
        );
        if (title.value || content.value) showComposer();
        return;
      }
      applyDraft(saved);
    } catch (error) {
      if (generation !== state.generation || state.cancelled) return;
      state.verified = false;
      if ([400, 404].includes(error.status)) removeStorage(pointerKey);
      showMessage(
        error.status === 404
          ? '未找到这份电路或指定版本，未生成引用。请返回电路页面确认已保存。'
          : error.message || '暂时无法验证电路，请刷新后重试。',
        { error: true },
      );
    }
  }

  append.addEventListener('click', () => {
    if (!state.verified || state.applied || state.cancelled) return;
    const reference = markdown();
    const next = content.value.includes(reference)
      ? content.value
      : `${content.value}${content.value ? '\n\n' : ''}${reference}`;
    if (next.length > 20000) {
      showMessage('正文已接近长度上限，请先缩短草稿，再追加电路引用。', {
        error: true,
        offerAppend: true,
      });
      return;
    }
    content.value = next;
    if (!title.value) title.value = defaultTitle;
    if (!board.value) board.value = 'circuit';
    markApplied();
    draftStatus();
  });
  document.getElementById('circuit-discussion-dismiss').addEventListener('click', () => {
    if (!state.applied) finish();
    else notice.classList.add('hidden');
  });
  form.addEventListener('input', () => {
    state.edits += 1;
    persist();
  });
  form.addEventListener('change', () => {
    state.edits += 1;
    persist();
  });
  form.addEventListener('submit', persist);
  form.addEventListener('discussion:published', () => {
    if (state.applied) finish();
  });
  window.addEventListener('beforeunload', (event) => {
    if (!persist()) event.preventDefault();
  });
  window.addEventListener('pagehide', persist);
  window.addEventListener('freebbs:session-change', async () => {
    if (!state.initialized || state.cancelled || !state.intent) return;
    const uid = currentUid();
    if (uid === state.uid) return;
    const previousUid = state.uid;
    state.uid = uid;
    state.generation += 1;
    if (previousUid) {
      finish({ clearFields: true });
      return;
    }
    writePointer();
    if (state.applied) {
      persist();
      draftStatus(true);
      showComposer();
    } else await verifyAndPrepare(await app.discussionReady);
  });

  async function initialize() {
    try {
      const [, ready] = await Promise.all([app.sessionReady, app.discussionReady]);
      state.uid = currentUid();
      state.initialized = true;
      state.intent = resolveIntent();
      if (!state.intent) return;
      writePointer();
      await verifyAndPrepare(ready);
    } catch (error) {
      showMessage(error.message || '电路发帖草稿无法载入。', { error: true });
    }
  }
  initialize();
})();
