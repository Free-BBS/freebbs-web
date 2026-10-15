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
      const imageIdentity =
        type === 'image' && value.imageSource
          ? `${fingerprint(`image-source\u0000${value.imageSource}`)}${fingerprint([...value.imageSource].reverse().join(''))}`
          : '';
      const identityKey = imageIdentity ? `i-${imageIdentity}-${key}` : key;
      const count = (counts.get(identityKey) || 0) + 1;
      counts.set(identityKey, count);
      return { ...value, type, anchor: `b-${identityKey}-${count}` };
    });
  }
  function createAnchor({
    nodeId,
    documentVersion,
    block,
    start,
    end,
    wholeBlock = false,
    section = 'body',
  }) {
    const text = block.text;
    if (wholeBlock) {
      start = 0;
      end = text.length;
    }
    if (
      !nodeId ||
      !['body', 'origin'].includes(section) ||
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
      ...(section === 'origin' ? { section } : {}),
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
    const section = anchor.section || 'body';
    if (!['body', 'origin'].includes(section)) return pending;
    const sectionBlocks = blocks.filter((block) => (block.section || 'body') === section);
    const source =
      anchor.blockAnchor === 'document'
        ? sectionBlocks.filter((block) => block.anchor === 'document')
        : sectionBlocks.filter((block) => block.anchor !== 'document');
    const exact = source.find((block) => block.anchor === anchor.blockAnchor);
    if (
      anchor.documentVersion === currentVersion &&
      exact &&
      exact.text.slice(anchor.range.start, anchor.range.end) === anchor.quote
    )
      return { status: 'exact', block: exact, start: anchor.range.start, end: anchor.range.end };
    const wholeImage = anchor.wholeBlock && anchor.blockType === 'image';
    const imageIdentity = wholeImage
      ? anchor.blockAnchor?.match(/^b-i-([a-f0-9]{16})-[a-f0-9]{8}-\d+$/)?.[1]
      : null;
    // Legacy image anchors identify only alt text. After a body revision that is
    // not evidence that the image itself is still the same published material.
    if (wholeImage && anchor.documentVersion !== currentVersion && !imageIdentity) return pending;
    const candidates = [];
    for (const block of source) {
      if (block.type !== (anchor.blockType || 'text')) continue;
      if (
        imageIdentity &&
        block.anchor?.match(/^b-i-([a-f0-9]{16})-[a-f0-9]{8}-\d+$/)?.[1] !== imageIdentity
      )
        continue;
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
  function createUndoHistory(limit = 20, makeKey = () => root?.crypto?.randomUUID?.()) {
    const operations = [];
    const confirmed = new Set();
    const copy = (value) => (value ? JSON.parse(JSON.stringify(value)) : null);
    return {
      push(operation) {
        if (!operation?.requestKey || confirmed.has(operation.requestKey)) return false;
        if (!operation.before && !operation.after) return false;
        confirmed.add(operation.requestKey);
        operations.push(
          copy({ ...operation, undoRequestKey: operation.undoRequestKey || makeKey() }),
        );
        if (operations.length > limit) operations.shift();
        return true;
      },
      peek: () => copy(operations.at(-1)),
      complete(requestKey, replacement) {
        const current = operations.at(-1);
        if (!current || current.requestKey !== requestKey) return false;
        operations.pop();
        const oldId = (current.after || current.before)?.id;
        if (replacement) {
          for (const operation of operations) {
            for (const key of ['before', 'after']) {
              if (String(operation[key]?.id) === String(oldId)) {
                operation[key].id = replacement.id;
                operation[key].revision = replacement.revision;
              }
            }
          }
        }
        return true;
      },
      clear() {
        operations.length = 0;
        confirmed.clear();
      },
    };
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
      editing: false,
      color: 'yellow',
      colors: { highlight: 'yellow', underline: 'blue' },
      composeMode: 'comment',
      popoverEntry: null,
      popoverTarget: null,
      popoverReturnTarget: null,
      pending: null,
      undo: createUndoHistory(),
      version: 0,
      callback: {},
      saveDraft: null,
      annotationRecordsLoaded: false,
      nextCursor: null,
    };
    let locationRequest = 0;
    const annotationScope = () =>
      JSON.stringify([
        state.uid,
        state.token,
        state.course?.slug,
        state.node?.id,
        state.node?.documentVersion,
        ...(state.node?.originDocumentVersion ? [state.node.originDocumentVersion] : []),
      ]);
    // Only the toolbar belongs in the reader. Notes and their editor are layers,
    // never an expanding second copy of the reading surface.
    const inlineHost = byId('learning-reading-notes-host');
    const notesPanel = page.querySelector('[data-learning-panel="notes"]');
    if (notesPanel) notesPanel.hidden = true;
    const annotationToolbar = byId('learning-annotation-toolbar');
    const reading = byId('knowledge-reading');
    const directory = byId('learning-annotation-directory');
    const annotationStatus = byId('learning-annotation-status');
    const commentField = byId('learning-annotation-comment')?.closest?.('label');
    const popover = byId('learning-annotation-popover');
    if (popover) document.body.append(popover);
    if (directory) document.body.append(directory);
    if (reading && annotationToolbar) {
      reading.insertBefore(annotationToolbar, inlineHost || byId('knowledge-body'));
    }
    if (annotationStatus && popover) popover.append(annotationStatus);
    if (commentField) commentField.hidden = true;
    const selectionLabel = document.createElement('span');
    selectionLabel.id = 'learning-annotation-selection';
    selectionLabel.className = 'learning-annotation-selection';
    selectionLabel.hidden = true;
    annotationToolbar?.append(selectionLabel);
    annotationToolbar?.setAttribute('aria-describedby', selectionLabel.id);
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
    directory?.append(pagingCount, moreAnnotations);
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
      if (element) {
        element.textContent = value || '原文评注仅本人可见。';
        element.title = element.textContent;
      }
    };
    const sectionOf = (container) =>
      container?.id === 'knowledge-history-prose' ? 'origin' : 'body';
    const sectionVersion = (section) =>
      section === 'origin' ? state.node?.originDocumentVersion : state.node?.documentVersion;
    const sectionContainer = (section) =>
      byId(section === 'origin' ? 'knowledge-history-prose' : 'knowledge-body');
    const annotationContainers = () =>
      [byId('knowledge-body'), byId('knowledge-history-prose')].filter(Boolean);
    function preserveReadingPosition(change) {
      const original = byId('knowledge-body');
      const top = original?.getBoundingClientRect?.().top;
      let scroller = original?.parentElement;
      while (scroller) {
        const overflow = root.getComputedStyle?.(scroller).overflowY || '';
        if (/(auto|scroll|overlay)/.test(overflow) && scroller.scrollHeight > scroller.clientHeight)
          break;
        scroller = scroller.parentElement;
      }
      scroller ||= root;
      change();
      if (!Number.isFinite(top)) return;
      const restore = () => {
        const delta = original.getBoundingClientRect().top - top;
        if (Math.abs(delta) > 1) scroller.scrollBy?.({ top: delta, behavior: 'instant' });
      };
      if (root.requestAnimationFrame) root.requestAnimationFrame(restore);
      else restore();
    }
    function syncToolbarOffset() {
      const history = byId('knowledge-history');
      const height = history?.getBoundingClientRect?.().height || 0;
      annotationToolbar?.style?.setProperty('--annotation-origin-height', `${height}px`);
    }
    function showToolbar() {
      const toolbar = byId('learning-annotation-toolbar');
      if (!toolbar) return;
      toolbar.hidden = !state.editing;
      toolbar.classList.toggle('hidden', !state.editing);
      toolbar.dataset.hasSelection = String(Boolean(state.selection));
      for (const button of toolbar.querySelectorAll('[data-annotation-action]')) {
        const action = button.dataset.annotationAction;
        button.disabled =
          Boolean(state.pending) || (action === 'undo' ? !state.undo.peek() : !state.selection);
      }
      for (const button of toolbar.querySelectorAll('[data-annotation-menu]')) {
        const action = button.dataset.annotationMenu;
        button.style.setProperty(
          '--annotation-tool-color',
          {
            yellow: '#f9e4a7',
            green: '#c5e4cd',
            blue: '#c8e3f2',
            purple: '#ded0ef',
          }[state.colors[action]],
        );
      }
      for (const preview of toolbar.querySelectorAll('[data-annotation-color-preview]')) {
        preview.style.setProperty(
          '--annotation-tool-color',
          {
            yellow: '#f9e4a7',
            green: '#c5e4cd',
            blue: '#c8e3f2',
            purple: '#ded0ef',
          }[state.colors[preview.dataset.annotationColorPreview]],
        );
      }
      for (const button of toolbar.querySelectorAll('[data-annotation-palette]')) {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.annotationColor === state.colors[button.dataset.annotationPalette]),
        );
      }
      const toggle = byId('learning-annotation-toggle');
      toggle?.setAttribute('aria-pressed', String(state.editing));
      for (const button of page.querySelectorAll(
        '.knowledge-reading-actions [data-learning-go="notes"]',
      )) {
        button.setAttribute('aria-pressed', String(state.editing));
        button.title = state.editing ? '收起批注工具' : '打开批注工具';
      }
      selectionLabel.textContent = state.selection
        ? `已选原文：${state.selection.quote.slice(0, 80)}${state.selection.quote.length > 80 ? '…' : ''}`
        : '选择正文文字，或点击公式、图片、表格，再使用批注工具。';
      syncToolbarOffset();
    }
    function positionPopover(target = state.popoverTarget) {
      if (!popover || popover.hidden) return;
      const viewport = root.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0;
      const topEdge = viewport?.offsetTop || 0;
      const width = viewport?.width || root.innerWidth;
      const height = viewport?.height || root.innerHeight;
      const rect =
        (target?.isConnected !== false && target?.getBoundingClientRect?.()) ||
        annotationToolbar?.getBoundingClientRect?.();
      const box = popover.getBoundingClientRect();
      const x = Math.max(
        leftEdge + 12,
        Math.min(rect?.left || leftEdge + 12, leftEdge + width - box.width - 12),
      );
      const below = (rect?.bottom || topEdge + 48) + 8;
      const y =
        below + box.height <= topEdge + height - 12 ? below : (rect?.top || below) - box.height - 8;
      popover.style.left = `${x}px`;
      popover.style.top = `${Math.max(topEdge + 12, Math.min(y, topEdge + height - box.height - 12))}px`;
    }
    function focusAnnotationTarget(target, fallback = false) {
      const action = state.composeMode === 'correction' ? 'correction' : 'comment';
      const candidates = [target];
      if (fallback) {
        candidates.push(
          annotationToolbar?.querySelector?.(`[data-annotation-action="${action}"]`),
          page.querySelector?.('.knowledge-reading-actions [data-learning-go="notes"]'),
        );
      }
      for (const candidate of candidates) {
        if (
          !candidate?.focus ||
          candidate.isConnected === false ||
          candidate.disabled ||
          candidate.hidden ||
          candidate.closest?.('[hidden],.hidden')
        )
          continue;
        const css = root.getComputedStyle?.(candidate);
        if (css?.display === 'none' || css?.visibility === 'hidden') continue;
        const rect = candidate.getBoundingClientRect?.();
        const viewport = root.visualViewport;
        const top = viewport?.offsetTop || 0;
        const left = viewport?.offsetLeft || 0;
        const height = viewport?.height || root.innerHeight;
        const width = viewport?.width || root.innerWidth;
        if (
          rect &&
          (rect.width <= 0 ||
            rect.height <= 0 ||
            rect.bottom <= top ||
            rect.top >= top + height ||
            rect.right <= left ||
            rect.left >= left + width)
        )
          continue;
        candidate.focus({ preventScroll: true });
        if (!document.activeElement || document.activeElement === candidate) return candidate;
      }
      return null;
    }
    function closePopover({ discard = false, focus = false } = {}) {
      const target = state.popoverReturnTarget || state.popoverTarget;
      if (popover) popover.hidden = true;
      if (commentField) commentField.hidden = true;
      if (discard) {
        const comment = byId('learning-annotation-comment');
        if (comment) comment.value = '';
        state.saveDraft = null;
        state.selectedEntry = null;
      }
      if (focus) focusAnnotationTarget(target, true);
    }
    function showPopover(mode, target = state.popoverTarget) {
      if (!popover) return;
      state.popoverTarget = target || annotationToolbar;
      popover.hidden = false;
      popover.dataset.mode = mode;
      const editing = mode === 'edit';
      if (commentField) commentField.hidden = !editing;
      const title = byId('learning-annotation-popover-title');
      if (title)
        title.textContent = editing
          ? state.composeMode === 'correction'
            ? '纠错便签'
            : '批注'
          : state.popoverEntry?.title || '批注';
      const quote = byId('learning-annotation-popover-quote');
      if (quote) quote.textContent = state.selection?.quote || '';
      const content = byId('learning-annotation-popover-content');
      if (content) {
        content.textContent = state.popoverEntry?.content || '';
        content.hidden = editing;
      }
      const info = byId('learning-annotation-popover-info');
      if (info)
        info.textContent =
          state.composeMode === 'correction' ? '仅本人可见，提交课程组须另行确认。' : '仅本人可见';
      for (const button of popover.querySelectorAll(
        '[data-annotation-action],[data-annotation-ui="edit"]',
      )) {
        const action = button.dataset.annotationAction;
        button.hidden =
          action === 'comment-save'
            ? !editing
            : action === 'remove' || button.dataset.annotationUi === 'edit'
              ? editing || !state.popoverEntry
              : action === 'share-correction'
                ? editing || state.popoverEntry?.title !== '原文纠错'
                : false;
        button.disabled = Boolean(state.pending);
      }
      positionPopover();
      if (root.requestAnimationFrame) root.requestAnimationFrame(() => positionPopover());
    }
    function openComment() {
      locationRequest += 1;
      if (directory?.open) directory.close?.();
      showPopover('edit');
      byId('learning-annotation-comment')?.focus({ preventScroll: true });
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
          'learning-annotation-correction',
          ...COLORS.map((color) => `learning-underline-${color}`),
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
      if (!container || container.hasAttribute?.('data-learning-document-empty')) return [];
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
      const values = [...elements, ...atomic].map((element) => {
        const type = typeOf(element);
        const images = type === 'image' ? [...element.querySelectorAll('img')] : [];
        if (type === 'image' && element.matches('img')) images.unshift(element);
        const imageSources = images.map((image) => [
          image.getAttribute('src') || '',
          image.getAttribute('srcset') || '',
        ]);
        return {
          element,
          type,
          text:
            element.textContent ||
            element.querySelector('img')?.alt ||
            element.getAttribute('alt') ||
            '[图片]',
          ...(imageSources.some(([src, srcset]) => src || srcset)
            ? { imageSource: JSON.stringify(imageSources) }
            : {}),
        };
      });
      const blocks = stableBlocks(values);
      if (sectionOf(container) === 'origin')
        blocks.forEach((block) => {
          block.section = 'origin';
        });
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
        ...(sectionOf(container) === 'origin' ? { section: 'origin' } : {}),
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
          if (annotation.style === 'underline')
            mark.classList.add(`learning-underline-${annotation.color}`);
          if (entry.title === '原文纠错') mark.classList.add('learning-annotation-correction');
        }
        mark.title = annotations.map((entry) => entry.content).join('\n');
        mark.setAttribute('role', 'button');
        mark.setAttribute('tabindex', '0');
        mark.setAttribute(
          'aria-label',
          `查看批注：${annotations.map((entry) => entry.title || '批注').join('、')}`,
        );
        chosen.before(mark);
        mark.append(chosen);
      }
    }
    function renderContainer(container, records) {
      strip(container);
      const blocks = blocksFor(container);
      const located = records.map((entry) => ({
        entry,
        location: locateAnchor(
          entry.annotation.anchor,
          blocks,
          sectionVersion(sectionOf(container)),
        ),
      }));
      const ranges = new Map();
      for (const { entry, location } of located) {
        if (location.status === 'pending') continue;
        const { block } = location;
        if (entry.annotation.anchor.wholeBlock) {
          const element = block.element;
          element.dataset.privateAnnotationBlock = [
            element.dataset.privateAnnotationBlock,
            entry.id,
          ]
            .filter(Boolean)
            .join(',');
          element.classList.add(
            'learning-annotation-block',
            `learning-annotation-${entry.annotation.style}`,
          );
          if (entry.annotation.style === 'highlight')
            element.classList.add(`learning-highlight-${entry.annotation.color}`);
          if (entry.annotation.style === 'underline')
            element.classList.add(`learning-underline-${entry.annotation.color}`);
          if (entry.title === '原文纠错') element.classList.add('learning-annotation-correction');
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
    function recordContext() {
      return {
        uid: state.uid,
        token: state.token,
        version: state.version,
        course: state.course?.slug,
        node: state.node?.id,
        documentVersion: state.node?.documentVersion,
        originDocumentVersion: state.node?.originDocumentVersion,
      };
    }
    function currentRecordContext(context, card) {
      return (
        app?.userState?.isLoggedIn &&
        Boolean(context.token) &&
        context.uid === app.userState.uid &&
        context.token === app.userState.token &&
        JSON.stringify(context) === JSON.stringify(recordContext()) &&
        card?.isConnected !== false
      );
    }
    function commentIsDirty(value) {
      const draft = state.saveDraft;
      if (popover && popover.dataset.mode !== 'edit' && !draft) return false;
      return (
        (state.selectedEntry ? value !== (state.selectedEntry.content || '') : Boolean(value)) ||
        Boolean(
          draft &&
          typeof draft.editorSnapshot === 'string' &&
          draft.editorSnapshot !== editorSnapshot(draft.style),
        )
      );
    }
    function editRecord(entry, context, card, pending = false) {
      if (!currentRecordContext(context, card)) return;
      const comment = byId('learning-annotation-comment');
      const value = comment?.value || '';
      const same = String(state.selectedEntry?.id) === String(entry.id);
      const dirty = commentIsDirty(value);
      if (!same && dirty) {
        openComment();
        message('当前评注还有未保存文字，已保留原稿；请先保存后再编辑另一条。');
        return;
      }
      // A detail view has an empty hidden editor; entering edit must prefill it.
      // Reopening an already active editor, however, must preserve its live draft.
      if (!same || (popover && popover.dataset.mode !== 'edit')) {
        state.selection = entry.annotation.anchor;
        state.selectedEntry = entry;
        state.color = entry.annotation.color;
        if (comment) comment.value = entry.content;
      }
      state.editing = true;
      state.popoverEntry = entry;
      state.popoverTarget = card;
      state.composeMode = entry.title === '原文纠错' ? 'correction' : 'comment';
      page
        .querySelectorAll('[data-annotation-color]')
        .forEach((button) =>
          button.setAttribute(
            'aria-pressed',
            String(button.dataset.annotationColor === state.color),
          ),
        );
      showToolbar();
      openComment();
      message(pending ? '此评注尚未定位，可保留文字或重新选择原文。' : '已选择已有评注。');
    }
    function viewRecords(records, target) {
      const entry = records[0];
      if (!entry || !currentRecordContext(recordContext(), target)) return;
      const comment = byId('learning-annotation-comment');
      if (commentIsDirty(comment?.value || '')) {
        openComment();
        message('当前批注尚未保存，已保留；请先保存或取消。');
        return;
      }
      if (comment) comment.value = '';
      state.selectedEntry = entry;
      state.popoverEntry = entry;
      state.selection = entry.annotation.anchor;
      state.composeMode = entry.title === '原文纠错' ? 'correction' : 'comment';
      state.color = entry.annotation.color;
      state.popoverReturnTarget = target;
      const content = byId('learning-annotation-popover-content');
      showToolbar();
      showPopover('view', target);
      if (records.length > 1 && content) {
        const options = document.createElement('div');
        options.className = 'learning-annotation-overlap-options';
        records.forEach((record, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `${index + 1} · ${record.title || '批注'}`;
          button.setAttribute('aria-pressed', String(record.id === entry.id));
          button.addEventListener('click', () =>
            viewRecords([record, ...records.filter((item) => item.id !== record.id)], target),
          );
          options.append(button);
        });
        content.append(options);
      }
    }
    function quoteRect(location, wholeBlock) {
      const element = location.block.element;
      if (wholeBlock) return element.getBoundingClientRect();
      const range = document.createRange();
      let position = 0;
      let start;
      let end;
      for (const node of textNodes(element)) {
        const next = position + node.data.length;
        if (!start && location.start >= position && location.start < next)
          start = { node, offset: location.start - position };
        if (!end && location.end > position && location.end <= next)
          end = { node, offset: location.end - position };
        position = next;
      }
      if (!start || !end) return element.getBoundingClientRect();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return (
        [...range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0) ||
        element.getBoundingClientRect()
      );
    }
    function locateRecord(entry, context, card, pending) {
      if (!currentRecordContext(context, card)) return;
      if (pending) {
        message('此评注尚未定位，原有文字已保留。');
        return;
      }
      const section = entry.annotation.anchor.section || 'body';
      const original = sectionContainer(section);
      if (!original || original.isConnected === false) return;
      locationRequest += 1;
      const request = locationRequest;
      const selection = state.selection;
      const selectedEntry = state.selectedEntry;
      const draft = state.saveDraft;
      const commentValue = byId('learning-annotation-comment')?.value || '';
      const dirty = commentIsDirty(commentValue);
      // Reading navigation does not select a different edit target or discard a draft.
      if (directory?.open) directory.close?.();
      closePopover();
      if (commentField) commentField.hidden = true;
      byId('knowledge-reading')?.focus({ preventScroll: true });
      const current = () =>
        request === locationRequest &&
        currentRecordContext(context, card) &&
        original === sectionContainer(section) &&
        original.isConnected !== false &&
        !original.closest('[hidden],.hidden') &&
        selection === state.selection &&
        selectedEntry === state.selectedEntry &&
        draft === state.saveDraft &&
        commentValue === (byId('learning-annotation-comment')?.value || '');
      const locate = () => {
        if (!current()) return;
        const location = locateAnchor(
          entry.annotation.anchor,
          blocksFor(original),
          sectionVersion(section),
        );
        if (
          location.status === 'pending' ||
          location.block.element.isConnected === false ||
          !original.contains(location.block.element)
        ) {
          message('原文已变化，暂不能定位；原有评注与草稿已保留。');
          return;
        }
        let host = root.FreeBbsLearningReader?.getScrollHost?.();
        if (!host) {
          host = original.parentElement;
          while (host) {
            const overflow = root.getComputedStyle(host).overflowY;
            if (/(auto|scroll|overlay)/.test(overflow) && host.scrollHeight > host.clientHeight)
              break;
            host = host.parentElement;
          }
          host ||= root;
        }
        const rect = quoteRect(location, entry.annotation.anchor.wholeBlock);
        const viewport = root.visualViewport;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportBottom = Math.min(
          root.innerHeight,
          viewportTop + (viewport?.height || root.innerHeight),
        );
        const hostRect = host === root ? null : host.getBoundingClientRect();
        let top = Math.max(viewportTop, hostRect?.top || 0) + 8;
        let bottom = Math.min(viewportBottom, hostRect?.bottom || viewportBottom) - 8;
        for (const surface of [byId('knowledge-history'), annotationToolbar]) {
          if (!surface || surface.hidden || surface.classList.contains('hidden')) continue;
          const css = root.getComputedStyle(surface);
          const box = surface.getBoundingClientRect();
          if (
            !['sticky', 'fixed'].includes(css.position) ||
            css.display === 'none' ||
            css.visibility === 'hidden' ||
            box.height <= 0
          )
            continue;
          const surfaceTop =
            css.position === 'sticky'
              ? Math.max(viewportTop, (hostRect?.top || 0) + (Number.parseFloat(css.top) || 0))
              : box.top;
          top = Math.max(top, surfaceTop + box.height + 8);
        }
        for (const chrome of document.querySelectorAll(
          '.mobile-nav,.mobile-header-backdrop,.topbar',
        )) {
          const css = root.getComputedStyle(chrome);
          const box = chrome.getBoundingClientRect();
          if (
            !['sticky', 'fixed'].includes(css.position) ||
            css.display === 'none' ||
            css.visibility === 'hidden' ||
            box.height <= 0 ||
            box.top >= viewportBottom ||
            box.bottom <= viewportTop ||
            box.right <= rect.left ||
            box.left >= rect.right
          )
            continue;
          if (chrome.matches('.mobile-nav')) bottom = Math.min(bottom, box.top - 8);
          else top = Math.max(top, box.bottom + 8);
        }
        if (bottom <= top || !current()) {
          if (current()) message('当前窗口没有可阅读空间，请调整窗口或收起起源后再定位。');
          return;
        }
        const desired = top + Math.max(0, (bottom - top - rect.height) / 2);
        host.scrollBy({ top: rect.top - desired, behavior: 'instant' });
        const target = location.block.element;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        message(dirty ? '已定位原文，未保存的评注草稿仍保留。' : '已定位原文。');
      };
      // Let the two popovers close and sticky selection geometry update first.
      if (root.requestAnimationFrame)
        root.requestAnimationFrame(() => {
          if (current()) root.requestAnimationFrame(locate);
        });
      else locate();
    }
    function renderList(located) {
      const list = byId('learning-annotation-list');
      if (!list) return;
      list.replaceChildren();
      const context = recordContext();
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
        const locate = document.createElement('button');
        locate.type = 'button';
        locate.dataset.annotationLocate = '';
        locate.textContent = '定位原文';
        locate.disabled = location.status === 'pending';
        if (locate.disabled) locate.title = '原文已变化或位置不唯一；评注文字仍保留，可编辑。';
        locate.addEventListener('click', () => locateRecord(entry, context, card, locate.disabled));
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.dataset.annotationEdit = '';
        edit.textContent = '编辑评注';
        edit.addEventListener('click', () =>
          editRecord(entry, context, card, location.status === 'pending'),
        );
        card.append(quote, content, status, locate, edit);
        list.append(card);
      }
      if (!located.length) {
        const empty = document.createElement('p');
        empty.textContent = '选择原文中的文字，留下只对自己可见的高亮、下划线或评注。';
        list.append(empty);
      }
    }
    function refresh() {
      const entries = privateAnnotations(state.entries).filter(
        (entry) => entry.annotation.anchor.nodeId === state.node?.id,
      );
      const locations = annotationContainers().flatMap((container) =>
        renderContainer(
          container,
          entries.filter(
            (entry) => (entry.annotation.anchor.section || 'body') === sectionOf(container),
          ),
        ),
      );
      const renderedIds = new Set(locations.map(({ entry }) => entry.id));
      for (const entry of entries) {
        if (!renderedIds.has(entry.id))
          locations.push({
            entry,
            location: { status: 'pending', reason: '对应资料暂未提供，批注仍保留。' },
          });
      }
      renderList(locations);
      updatePaging();
    }
    function captureSelection(event) {
      if (
        event?.target?.closest?.(
          '#learning-annotation-toolbar,#learning-annotation-popover,input,textarea,select,[contenteditable]',
        )
      )
        return;
      const selection = root.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) {
        const originals = annotationContainers();
        // A mark click is edited by the click handler below. Its earlier collapsed
        // mouseup must not erase the same record/draft before that guarded handler.
        if (
          event?.type === 'mouseup' &&
          event.target?.closest?.('[data-private-annotation],[data-private-annotation-block]') &&
          originals.some((original) => original.contains(event.target))
        )
          return;
        // Focusing an annotation control must retain its original quote. A genuine
        // mouse/key cancellation inside the prose, however, must not leave an old
        // range (or an existing record ID) available to the next save action.
        if (
          state.selection &&
          originals.some(
            (original) =>
              original.contains(event?.target) || original.contains(selection?.anchorNode),
          )
        ) {
          if (commentIsDirty(byId('learning-annotation-comment')?.value || '')) {
            message('当前批注尚未保存，已保留原文选区；请先保存或取消。');
            return;
          }
          state.selection = null;
          state.selectedEntry = null;
          state.saveDraft = null;
          closePopover();
          preserveReadingPosition(showToolbar);
          message('选区已取消，请重新选择原文。');
        }
        return;
      }
      const range = selection.getRangeAt(0);
      const container = annotationContainers().find(
        (element) =>
          element?.contains(range.startContainer) && element.contains(range.endContainer),
      );
      if (!state.editing) return;
      if (!container) {
        if (commentIsDirty(byId('learning-annotation-comment')?.value || '')) return;
        state.selection = null;
        state.selectedEntry = null;
        state.saveDraft = null;
        closePopover();
        preserveReadingPosition(showToolbar);
        message('请在正文或知识起源中分别选择内容。');
        return;
      }
      if (container.closest('[hidden],.hidden')) return;
      if (commentIsDirty(byId('learning-annotation-comment')?.value || '')) {
        message('当前批注尚未保存，请先保存或取消。');
        return;
      }
      if (container.hasAttribute('data-learning-document-empty')) {
        state.selection = null;
        state.selectedEntry = null;
        state.popoverEntry = null;
        closePopover();
        state.saveDraft = null;
        preserveReadingPosition(showToolbar);
        message('正文暂未提供，可以先记录普通笔记。');
        return;
      }
      if (!app?.userState?.isLoggedIn || !app.userState.token) {
        message('登录后可保存只对自己可见的原文评注。');
        return;
      }
      const section = sectionOf(container);
      const documentVersion = sectionVersion(section);
      if (!documentVersion) {
        message('资料版本尚未就绪，请刷新后再标注。');
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
      if (!block) return;
      try {
        const wholeBlock = block.type !== 'text';
        state.selection = createAnchor({
          nodeId: state.node.id,
          documentVersion,
          section,
          block,
          start: offsetOf(block.element, range.startContainer, range.startOffset),
          end: offsetOf(block.element, range.endContainer, range.endOffset),
          wholeBlock,
        });
        state.selectedEntry = null;
        preserveReadingPosition(showToolbar);
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
      const container = annotationContainers().find((element) => element.contains(atomic));
      if (
        !container ||
        !state.editing ||
        !app?.userState?.isLoggedIn ||
        !app.userState.token ||
        !sectionVersion(sectionOf(container)) ||
        container?.hasAttribute('data-learning-document-empty')
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
          documentVersion: sectionVersion(sectionOf(container)),
          section: sectionOf(container),
          block,
          start: 0,
          end: block.text.length,
          wholeBlock: true,
        });
        state.selectedEntry = null;
        preserveReadingPosition(showToolbar);
        message('公式、图片和表格按完整块标注。');
      } catch (error) {
        message(error.message);
      }
    }
    function dispatch(name, detail) {
      page.dispatchEvent(new root.CustomEvent(name, { detail, bubbles: true }));
    }
    function closePalettes({ focus = false, type = null } = {}) {
      let target;
      for (const button of annotationToolbar?.querySelectorAll('[data-annotation-menu]') || []) {
        const palette = byId(button.getAttribute('aria-controls'));
        if (
          (type && button.dataset.annotationMenu === type) ||
          (!type && palette && !palette.hidden && palette.contains?.(document.activeElement))
        )
          target = button;
        button.setAttribute('aria-expanded', 'false');
        if (palette) palette.hidden = true;
      }
      if (focus) focusAnnotationTarget(target);
    }
    function positionPalette(palette, button) {
      if (!palette || palette.hidden) return;
      const { style } = palette;
      // Restore the authored below-button position before each measurement;
      // otherwise a previously flipped menu would drift on the next opening.
      style.left = '';
      style.top = '';
      const box = palette.getBoundingClientRect();
      const anchor = button.getBoundingClientRect();
      const viewport = root.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const width = viewport?.width || root.innerWidth;
      const height = viewport?.height || root.innerHeight;
      const x = Math.max(left + 8, Math.min(box.left, left + width - box.width - 8));
      const preferredY = box.bottom > top + height - 8 ? anchor.top - box.height - 8 : box.top;
      const y = Math.max(top + 8, Math.min(preferredY, top + height - box.height - 8));
      // The menu stays in its own split control rather than entering document
      // flow or creating another panel. Offsets preserve the actual containing
      // block, including a sticky reader and visual viewport displacement.
      style.left = `${(palette.offsetLeft || 0) + x - box.left}px`;
      style.top = `${(palette.offsetTop || 0) + y - box.top}px`;
    }
    function handleControls(event) {
      const button = event.target.closest('button');
      if (!button || button.disabled) return;
      const menu = button.dataset.annotationMenu;
      if (menu) {
        const palette = byId(button.getAttribute('aria-controls'));
        const open = palette?.hidden;
        closePalettes();
        if (palette) palette.hidden = !open;
        button.setAttribute('aria-expanded', String(Boolean(open)));
        if (open) positionPalette(palette, button);
        if (open && event.detail === 0) {
          focusAnnotationTarget(
            palette?.querySelector('[aria-pressed="true"]') || palette?.querySelector('button'),
          );
        }
        return;
      }
      const color = button.dataset.annotationColor;
      const type = button.dataset.annotationPalette;
      if (COLORS.includes(color) && ['highlight', 'underline'].includes(type)) {
        state.colors[type] = color;
        annotationToolbar
          .querySelectorAll(`[data-annotation-palette="${type}"]`)
          .forEach((item) =>
            item.setAttribute('aria-pressed', String(item.dataset.annotationColor === color)),
          );
        const preview = annotationToolbar.querySelector(
          `[data-annotation-color-preview="${type}"]`,
        );
        preview?.style.setProperty(
          '--annotation-tool-color',
          { yellow: '#f9e4a7', green: '#c5e4cd', blue: '#c8e3f2', purple: '#ded0ef' }[color],
        );
        closePalettes({ focus: true, type });
        showToolbar();
        return;
      }
      const ui = button.dataset.annotationUi;
      if (ui === 'dismiss') {
        locationRequest += 1;
        closePopover({ focus: true });
      }
      if (ui === 'close') {
        locationRequest += 1;
        closePopover({ discard: true, focus: true });
      }
      if (ui === 'edit' && state.popoverEntry)
        editRecord(state.popoverEntry, recordContext(), state.popoverTarget || button);
      if (ui === 'close-directory') directory?.close?.();
      if (button.id === 'learning-reader-overview') byId('knowledge-return-overview')?.click();
      const action = button.dataset.annotationAction;
      if (action) {
        if (
          ['comment', 'correction'].includes(action) &&
          button.closest?.('#learning-annotation-toolbar')
        )
          state.popoverReturnTarget = button;
        closePalettes();
        act(action);
      }
    }
    popover?.addEventListener('click', handleControls);
    popover?.addEventListener('mousedown', (event) => {
      if (event.target.closest('button')) event.preventDefault();
    });
    directory?.addEventListener('click', handleControls);
    const shareCorrection = document.createElement('button');
    shareCorrection.type = 'button';
    shareCorrection.dataset.annotationAction = 'share-correction';
    shareCorrection.textContent = '提交课程组';
    shareCorrection.hidden = true;
    byId('learning-annotation-popover-actions')?.append(shareCorrection);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const menu = [
          ...(annotationToolbar?.querySelectorAll('[data-annotation-menu]') || []),
        ].find((button) => {
          const palette = byId(button.getAttribute('aria-controls'));
          return palette && !palette.hidden;
        });
        if (menu) {
          closePalettes({ focus: true, type: menu.dataset.annotationMenu });
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (popover && !popover.hidden) {
          locationRequest += 1;
          closePopover({ focus: true });
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      const marked = event.target.closest?.(
        '[data-private-annotation],[data-private-annotation-block]',
      );
      if (marked && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        const ids = (
          marked.dataset.privateAnnotation || marked.dataset.privateAnnotationBlock
        ).split(',');
        viewRecords(
          privateAnnotations(state.entries).filter((entry) => ids.includes(String(entry.id))),
          marked,
        );
      }
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest?.('#learning-annotation-toolbar')) closePalettes();
    });
    function editorSnapshot(style) {
      return JSON.stringify([
        style,
        state.color,
        state.selection,
        byId('learning-annotation-comment')?.value || '',
        state.selectedEntry?.id,
        state.selectedEntry?.revision,
        state.node?.id,
        state.node?.documentVersion,
        state.node?.originDocumentVersion,
      ]);
    }
    function act(action) {
      if (state.pending) return;
      if (action === 'undo') {
        const operation = state.undo.peek();
        if (!operation) return;
        if (commentIsDirty(byId('learning-annotation-comment')?.value || '')) {
          openComment();
          message('请先保存或取消当前批注，再撤销。');
          return;
        }
        state.pending = { type: 'undo', requestKey: operation.requestKey };
        showToolbar();
        dispatch('knowledge:annotation-undo', { operation });
        return;
      }
      if (
        action !== 'remove' &&
        sectionContainer(state.selection?.section)?.hasAttribute('data-learning-document-empty')
      ) {
        message('正文暂未提供，可以先记录普通笔记。');
        return;
      }
      if (!state.selection) {
        message('请先选择原文或一条已有评注。');
        return;
      }
      const annotation = {
        style: ['highlight', 'underline', 'comment'].includes(action) ? action : 'comment',
        color: state.color,
        anchor: state.selection,
      };
      if (['highlight', 'underline'].includes(action)) {
        annotation.color = state.colors[action];
        state.color = annotation.color;
      }
      if (action === 'ask') {
        const detail = {
          annotation,
          source: state.selection.section === 'origin' ? 'origin' : 'annotation',
          prompt: `关于这段原文「${state.selection.quote}」，我的问题是：`,
        };
        if (state.callback.onAsk) state.callback.onAsk(detail);
        else dispatch('knowledge:annotation-ask', detail);
        return;
      }
      if (action === 'share-correction') {
        const section = annotation.anchor.section || 'body';
        if (annotation.anchor.documentVersion !== sectionVersion(section)) {
          const location = locateAnchor(
            annotation.anchor,
            blocksFor(sectionContainer(section)),
            sectionVersion(section),
          );
          if (location.status === 'pending') {
            message('请先重新选择当前原文，再提交这条纠错；原有评注已保留。');
            return;
          }
          annotation.anchor = createAnchor({
            nodeId: state.node.id,
            documentVersion: sectionVersion(section),
            section,
            block: location.block,
            start: location.start,
            end: location.end,
            wholeBlock: annotation.anchor.wholeBlock,
          });
        }
        const detail = {
          annotation,
          excerpt: correctionExcerpt(annotation.anchor),
          content: state.popoverEntry?.content || '',
        };
        if (state.callback.onCorrection) state.callback.onCorrection(detail);
        else dispatch('knowledge:annotation-correction', detail);
        return;
      }
      if (action === 'remove') {
        if (!state.selectedEntry) {
          message('请先点击要删除的标记。');
          return;
        }
        if (
          state.selectedEntry.annotation.anchor.documentVersion !==
            sectionVersion(state.selectedEntry.annotation.anchor.section) &&
          !root.confirm('这条批注属于旧资料版本，删除后不能自动撤销。确定删除吗？')
        )
          return;
        const requestKey = root.crypto.randomUUID();
        state.pending = { type: 'remove', requestKey };
        dispatch('knowledge:annotation-remove', {
          entry: state.selectedEntry,
          requestKey,
          scope: annotationScope(),
        });
        showToolbar();
        return;
      }
      if (action === 'comment' || action === 'correction') {
        state.composeMode = action;
        if (
          state.selectedEntry &&
          !commentIsDirty(byId('learning-annotation-comment')?.value || '')
        )
          byId('learning-annotation-comment').value = state.selectedEntry.content;
        openComment();
        return;
      }
      if (action === 'comment-save') {
        annotation.style =
          state.composeMode === 'correction'
            ? 'comment'
            : state.selectedEntry?.annotation.style || 'comment';
      }
      const comment = byId('learning-annotation-comment')?.value.trim() || '';
      if (action === 'comment-save' && !comment) {
        message('写下评注后再保存。');
        openComment();
        return;
      }
      const content = comment || { highlight: '原文高亮', underline: '原文下划线' }[action];
      const detail = {
        annotation,
        content,
        title:
          action === 'comment-save'
            ? state.composeMode === 'correction'
              ? '原文纠错'
              : state.selectedEntry?.title || '原文评注'
            : content,
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
      state.saveDraft.style = annotation.style;
      state.saveDraft.editorSnapshot = editorSnapshot(annotation.style);
      detail.requestKey = state.saveDraft.key;
      detail.signature = signature;
      detail.scope = annotationScope();
      state.pending = { type: 'save', requestKey: detail.requestKey };
      showToolbar();
      if (popover && !popover.hidden) showPopover('edit');
      // Saving is handled by the workspace, which preserves drafts on network/revision failure.
      dispatch('knowledge:annotation-save', detail);
    }
    const attach = (options = {}) => {
      if (
        state.node &&
        ((options.course && options.course.slug !== state.course?.slug) ||
          (options.node &&
            (options.node.id !== state.node.id ||
              options.node.documentVersion !== state.node.documentVersion ||
              options.node.originDocumentVersion !== state.node.originDocumentVersion)))
      ) {
        state.version += 1;
        state.undo.clear();
        state.selection = null;
        state.selectedEntry = null;
        state.saveDraft = null;
        state.pending = null;
        closePopover({ discard: true });
        state.popoverReturnTarget = null;
      }
      if (options.course) state.course = options.course;
      if (options.node) state.node = options.node;
      if (Array.isArray(options.entries)) state.entries = options.entries;
      for (const name of ['onSaved', 'onCorrection', 'onAsk'])
        if (options[name]) state.callback[name] = options[name];
      refresh();
      showToolbar();
      return { refresh, setEditing };
    };
    const setEditing = (enabled) => {
      state.editing = Boolean(enabled);
      if (!state.editing) {
        locationRequest += 1;
        closePopover();
        closePalettes();
      }
      showToolbar();
      annotationContainers().forEach((original) => {
        original.dataset.annotationEditing = String(state.editing);
      });
    };
    page.addEventListener('click', (event) => {
      const marked = event.target.closest(
        '[data-private-annotation],[data-private-annotation-block]',
      );
      if (marked && marked.closest('#knowledge-body,#knowledge-history-prose')) {
        const ids = (
          marked.dataset.privateAnnotation || marked.dataset.privateAnnotationBlock
        ).split(',');
        const records = privateAnnotations(state.entries).filter((record) =>
          ids.includes(String(record.id)),
        );
        // A genuine drag ending on a mark remains a new text selection, not an edit click.
        if (records.length && root.getSelection?.()?.isCollapsed !== false)
          viewRecords(records, marked);
      } else captureAtomic(event.target);
      handleControls(event);
    });
    page.addEventListener('mousedown', (event) => {
      if (
        event.target.closest(
          '[data-annotation-action],[data-annotation-color],[data-annotation-menu]',
        )
      )
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
      state.undo.clear();
      state.pending = null;
      if (event.detail?.node) state.node = event.detail.node;
      showToolbar();
      root.requestAnimationFrame(() => refresh());
    });
    page.addEventListener('knowledge:annotation-toggle', (event) =>
      setEditing(event.detail?.enabled),
    );
    page.addEventListener('knowledge:annotation-saved', (event) => {
      const saved = event.detail || {};
      if (saved.scope && saved.scope !== annotationScope()) return;
      if (saved.after?.id && Number.isSafeInteger(saved.after.revision)) state.undo.push(saved);
      if (state.pending?.requestKey === saved.requestKey) state.pending = null;
      const draft = state.saveDraft;
      const unchanged =
        draft &&
        saved.requestKey === draft.key &&
        saved.signature === draft.signature &&
        draft.editorSnapshot === editorSnapshot(draft.style);
      // A slow successful save belongs to its submitted snapshot, not whatever
      // the person has since typed, selected or reopened in the live editor.
      if (!unchanged) {
        // Advance only this confirmed own update, never an arbitrary newer GET
        // record: B can be saved after A, but genuine parallel edits still conflict.
        if (
          state.selectedEntry &&
          String(state.selectedEntry.id) === String(saved.entryId) &&
          state.selectedEntry.revision === saved.previousRevision &&
          Number.isSafeInteger(saved.previousRevision) &&
          saved.previousRevision > 0 &&
          Number.isSafeInteger(saved.revision) &&
          saved.revision === saved.previousRevision + 1
        )
          state.selectedEntry = { ...state.selectedEntry, revision: saved.revision };
        message('之前的评注已保存，当前修改还未保存。');
        showToolbar();
        state.callback.onSaved?.(event.detail);
        return;
      }
      state.selection = null;
      state.selectedEntry = null;
      state.saveDraft = null;
      state.popoverEntry = null;
      const comment = byId('learning-annotation-comment');
      if (comment) comment.value = '';
      preserveReadingPosition(() => {
        showToolbar();
        if (commentField) commentField.hidden = true;
        closePopover();
      });
      message('评注已私密保存。');
      state.callback.onSaved?.(event.detail);
    });
    page.addEventListener('knowledge:annotation-removed', (event) => {
      const removed = event.detail || {};
      if (removed.scope && removed.scope !== annotationScope()) return;
      const historical =
        Boolean(removed.before?.annotation) &&
        removed.before.annotation.anchor.documentVersion !==
          sectionVersion(removed.before.annotation.anchor.section);
      if (removed.before?.annotation && !historical) state.undo.push({ ...removed, after: null });
      if (state.pending?.requestKey === removed.requestKey) state.pending = null;
      showToolbar();
      if (!state.selectedEntry || String(state.selectedEntry.id) !== String(event.detail?.entryId))
        return;
      state.selectedEntry = null;
      state.saveDraft = null;
      state.popoverEntry = null;
      // Deletion ends this selection. A fresh mark needs an explicit new selection,
      // never a PUT to the deleted ID or a silently reused historical quotation.
      state.selection = null;
      const comment = byId('learning-annotation-comment');
      if (comment) comment.value = '';
      preserveReadingPosition(() => {
        showToolbar();
        if (commentField) commentField.hidden = true;
        closePopover();
      });
      message(
        historical ? '已删除旧版批注，此操作不可自动撤销。' : '已取消标注，请重新选择当前原文。',
      );
    });
    page.addEventListener('knowledge:annotation-undo-completed', (event) => {
      if (state.pending?.requestKey !== event.detail?.requestKey) return;
      state.undo.complete(event.detail.requestKey, event.detail.after);
      state.pending = null;
      state.selection = null;
      state.selectedEntry = null;
      state.saveDraft = null;
      state.popoverEntry = null;
      const comment = byId('learning-annotation-comment');
      if (comment) comment.value = '';
      closePopover();
      showToolbar();
      message('已撤销本次批注操作。');
    });
    page.addEventListener('knowledge:annotation-error', (event) => {
      if (state.pending?.requestKey !== event.detail?.requestKey) return;
      state.pending = null;
      if (event.detail?.status === 409 && event.detail?.undo) state.undo.clear();
      showToolbar();
      if (popover && !popover.hidden) showPopover(popover.dataset.mode);
      else if (popover) showPopover('notice');
      message(event.detail.message || '操作未确认，请重试。');
    });
    page.addEventListener('knowledge:tool-select', showToolbar);
    page.addEventListener('knowledge:view-change', () => {
      if (root.requestAnimationFrame) root.requestAnimationFrame(syncToolbarOffset);
      else syncToolbarOffset();
    });
    const history = byId('knowledge-history');
    if (history && root.ResizeObserver) new root.ResizeObserver(syncToolbarOffset).observe(history);
    root.addEventListener('resize', syncToolbarOffset);
    function clearSession() {
      state.version += 1;
      state.entries = [];
      state.selection = null;
      state.selectedEntry = null;
      state.saveDraft = null;
      state.undo.clear();
      state.pending = null;
      state.popoverEntry = null;
      state.annotationRecordsLoaded = false;
      state.nextCursor = null;
      state.uid = app?.userState?.uid || '';
      state.token = app?.userState?.token || '';
      const comment = byId('learning-annotation-comment');
      if (comment) comment.value = '';
      if (directory) directory.open = false;
      state.editing = false;
      if (commentField) commentField.hidden = true;
      closePopover();
      state.popoverReturnTarget = null;
      closePalettes();
      showToolbar();
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
    showToolbar();
    message('');
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
    createUndoHistory,
    attach: (options) => getController()?.attach(options),
    refresh: (options) => getController()?.refresh(options),
    setEditing: (enabled) => getController()?.setEditing(enabled),
  };
});
