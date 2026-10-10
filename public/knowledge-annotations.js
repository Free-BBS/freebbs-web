/* Private annotations are overlays; the course Markdown remains the source of truth. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FreeBbsKnowledgeAnnotations = api;
})(typeof window === 'undefined' ? null : window, (root) => {
  const COLORS = ['yellow', 'green', 'blue', 'purple'];
  const BLOCK_SELECTOR =
    'p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,figure,img,.katex-display,.math-display';
  const QUIZ_SELECTOR =
    '.freebbs-quiz,[data-freebbs-quiz],.knowledge-quiz,.learning-assessment,[data-learning-quiz],#learning-quiz-list,#learning-quiz-results,.learning-quiz-card,.learning-quiz-result';
  function fingerprint(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i); // eslint-disable-line no-bitwise -- FNV-1a requires a fixed 32-bit XOR.
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0'); // eslint-disable-line no-bitwise -- Preserve the unsigned 32-bit FNV fingerprint.
  }
  function stableBlocks(values) {
    const counts = new Map();
    return values.map((value) => {
      const type = value.type || 'text';
      const key = fingerprint(`${type}\u0000${value.text}`);
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      return { ...value, type, anchor: `b-${key}-${count}` };
    });
  }
  function createAnchor({ nodeId, documentVersion, block, start, end, wholeBlock = false }) {
    const text = block.text;
    if (wholeBlock) {
      start = 0;
      end = text.length;
    }
    if (
      !nodeId ||
      !/^[a-f0-9]{64}$/i.test(documentVersion || '') ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end > text.length ||
      end <= start ||
      end - start > 8000
    )
      throw new Error('请选择至少一个字符，或一个完整的公式、图片、表格。');
    return {
      nodeId,
      documentVersion: documentVersion.toLowerCase(),
      blockAnchor: block.anchor,
      range: { start, end },
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - 48), start),
      suffix: text.slice(end, end + 48),
      wholeBlock,
      blockType: block.type || 'text',
    };
  }
  function locateAnchor(anchor, blocks, currentVersion) {
    const pending = {
      status: 'pending',
      reason: '原文已变化或定位不唯一，请重新选择；评注仍保留。',
    };
    if (!anchor?.quote || !anchor.range) return pending;
    const source =
      anchor.blockAnchor === 'document'
        ? blocks.filter((block) => block.anchor === 'document')
        : blocks.filter((block) => block.anchor !== 'document');
    const exact = source.find((block) => block.anchor === anchor.blockAnchor);
    if (
      anchor.documentVersion === currentVersion &&
      exact &&
      exact.text.slice(anchor.range.start, anchor.range.end) === anchor.quote
    )
      return { status: 'exact', block: exact, start: anchor.range.start, end: anchor.range.end };
    const candidates = [];
    for (const block of source) {
      if (block.type !== (anchor.blockType || 'text')) continue;
      let start = block.text.indexOf(anchor.quote);
      while (start !== -1) {
        const end = start + anchor.quote.length;
        const prefix = anchor.prefix || '';
        const suffix = anchor.suffix || '';
        const before = block.text.slice(Math.max(0, start - prefix.length), start);
        const after = block.text.slice(end, end + suffix.length);
        candidates.push({ block, start, end, context: before === prefix && after === suffix });
        start = block.text.indexOf(anchor.quote, start + 1);
      }
    }
    const contextual = candidates.filter((candidate) => candidate.context);
    const reliable = contextual.length ? contextual : candidates;
    if (reliable.length !== 1) return pending;
    const { block, start, end } = reliable[0];
    if (anchor.wholeBlock && (start !== 0 || end !== block.text.length)) return pending;
    return { status: 'relocated', block, start, end };
  }
  function privateAnnotations(entries) {
    return (Array.isArray(entries) ? entries : []).filter(
      (entry) =>
        entry.kind === 'note' &&
        entry.status === 'private' &&
        ['highlight', 'underline', 'comment'].includes(entry.annotation?.style) &&
        COLORS.includes(entry.annotation?.color) &&
        typeof entry.annotation?.anchor?.quote === 'string' &&
        entry.annotation.anchor.quote.length &&
        entry.annotation.anchor.range,
    );
  }
  function correctionExcerpt(anchor) {
    // The stored anchor retains the complete range; the legacy correction form is a preview.
    return String(anchor?.quote || '').slice(0, 600);
  }
  function install(document, app) {
    const page = document.querySelector('[data-knowledge-page]');
    if (!page) return null;
    const byId = (id) => document.getElementById(id);
    const state = {
      course: null,
      node: null,
      entries: [],
      selection: null,
      selectedEntry: null,
      uid: app?.userState?.uid || '',
      token: app?.userState?.token || '',
      editing: true,
      color: 'yellow',
      version: 0,
      callback: {},
      saveDraft: null,
      annotationRecordsLoaded: false,
      nextCursor: null,
    };
    // One canonical reader: the notebook opens tools around it, never a cloned document.
    const inlineHost = byId('learning-reading-notes-host');
    const notesPanel = page.querySelector('[data-learning-panel="notes"]');
    if (inlineHost && notesPanel) inlineHost.append(notesPanel);
    const annotationToolbar = byId('learning-annotation-toolbar');
    const pagingCount = document.createElement('small');
    pagingCount.id = 'learning-annotations-count';
    pagingCount.hidden = true;
    const moreAnnotations = document.createElement('button');
    moreAnnotations.id = 'learning-annotations-more';
    moreAnnotations.type = 'button';
    moreAnnotations.textContent = '更多评注';
    moreAnnotations.hidden = true;
    moreAnnotations.addEventListener('click', () => {
      if (state.nextCursor)
        dispatch('knowledge:annotations-more', { nextCursor: state.nextCursor });
    });
    annotationToolbar?.append(pagingCount, moreAnnotations);
    function updatePaging() {
      const more = Boolean(state.nextCursor);
      moreAnnotations.hidden = !more;
      pagingCount.hidden = !more;
      pagingCount.textContent = more
        ? `已加载 ${privateAnnotations(state.entries).length} 条评注`
        : '';
    }
    const message = (value) => {
      const element = byId('learning-annotation-status');
      if (element) element.textContent = value;
    };
    function showToolbar(show, container) {
      const toolbar = byId('learning-annotation-toolbar');
      if (!toolbar) return;
      if (show && container && notesPanel?.hidden)
        dispatch('knowledge:tool-select', { tool: 'notes' });
      const status = byId('learning-annotation-status');
      if (status && toolbar.nextElementSibling !== status) toolbar.after(status);
      toolbar.hidden = !show;
      toolbar.classList.toggle('hidden', !show);
    }
    function strip(container) {
      if (!container) return;
      container
        .querySelectorAll('[data-private-annotation]')
        .forEach((mark) => mark.replaceWith(...mark.childNodes));
      container.querySelectorAll('[data-private-annotation-block]').forEach((block) => {
        delete block.dataset.privateAnnotationBlock;
        block.classList.remove(
          'learning-annotation-block',
          ...COLORS.map((color) => `learning-highlight-${color}`),
          'learning-annotation-underline',
          'learning-annotation-comment',
        );
      });
      container.normalize();
    }
    function typeOf(element) {
      if (element.matches('table')) return 'table';
      if (element.matches('.katex,.katex-display,.math-display')) return 'formula';
      if (element.matches('img,figure')) return 'image';
      const prose = element.cloneNode(true);
      prose
        .querySelectorAll('img,.katex,.katex-display,.math-display')
        .forEach((item) => item.remove());
      if (!prose.textContent.trim()) {
        if (element.querySelector('.katex,.math-display')) return 'formula';
        if (element.querySelector('img')) return 'image';
      }
      return 'text';
    }
    function blocksFor(container) {
      if (!container) return [];
      const elements = [...container.querySelectorAll(BLOCK_SELECTOR)]
        .filter((element) => !element.closest(QUIZ_SELECTOR))
        .filter((element) => {
          const parent = element.parentElement?.closest(BLOCK_SELECTOR);
          return !parent || !container.contains(parent);
        });
      if (!elements.length && container.textContent) elements.push(container);
      const atomic = [...container.querySelectorAll('img,.katex,.math-display')].filter(
        (element) => {
          const parent = elements.find((block) => block.contains(element));
          return parent && typeOf(parent) === 'text' && !element.closest(QUIZ_SELECTOR);
        },
      );
      const values = [...elements, ...atomic].map((element) => ({
        element,
        type: typeOf(element),
        text:
          element.textContent ||
          element.querySelector('img')?.alt ||
          element.getAttribute('alt') ||
          '[图片]',
      }));
      const blocks = stableBlocks(values);
      blocks.forEach((block) => {
        block.element.dataset.annotationBlockAnchor = block.anchor;
      });
      blocks.push({
        anchor: 'document',
        type: 'text',
        text: textNodes(container)
          .map((node) => node.data)
          .join(''),
        element: container,
      });
      return blocks;
    }
    function textNodes(element) {
      const walker = document.createTreeWalker(element, root.NodeFilter.SHOW_TEXT);
      const values = [];
      let node = walker.nextNode();
      while (node) {
        if (!node.parentElement.closest(QUIZ_SELECTOR)) values.push(node);
        node = walker.nextNode();
      }
      return values;
    }
    function offsetOf(element, node, offset) {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(node, offset);
      const contents = range.cloneContents();
      contents.querySelectorAll(QUIZ_SELECTOR).forEach((quiz) => quiz.remove());
      return contents.textContent.length;
    }
    function wrap(block, location, annotations) {
      const nodes = textNodes(block.element);
      let position = 0;
      for (const node of nodes) {
        const begin = position;
        const end = begin + node.data.length;
        position = end;
        if (end <= location.start || begin >= location.end) continue;
        const startInNode = Math.max(0, location.start - begin);
        const endInNode = Math.min(node.data.length, location.end - begin);
        const chosen = startInNode ? node.splitText(startInNode) : node;
        if (endInNode - startInNode < chosen.data.length) chosen.splitText(endInNode - startInNode);
        const mark = document.createElement('span');
        mark.dataset.privateAnnotation = annotations.map((entry) => entry.id).join(',');
        for (const entry of annotations) {
          const annotation = entry.annotation;
          mark.classList.add('learning-annotation', `learning-annotation-${annotation.style}`);
          if (annotation.style === 'highlight')
            mark.classList.add(`learning-highlight-${annotation.color}`);
        }
        mark.title = annotations.map((entry) => entry.content).join('\n');
        chosen.before(mark);
        mark.append(chosen);
      }
    }
    function renderContainer(container, records) {
      strip(container);
      const blocks = blocksFor(container);
      const located = records.map((entry) => ({
        entry,
        location: locateAnchor(entry.annotation.anchor, blocks, state.node?.documentVersion),
      }));
      const ranges = new Map();
      for (const { entry, location } of located) {
        if (location.status === 'pending') continue;
        const { block } = location;
        if (entry.annotation.anchor.wholeBlock) {
          const element = block.element;
          element.dataset.privateAnnotationBlock = entry.id;
          element.classList.add(
            'learning-annotation-block',
            `learning-annotation-${entry.annotation.style}`,
          );
          if (entry.annotation.style === 'highlight')
            element.classList.add(`learning-highlight-${entry.annotation.color}`);
          continue;
        }
        if (!ranges.has(block)) ranges.set(block, []);
        ranges.get(block).push({ entry, start: location.start, end: location.end });
      }
      // Partition overlaps into disjoint segments before touching DOM text nodes.
      for (const [block, values] of ranges) {
        const endpoints = [...new Set(values.flatMap((value) => [value.start, value.end]))].sort(
          (a, b) => b - a,
        );
        for (let i = 0; i < endpoints.length - 1; i += 1) {
          const start = endpoints[i + 1];
          const end = endpoints[i];
          const entries = values
            .filter((value) => value.start < end && value.end > start)
            .map((value) => value.entry);
          if (entries.length) wrap(block, { start, end }, entries);
        }
      }
      return located;
    }
    function renderList(located) {
      const list = byId('learning-annotation-list');
      if (!list) return;
      list.replaceChildren();
      for (const { entry, location } of located) {
        const card = document.createElement('article');
        card.className = 'learning-annotation-record';
        card.dataset.annotationId = entry.id;
        const quote = document.createElement('blockquote');
        quote.textContent = entry.annotation.anchor.quote;
        const content = document.createElement('p');
        content.textContent = entry.content;
        const status = document.createElement('small');
        status.textContent =
          location.status === 'pending'
            ? '待重新定位 · 评注已保留'
            : location.status === 'relocated'
              ? '已按原文与上下文重新定位'
              : '已定位';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = '定位与编辑';
        edit.addEventListener('click', () => {
          state.selection = entry.annotation.anchor;
          state.selectedEntry = entry;
          state.color = entry.annotation.color;
          page
            .querySelectorAll('[data-annotation-color]')
            .forEach((button) =>
              button.setAttribute(
                'aria-pressed',
                String(button.dataset.annotationColor === state.color),
              ),
            );
          const comment = byId('learning-annotation-comment');
          if (comment) comment.value = entry.content;
          showToolbar(true, byId('knowledge-body'));
          const original = byId('knowledge-body');
          const marked =
            original &&
            [...original.querySelectorAll('[data-private-annotation]')].find((element) =>
              element.dataset.privateAnnotation.split(',').includes(String(entry.id)),
            );
          if (location.status !== 'pending')
            (marked || location.block?.element)?.scrollIntoView({
              block: 'center',
              behavior: 'smooth',
            });
          message(
            location.status === 'pending'
              ? '此评注尚未定位，可保留文字或重新选择原文。'
              : '已选择已有评注。',
          );
        });
        card.append(quote, content, status, edit);
        list.append(card);
      }
      if (!located.length) {
        const empty = document.createElement('p');
        empty.textContent = '选择原文中的文字，留下只对自己可见的高亮、下划线或评注。';
        list.append(empty);
      }
    }
    function refresh() {
      const original = byId('knowledge-body');
      strip(original);
      const entries = privateAnnotations(state.entries).filter(
        (entry) => entry.annotation.anchor.nodeId === state.node?.id,
      );
      const locations = renderContainer(original, entries);
      renderList(locations);
      updatePaging();
    }
    function captureSelection() {
      const selection = root.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      const original = byId('knowledge-body');
      const container = [original].find(
        (element) =>
          element?.contains(range.startContainer) && element.contains(range.endContainer),
      );
      if (!container || !state.editing || container.closest('[hidden],.hidden')) return;
      if (!app?.userState?.isLoggedIn || !app.userState.token) {
        message('登录后可保存只对自己可见的原文评注。');
        return;
      }
      if (!state.node?.documentVersion) {
        message('正文版本尚未就绪，请刷新后再标注。');
        return;
      }
      const blocks = blocksFor(container);
      const containsRange = (value) =>
        value.anchor !== 'document' &&
        value.element.contains(range.startContainer) &&
        value.element.contains(range.endContainer);
      let block =
        blocks.find((value) => value.type !== 'text' && containsRange(value)) ||
        blocks.find(containsRange);
      block ||= blocks.at(-1);
      try {
        const wholeBlock = block.type !== 'text';
        state.selection = createAnchor({
          nodeId: state.node.id,
          documentVersion: state.node.documentVersion,
          block,
          start: offsetOf(block.element, range.startContainer, range.startOffset),
          end: offsetOf(block.element, range.endContainer, range.endOffset),
          wholeBlock,
        });
        state.selectedEntry = null;
        showToolbar(true, container);
        message(
          wholeBlock
            ? '公式、图片和表格按完整块标注。'
            : `已选择 ${state.selection.quote.length} 个字符。`,
        );
      } catch (error) {
        message(error.message);
      }
    }
    function captureAtomic(target) {
      const atomic = target.closest?.('img,.katex,.katex-display,.math-display,table');
      if (!atomic) return;
      const original = byId('knowledge-body');
      const container = [original].find((element) => element?.contains(atomic));
      if (
        !container ||
        !state.editing ||
        !app?.userState?.isLoggedIn ||
        !app.userState.token ||
        !state.node?.documentVersion
      )
        return;
      const block = blocksFor(container).find(
        (value) =>
          value.anchor !== 'document' && value.type !== 'text' && value.element.contains(atomic),
      );
      if (!block) return;
      try {
        state.selection = createAnchor({
          nodeId: state.node.id,
          documentVersion: state.node.documentVersion,
          block,
          start: 0,
          end: block.text.length,
          wholeBlock: true,
        });
        state.selectedEntry = null;
        showToolbar(true, container);
        message('公式、图片和表格按完整块标注。');
      } catch (error) {
        message(error.message);
      }
    }
    function dispatch(name, detail) {
      page.dispatchEvent(new root.CustomEvent(name, { detail, bubbles: true }));
    }
    function act(action) {
      if (!state.selection) {
        message('请先选择原文或一条已有评注。');
        return;
      }
      const annotation = {
        style: ['highlight', 'underline', 'comment'].includes(action) ? action : 'comment',
        color: state.color,
        anchor: state.selection,
      };
      if (action === 'ask') {
        const detail = {
          annotation,
          prompt: `关于这段原文「${state.selection.quote}」，我的问题是：`,
        };
        if (state.callback.onAsk) state.callback.onAsk(detail);
        else dispatch('knowledge:annotation-ask', detail);
        return;
      }
      if (action === 'correction') {
        if (annotation.anchor.documentVersion !== state.node.documentVersion) {
          const location = locateAnchor(
            annotation.anchor,
            blocksFor(byId('knowledge-body')),
            state.node.documentVersion,
          );
          if (location.status === 'pending') {
            message('请先重新选择当前原文，再提交这条纠错；原有评注已保留。');
            return;
          }
          annotation.anchor = createAnchor({
            nodeId: state.node.id,
            documentVersion: state.node.documentVersion,
            block: location.block,
            start: location.start,
            end: location.end,
            wholeBlock: annotation.anchor.wholeBlock,
          });
        }
        const detail = { annotation, excerpt: correctionExcerpt(annotation.anchor) };
        if (state.callback.onCorrection) state.callback.onCorrection(detail);
        else dispatch('knowledge:annotation-correction', detail);
        return;
      }
      if (action === 'remove') {
        if (!state.selectedEntry) {
          message('请先在评注列表中选择要移除的一条。');
          return;
        }
        dispatch('knowledge:annotation-remove', { entry: state.selectedEntry });
        return;
      }
      const comment = byId('learning-annotation-comment')?.value.trim() || '';
      if (action === 'comment' && !comment) {
        message('写下评注后再保存。');
        byId('learning-annotation-comment')?.focus();
        return;
      }
      const content = comment || { highlight: '原文高亮', underline: '原文下划线' }[action];
      const detail = {
        annotation,
        content,
        title: action === 'comment' ? '原文评注' : content,
        entry: state.selectedEntry || undefined,
      };
      const signature = JSON.stringify([
        annotation,
        content,
        detail.title,
        state.selectedEntry?.id,
        state.selectedEntry?.revision,
      ]);
      if (state.saveDraft?.signature !== signature)
        state.saveDraft = { signature, key: root.crypto.randomUUID() };
      detail.requestKey = state.saveDraft.key;
      // Saving is handled by the workspace, which preserves drafts on network/revision failure.
      dispatch('knowledge:annotation-save', detail);
    }
    const attach = (options = {}) => {
      if (options.course) state.course = options.course;
      if (options.node) state.node = options.node;
      if (Array.isArray(options.entries)) state.entries = options.entries;
      for (const name of ['onSaved', 'onCorrection', 'onAsk'])
        if (options[name]) state.callback[name] = options[name];
      refresh();
      return { refresh, setEditing };
    };
    const setEditing = (enabled) => {
      state.editing = Boolean(enabled);
      if (!state.editing) showToolbar(false);
      const original = byId('knowledge-body');
      if (original) original.dataset.annotationEditing = String(state.editing);
    };
    page.addEventListener('click', (event) => {
      captureAtomic(event.target);
      const marked = event.target.closest('[data-private-annotation]');
      if (marked && state.editing && marked.closest('#knowledge-body')) {
        const ids = marked.dataset.privateAnnotation.split(',');
        const entry = privateAnnotations(state.entries).find((record) =>
          ids.includes(String(record.id)),
        );
        if (entry) {
          state.selection = entry.annotation.anchor;
          state.selectedEntry = entry;
          state.color = entry.annotation.color;
          const comment = byId('learning-annotation-comment');
          if (comment) comment.value = entry.content;
          showToolbar(true, byId('knowledge-body'));
          message('已选择你的批注，可修改或取消标注。');
        }
      }
      const color = event.target.closest('[data-annotation-color]')?.dataset.annotationColor;
      if (COLORS.includes(color)) {
        state.color = color;
        page
          .querySelectorAll('[data-annotation-color]')
          .forEach((button) =>
            button.setAttribute('aria-pressed', String(button.dataset.annotationColor === color)),
          );
      }
      const action = event.target.closest('[data-annotation-action]')?.dataset.annotationAction;
      if (action) act(action);
    });
    page.addEventListener('mousedown', (event) => {
      if (event.target.closest('[data-annotation-action],[data-annotation-color]'))
        event.preventDefault();
    });
    page.addEventListener('mouseup', captureSelection);
    page.addEventListener('keyup', (event) => {
      if (event.key.startsWith('Arrow') || event.key === 'Shift') captureSelection();
    });
    page.addEventListener('knowledge:loaded', (event) => {
      state.annotationRecordsLoaded = false;
      state.nextCursor = null;
      state.entries = [];
      attach(event.detail);
      refresh();
    });
    page.addEventListener('knowledge:entries-loaded', (event) => {
      if (!state.annotationRecordsLoaded) attach(event.detail);
    });
    page.addEventListener('knowledge:annotation-records-loaded', (event) => {
      const detail = event.detail || {};
      state.annotationRecordsLoaded = true;
      state.nextCursor = detail.nextCursor || null;
      attach({ ...detail, entries: Array.isArray(detail.entries) ? detail.entries : [] });
    });
    page.addEventListener('knowledge:document-saved', (event) => {
      if (event.detail?.node) state.node = event.detail.node;
      root.requestAnimationFrame(() => refresh());
    });
    page.addEventListener('knowledge:annotation-toggle', (event) =>
      setEditing(event.detail?.enabled),
    );
    page.addEventListener('knowledge:annotation-saved', (event) => {
      state.selection = null;
      state.selectedEntry = null;
      state.saveDraft = null;
      const comment = byId('learning-annotation-comment');
      if (comment) comment.value = '';
      showToolbar(false);
      message('评注已私密保存。');
      state.callback.onSaved?.(event.detail);
    });
    page.addEventListener('knowledge:tool-select', () => showToolbar(false));
    function clearSession() {
      state.version += 1;
      state.entries = [];
      state.selection = null;
      state.selectedEntry = null;
      state.saveDraft = null;
      state.annotationRecordsLoaded = false;
      state.nextCursor = null;
      state.uid = app?.userState?.uid || '';
      state.token = app?.userState?.token || '';
      const comment = byId('learning-annotation-comment');
      if (comment) comment.value = '';
      showToolbar(false);
      refresh();
      message('');
    }
    root.addEventListener('freebbs:session-change', () => {
      if (
        state.uid !== (app?.userState?.uid || '') ||
        state.token !== (app?.userState?.token || '')
      )
        clearSession();
    });
    root.addEventListener('storage', (event) => {
      if (event.key === 'free_bbs_auth_token' || event.key === null) clearSession();
    });
    return { attach, refresh, setEditing };
  }
  let controller;
  function getController() {
    if (!controller && root?.document) controller = install(root.document, root.freeBbsApp);
    return controller;
  }
  if (root?.document) {
    // These scripts sit after the reader markup. Listen before a cached API response can arrive.
    getController();
    if (!controller && root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', getController);
  }
  return {
    COLORS,
    fingerprint,
    stableBlocks,
    createAnchor,
    locateAnchor,
    privateAnnotations,
    correctionExcerpt,
    attach: (options) => getController()?.attach(options),
    refresh: (options) => getController()?.refresh(options),
    setEditing: (enabled) => getController()?.setEditing(enabled),
  };
});
