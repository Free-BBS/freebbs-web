/* Optional course preferences guide help; they never gate learning or assess ability. */
(function exposeLearningStart(root) {
  const BASE = 'free_bbs_learning_start_v1';
  const TICKETS = 'free_bbs_learning_start_ticket_v1';
  const SCHEMA_VERSION = 2;
  const strategies =
    root.FreeBbsLearningStrategies ||
    (typeof module !== 'undefined' && module.exports ? require('./learning-strategies') : null);
  const LEVELS = [
    ['new', '第一次学'],
    ['familiar', '不甚熟悉'],
    ['basic', '能独立做题'],
    ['advanced', '完整掌握'],
  ];
  const GOALS = [
    ['concepts', '理解知识'],
    ['practice', '练习解题'],
    ['explore', '探索研究'],
  ];
  function normalizePreference(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (!LEVELS.some(([key]) => key === value.level)) return null;
    const goal = GOALS.some(([key]) => key === value.goal) ? value.goal : '';
    return { level: value.level, goal };
  }
  function promptHintFromPreference(value, context = {}) {
    const selected = normalizePreference(value);
    if (!selected) return '';
    // The backend reconstructs this same controlled strategy; free-form hints are not trusted.
    return (
      strategies?.buildStrategy(selected, {
        hasContent: false,
        hasQuestions: false,
        ...(context && typeof context === 'object' && !Array.isArray(context) ? context : {}),
      })?.hint || ''
    );
  }
  function restorablePreference(value) {
    // Legacy advanced meant "想深入", not a claim of complete mastery.
    if (value?.schemaVersion !== SCHEMA_VERSION && value?.level === 'advanced') return null;
    return normalizePreference(value);
  }
  function courseKey(detail) {
    const course = typeof detail === 'string' ? detail : detail?.course?.slug || detail?.courseSlug;
    return typeof course === 'string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(course) ? course : null;
  }
  async function sessionFingerprint(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await root.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }
  function createController({
    progress,
    storage,
    sessionStorage,
    userState,
    memoryOnly = false,
    storageAvailable = !memoryOnly,
    sessionStorageAvailable = !memoryOnly,
    authStorageUnavailable = false,
    fingerprint = sessionFingerprint,
    clock = () => new Date(),
  }) {
    let identity = '';
    let stale = false;
    let course = null;
    let selected = null;
    let confirmed = false;
    let editing = false;
    let digest = null;
    let ticketAvailable = sessionStorageAvailable;
    let persistenceScope = 'page';
    let generation = 0;
    const pagePreferences = new Map();
    const signature = () => {
      const state = userState();
      return JSON.stringify([state?.isLoggedIn, state?.uid, state?.token]);
    };
    function identityReady() {
      const state = userState();
      let storedToken = null;
      try {
        storedToken = storage?.getItem('free_bbs_auth_token');
      } catch {
        /* Local storage is optional. */
      }
      if (state?.isLoggedIn === true)
        return Boolean(
          state.uid && state.token && (authStorageUnavailable || storedToken === state.token),
        );
      return state?.isLoggedIn === false && !storedToken;
    }
    const ownerKey = () => progress?.scopedKey(BASE, userState());
    const pageKey = () => JSON.stringify([ownerKey(), course]);
    const valid = () =>
      !stale && signature() === identity && identityReady() && Boolean(ownerKey());
    async function load() {
      generation += 1;
      const request = generation;
      selected = null;
      confirmed = false;
      editing = false;
      digest = null;
      persistenceScope = 'page';
      ticketAvailable = sessionStorageAvailable;
      if (!course || !valid()) return false;
      let nextDigest;
      let fingerprintUnavailable = false;
      try {
        nextDigest = await fingerprint(identity);
      } catch {
        nextDigest = 'current-page-only';
        fingerprintUnavailable = true;
      }
      if (request !== generation || !valid()) return false;
      if (fingerprintUnavailable) {
        ticketAvailable = false;
      }
      digest = nextDigest;
      const pageSaved = pagePreferences.get(pageKey());
      if (pageSaved) {
        selected = normalizePreference(pageSaved.preference);
        persistenceScope = pageSaved.scope;
      } else if (userState().isLoggedIn === true && storageAvailable) {
        // Stable account ownership restores a preference; a tab ticket is not a learning gate.
        selected = restorablePreference(progress.read(storage, BASE, userState())[course]);
        if (selected) persistenceScope = 'browser';
      } else if (userState().isLoggedIn === false && ticketAvailable) {
        const ticket = progress.read(sessionStorage, TICKETS, userState())[course];
        if (ticket?.schemaVersion === SCHEMA_VERSION && ticket?.fingerprint === digest) {
          selected = normalizePreference(ticket.preference);
          if (selected) persistenceScope = 'tab';
        }
      }
      confirmed = Boolean(selected);
      return true;
    }
    identity = signature();
    return {
      async setContext(detail) {
        const next = courseKey(detail);
        if (next === course && digest && valid()) return this.snapshot();
        course = next;
        await load();
        return this.snapshot();
      },
      snapshot() {
        return {
          generation,
          courseKnown: Boolean(course),
          status: stale ? 'stale' : identityReady() ? 'loading' : 'pending',
          valid: Boolean(course && valid() && digest),
          confirmed,
          editing,
          persistenceAvailable: persistenceScope !== 'page',
          persistenceScope,
          preference: valid() ? normalizePreference(selected) : null,
        };
      },
      confirm(value, expectedGeneration = generation) {
        const next = normalizePreference(value);
        if (!next || !course || !digest || !valid() || expectedGeneration !== generation)
          return false;
        let nextScope = 'page';
        if (userState().isLoggedIn === true && storageAvailable) {
          try {
            const records = progress.read(storage, BASE, userState());
            progress.write(storage, BASE, userState(), {
              ...records,
              [course]: {
                ...next,
                schemaVersion: SCHEMA_VERSION,
                updatedAt: clock().toISOString(),
              },
            });
            nextScope = 'browser';
          } catch {
            /* The applied preference remains available in this page only. */
          }
        }
        try {
          if (!ticketAvailable) throw new Error('Current-page confirmation only');
          const tickets = progress.read(sessionStorage, TICKETS, userState());
          progress.write(sessionStorage, TICKETS, userState(), {
            ...tickets,
            [course]: { schemaVersion: SCHEMA_VERSION, fingerprint: digest, preference: next },
          });
          if (userState().isLoggedIn === false) nextScope = 'tab';
        } catch {
          /* A missing tab ticket does not undo a successful browser save. */
        }
        selected = next;
        confirmed = true;
        editing = false;
        persistenceScope = nextScope;
        pagePreferences.set(pageKey(), { preference: next, scope: nextScope });
        generation += 1;
        return true;
      },
      adjust() {
        if (!course || !digest || !valid()) return false;
        generation += 1;
        editing = true;
        return true;
      },
      cancel(expectedGeneration = generation) {
        if (!editing || !valid() || expectedGeneration !== generation) return false;
        generation += 1;
        editing = false;
        return true;
      },
      async sessionChanged() {
        const nextIdentity = signature();
        if (nextIdentity === identity) {
          if (!identityReady()) return false;
          if (digest && !stale) return false;
          stale = false;
          return load();
        }
        identity = nextIdentity;
        stale = false;
        await load();
        return true;
      },
      invalidate() {
        stale = true;
        generation += 1;
        selected = null;
        confirmed = false;
        editing = false;
        digest = null;
      },
      currentPreference: () => (valid() && confirmed ? normalizePreference(selected) : null),
      promptHint: () => (valid() && confirmed ? promptHintFromPreference(selected) : ''),
    };
  }
  const api = {
    BASE,
    TICKETS,
    SCHEMA_VERSION,
    LEVELS,
    GOALS,
    normalizePreference,
    restorablePreference,
    promptHintFromPreference,
    courseKey,
    createController,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    return;
  }
  const app = root?.freeBbsApp;
  const host = root?.document?.getElementById('learning-start-selector');
  const page = root?.document?.querySelector('[data-knowledge-page]');
  if (!app || !host || !root.FreeBbsLearningProgress) return;
  function safeStorage(name) {
    try {
      const value = root[name];
      if (typeof value?.getItem === 'function' && typeof value?.setItem === 'function') {
        value.getItem('free_bbs_learning_start_storage_probe');
        return { value, available: true };
      }
    } catch {
      /* A browser may deny the storage getter itself. */
    }
    const values = new Map();
    return {
      available: false,
      value: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
      },
    };
  }
  const local = safeStorage('localStorage');
  const session = safeStorage('sessionStorage');
  const controller = createController({
    progress: root.FreeBbsLearningProgress,
    storage: local.value,
    sessionStorage: session.value,
    storageAvailable: local.available,
    sessionStorageAvailable: session.available,
    authStorageUnavailable: !local.available,
    userState: () => app.userState,
  });
  let dialog = null;
  let knowledgeContext = null;
  let renderedState = null;
  let updateGeneration = 0;
  const sessionIdentity = () =>
    JSON.stringify([app.userState?.isLoggedIn, app.userState?.uid, app.userState?.token]);
  const currentUpdate = (request, generation, identity) =>
    request === updateGeneration &&
    generation === controller.snapshot().generation &&
    identity === sessionIdentity();
  function recordAppliedChoice() {
    const preference = controller.currentPreference();
    const node = knowledgeContext?.node;
    const course = courseKey(knowledgeContext);
    if (!preference || !node?.id || !course) return;
    // Restoring an effective preference is not a new student choice.
    root.FreeBbsLearningAnalytics?.recordLearningChoice?.({
      action: 'learning_start_set',
      courseSlug: course,
      nodeId: node.id,
      level: preference.level,
      goal: preference.goal || null,
      ...(/^[a-f0-9]{64}$/.test(node.documentVersion || '')
        ? { documentVersion: node.documentVersion }
        : {}),
    });
  }
  function emitChange() {
    if (typeof root.CustomEvent === 'function')
      root.dispatchEvent(
        new root.CustomEvent('learning:start-change', {
          detail: { preference: controller.currentPreference() },
        }),
      );
  }
  function element(tag, text, className) {
    const item = root.document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function render() {
    if (dialog?.open) dialog.close();
    dialog = null;
    const state = controller.snapshot();
    renderedState = state;
    host.replaceChildren();
    host.hidden = !state.courseKnown;
    if (host.hidden) return;
    host.classList.add('learning-start');
    if (!state.valid) {
      const title =
        state.status === 'stale'
          ? '登录状态已变化，学习偏好暂不可用；可继续阅读。'
          : state.status === 'pending'
            ? '正在确认登录状态；可继续阅读。'
            : '正在恢复学习偏好；可继续阅读。';
      host.append(element('span', title, 'learning-start-note'));
      if (state.status === 'stale') {
        const refresh = element('button', '刷新页面', 'learning-start-apply');
        refresh.type = 'button';
        refresh.addEventListener('click', () => root.location.reload());
        host.append(refresh);
      }
      return;
    }
    const adjust = element(
      'button',
      state.confirmed ? '调整学习起点' : '设置学习起点（可选）',
      'learning-start-adjust',
    );
    adjust.type = 'button';
    adjust.addEventListener('click', () => {
      if (controller.snapshot().generation !== state.generation) return;
      if (controller.adjust()) render();
    });
    host.append(adjust);
    if (state.confirmed) {
      const levelLabel = LEVELS.find(([key]) => key === state.preference.level)?.[1];
      const goalLabel = GOALS.find(([key]) => key === state.preference.goal)?.[1];
      host.append(
        element('span', [levelLabel, goalLabel].filter(Boolean).join(' · '), 'learning-start-note'),
      );
      const scopeLabels = {
        browser: '偏好已保存在本机浏览器。',
        tab: '偏好仅保存在当前标签页。',
        page: '偏好仅在当前页面生效，未持久保存。',
      };
      host.append(element('span', scopeLabels[state.persistenceScope], 'learning-start-note'));
    } else
      host.append(
        element('span', '可直接阅读、做题或探索，需要时再设置建议偏好。', 'learning-start-note'),
      );
    if (!state.editing) return;
    dialog = element('dialog', undefined, 'learning-start-dialog');
    dialog.setAttribute('aria-label', '设置学习建议偏好');
    function cancelEditing() {
      if (controller.cancel(state.generation)) render();
    }
    dialog.addEventListener('cancel', cancelEditing);
    dialog.append(
      element('h3', '设置学习建议偏好'),
      element('p', '这是你的自评，只用于讲解与下一步建议；可随时关闭。', 'learning-start-note'),
    );
    const choices = element('div', undefined, 'learning-start-choices');
    function choice(title, name, values, defaultValue) {
      const label = element('label');
      const select = element('select');
      select.name = name;
      select.dataset.learningStartChoice = name;
      if (name === 'level') select.required = true;
      const blank = element('option', name === 'level' ? '请选择' : '使用推荐目标');
      blank.value = '';
      select.append(blank);
      values.forEach(([value, text]) => {
        const option = element('option', text);
        option.value = value;
        select.append(option);
      });
      select.value = state.preference?.[name] ?? defaultValue;
      label.append(element('span', title), select);
      choices.append(label);
      return select;
    }
    const level = choice('熟悉程度', 'level', LEVELS, '');
    const goal = choice('这次目标（可选）', 'goal', GOALS, '');
    function showSuggestedGoal() {
      const suggested = strategies?.recommendedGoal(level.value);
      goal.children[0].textContent = suggested
        ? `建议：${GOALS.find(([key]) => key === suggested)?.[1]}`
        : '使用推荐目标';
    }
    showSuggestedGoal();
    const actions = element('div', undefined, 'learning-start-actions');
    const apply = element('button', '保存偏好', 'learning-start-apply');
    apply.type = 'button';
    apply.disabled = !level.value;
    level.addEventListener('change', () => {
      apply.disabled = !level.value;
      showSuggestedGoal();
    });
    const cancel = element('button', state.confirmed ? '取消' : '暂不设置', 'learning-start-exit');
    cancel.type = 'button';
    cancel.addEventListener('click', cancelEditing);
    const status = element('span', '', 'learning-start-status');
    status.setAttribute('role', 'status');
    apply.addEventListener('click', () => {
      if (controller.confirm({ level: level.value, goal: goal.value }, state.generation)) {
        render();
        emitChange();
        recordAppliedChoice();
      } else if (controller.snapshot().generation === state.generation)
        status.textContent = '请选择熟悉程度。';
    });
    actions.append(apply, cancel, status);
    dialog.append(choices, actions);
    host.append(dialog);
    dialog.showModal();
  }
  function renderMatchesCurrent() {
    const state = controller.snapshot();
    return (
      renderedState &&
      ['generation', 'valid', 'confirmed', 'editing', 'courseKnown', 'status'].every(
        (key) => renderedState[key] === state[key],
      )
    );
  }
  async function setContext(detail) {
    updateGeneration += 1;
    const request = updateGeneration;
    const identity = sessionIdentity();
    const before = controller.snapshot().generation;
    let generation = before;
    try {
      const pending = controller.setContext(detail);
      generation = controller.snapshot().generation;
      // A repeated point/context notification is not a preference change. A
      // digest may nevertheless have finished before its outer render resumed:
      // compare the rendered state rather than skipping that legitimate finish.
      const changed = !renderMatchesCurrent();
      if (changed) render();
      await pending;
      if (!currentUpdate(request, generation, identity)) return;
      const completed = !renderMatchesCurrent();
      if (completed) render();
      if (changed || completed) emitChange();
    } catch {
      if (currentUpdate(request, generation, identity)) render();
    }
  }
  page?.addEventListener('knowledge:loaded', (event) => {
    knowledgeContext = event.detail;
    setContext(event.detail);
  });
  root.addEventListener('freebbs:session-change', async () => {
    updateGeneration += 1;
    const request = updateGeneration;
    const identity = sessionIdentity();
    const pending = controller.sessionChanged();
    const { generation } = controller.snapshot();
    const changed = !renderMatchesCurrent();
    if (changed) render();
    try {
      await pending;
      // The controller protects stored preferences; this separate UI guard also
      // protects newer unsaved dialog inputs and avoids emitting a stale change.
      if (currentUpdate(request, generation, identity)) {
        const completed = !renderMatchesCurrent();
        if (completed) render();
        if (changed || completed) emitChange();
      }
    } catch {
      if (currentUpdate(request, generation, identity)) render();
    }
  });
  root.addEventListener('storage', (event) => {
    if (event.key === 'free_bbs_auth_token' || event.key === null) {
      updateGeneration += 1;
      controller.invalidate();
      render();
      emitChange();
    }
  });
  root.FreeBbsLearningStart = {
    currentPreference: () => controller.currentPreference(),
    promptHint: () => controller.promptHint(),
    setContext,
  };
  const course =
    new URLSearchParams(root.location.search).get('course') ||
    (/^\/course\/?$/.test(root.location.pathname) ? 'signals' : null);
  setContext(course);
})(typeof window !== 'undefined' ? window : globalThis);
