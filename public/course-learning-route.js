/* A navigable learning path, not a lock, completion inference or new curriculum. */
(function expose(root, factory) {
  const route =
    typeof module === 'object' && module.exports
      ? require('./learning-route')
      : root.FreeBbsLearningRoute;
  const api = factory(root, route);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsCourseLearningRoute = api;
})(typeof window === 'undefined' ? globalThis : window, (root, route) => {
  function focusVisibilityDelta(rect, safeTop, safeBottom) {
    if (
      !rect ||
      ![rect.top, rect.bottom, safeTop, safeBottom].every(Number.isFinite) ||
      rect.bottom < rect.top ||
      safeBottom <= safeTop
    )
      return 0;
    if (rect.bottom - rect.top > safeBottom - safeTop) {
      if (rect.top > safeTop) return rect.top - safeTop;
      if (rect.bottom < safeBottom) return rect.bottom - safeBottom;
      return 0;
    }
    if (rect.top < safeTop) return rect.top - safeTop;
    if (rect.bottom > safeBottom) return rect.bottom - safeBottom;
    return 0;
  }

  function create({
    container,
    model,
    resumeNodeId = '',
    onSelectChapter,
    onOpenNode,
    onLocate,
    getNodeTags = () => [],
  }) {
    if (!container?.ownerDocument || !route?.buildRoute) return null;
    const document = container.ownerDocument;
    const make = (tag, text, className) => {
      const element = document.createElement(tag);
      if (text !== undefined) element.textContent = text;
      if (className) element.className = className;
      return element;
    };
    const svg = (tag, attributes) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      return element;
    };
    const button = (text, action, className) => {
      const element = make('button', text, className);
      element.type = 'button';
      element.addEventListener('click', action);
      return element;
    };
    const header = make('header', undefined, 'course-route-heading');
    const heading = make('div');
    heading.append(
      make('span', '一步一步，也可以自由探索', 'course-route-kicker'),
      make('h2', '顺着学'),
    );
    const locate = button('回到上次位置', () => onLocate?.(resumeNodeId), 'course-route-locate');
    locate.hidden = !model.byId.has(resumeNodeId) || /-0+$/.test(resumeNodeId);
    header.append(heading, locate);
    const unit = make('div', undefined, 'course-route-unit');
    const chapterLabel = make('label');
    chapterLabel.append(make('span', '章节', 'course-route-kicker'));
    const chapter = make('select', undefined, 'course-route-chapter');
    chapter.setAttribute('aria-label', '学习路线所属章节');
    for (const item of model.chapters) {
      const option = make('option', item.title);
      option.value = item.id;
      chapter.append(option);
    }
    chapterLabel.append(chapter);
    const primary = button(
      '从这里开始',
      () => {
        const node = model.byId.get(snapshot?.entry?.nodeId);
        if (node) onOpenNode?.(node);
      },
      'course-route-primary',
    );
    unit.append(chapterLabel, primary);
    const description = make('p', '', 'course-route-description');
    const viewport = make('div', undefined, 'course-route-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '本章学习路线，可滚动查看');
    const canvas = make('div', undefined, 'course-route-canvas');
    const lines = svg('svg', {
      class: 'course-route-lines',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    const stops = make('ol', undefined, 'course-route-stops');
    canvas.append(lines, stops);
    viewport.append(canvas);
    const footer = make('nav', undefined, 'course-route-paging');
    footer.setAttribute('aria-label', '学习路线分段');
    const previous = button('上一段', () => changePage(snapshot.previous), 'course-route-previous');
    const range = make('span', '', 'course-route-range');
    range.setAttribute('role', 'status');
    const next = button('下一段', () => changePage(snapshot.next), 'course-route-next');
    footer.append(previous, range, next);
    const boundary = make('p', '可自由选择知识点，点击先看概览。', 'course-route-boundary');
    boundary.id = `${container.id || 'course-learning-route'}-interaction-hint`;
    const exits = make('section', undefined, 'course-route-exits');
    exits.setAttribute('aria-label', '其他分段的相连知识点');
    container.append(header, unit, description, viewport, exits, footer, boundary);
    let selectedChapterId = '';
    let selectedNodeId = '';
    let previousSelection;
    let page;
    let snapshot;
    let cardElements = new Map();
    const personalStatus = (step) => {
      if (step.selected) return '正在查看';
      if (step.resume) return '上次看到';
      const tags = getNodeTags(step.id);
      return Array.isArray(tags) && tags.some((tag) => (tag.key || tag) === 'learned')
        ? '已标记学习'
        : '';
    };
    function refreshEntry() {
      locate.hidden = !model.byId.has(resumeNodeId) || /-0+$/.test(resumeNodeId);
      primary.hidden = !snapshot?.entry;
      primary.textContent =
        snapshot?.entry?.kind === 'continue'
          ? '继续上次'
          : snapshot?.entry?.kind === 'selected'
            ? '查看当前知识点'
            : '从这里开始';
    }
    let focusFrame = 0;
    function keepKeyboardFocusVisible(event) {
      const entry = event.target;
      if (
        !root.matchMedia?.('(max-width: 900px)').matches ||
        !entry.matches?.('.course-route-node:focus-visible')
      )
        return;
      root.cancelAnimationFrame?.(focusFrame);
      focusFrame = root.requestAnimationFrame?.(() => {
        focusFrame = 0;
        if (
          document.activeElement !== entry ||
          !entry.isConnected ||
          !container.contains(entry) ||
          !entry.matches(':focus-visible') ||
          !root.matchMedia?.('(max-width: 900px)').matches
        )
          return;
        const viewportTop = root.visualViewport?.offsetTop || 0;
        const viewportBottom = viewportTop + (root.visualViewport?.height || root.innerHeight);
        let safeTop = viewportTop + 8;
        let safeBottom = viewportBottom - 8;
        for (const bar of document.querySelectorAll(
          '.topbar, .mobile-header-backdrop, .mobile-nav',
        )) {
          const style = root.getComputedStyle(bar);
          if (!['fixed', 'sticky'].includes(style.position) || style.visibility === 'hidden')
            continue;
          const box = bar.getBoundingClientRect();
          if (!(box.width > 0 && box.height > 0)) continue;
          if (box.top <= viewportTop + 1 && box.bottom > viewportTop)
            safeTop = Math.max(safeTop, box.bottom + 8);
          if (box.bottom >= viewportBottom - 1 && box.top < viewportBottom)
            safeBottom = Math.min(safeBottom, box.top - 8);
        }
        const delta = focusVisibilityDelta(entry.getBoundingClientRect(), safeTop, safeBottom);
        if (Math.abs(delta) > 1) root.scrollBy?.({ top: delta, behavior: 'instant' });
      });
    }
    container.addEventListener('focusin', keepKeyboardFocusVisible);
    function changePage(value) {
      if (value == null) return;
      page = value;
      draw();
      viewport.scrollTop = 0;
      if (root.matchMedia?.('(max-width: 900px)').matches) {
        // On a single column the six stops belong to the page, not a nested
        // scroll trap. After paging, bring the first new choice into view.
        stops.querySelector?.('button')?.focus?.({ preventScroll: true });
        viewport.scrollIntoView?.({ block: 'start', behavior: 'instant' });
        return;
      }
      if (document.activeElement === next && next.disabled)
        previous.focus?.({ preventScroll: true });
      else if (document.activeElement === previous && previous.disabled)
        next.focus?.({ preventScroll: true });
    }
    chapter.addEventListener('change', () => onSelectChapter?.(chapter.value));
    function drawLines() {
      lines.replaceChildren();
      if (!canvas.clientWidth || !canvas.clientHeight || !snapshot) return;
      const frame = canvas.getBoundingClientRect();
      lines.setAttribute('viewBox', `0 0 ${canvas.clientWidth} ${canvas.clientHeight}`);
      const position = (id) => {
        const elements = cardElements.get(id);
        if (!elements) return null;
        const node = elements.circle.getBoundingClientRect();
        const row = elements.row.getBoundingClientRect();
        return {
          x: node.x - frame.x + node.width / 2,
          y: node.y - frame.y + node.height / 2,
          r: node.width / 2,
          top: row.top - frame.top,
          bottom: row.bottom - frame.top,
        };
      };
      for (const connection of snapshot.connections) {
        const a = position(connection.source);
        const b = position(connection.target);
        if (!a || !b || connection.source === connection.target) continue;
        const startIndex = snapshot.steps.findIndex((step) => step.id === connection.source);
        const endIndex = snapshot.steps.findIndex((step) => step.id === connection.target);
        const down = b.y > a.y ? 1 : -1;
        const sy = a.y + down * (a.r + 7);
        const ty = b.y - down * (b.r + 7);
        let d;
        if (Math.abs(endIndex - startIndex) === 1) {
          const middle = (sy + ty) / 2;
          d = `M ${a.x} ${sy} C ${a.x} ${middle}, ${b.x} ${middle}, ${b.x} ${ty}`;
        } else {
          // Long / backwards branches use the outside margin, never a title row.
          const upper = down > 0 ? a.bottom + 9 : a.top - 9;
          const lower = down > 0 ? b.top - 9 : b.bottom + 9;
          d = `M ${a.x} ${sy} L ${a.x} ${upper} Q ${a.x} ${upper + down * 4} ${a.x - 4} ${upper + down * 4} L 16 ${upper + down * 4} L 16 ${lower - down * 4} L ${b.x - 4} ${lower - down * 4} Q ${b.x} ${lower - down * 4} ${b.x} ${lower} L ${b.x} ${ty}`;
        }
        const group = svg('g', {
          'data-route-source': connection.source,
          'data-route-target': connection.target,
        });
        group.append(
          svg('path', { d, class: 'course-route-rail' }),
          svg('path', { d, class: 'course-route-wire' }),
        );
        lines.append(group);
      }
    }
    function draw() {
      const owner =
        model.chapters.find((item) => item.id === selectedChapterId) ||
        model.chapters.find((item) => item.nodes.some((node) => node.id === resumeNodeId)) ||
        model.chapters[0];
      selectedChapterId = owner?.id || '';
      snapshot = route.buildRoute(model.nodes, [...model.knowledgeEdges], {
        chapterId: selectedChapterId,
        selectedNodeId,
        resumeNodeId,
        page,
      });
      page = snapshot.page;
      chapter.value = selectedChapterId;
      refreshEntry();
      description.textContent =
        snapshot.kind === 'ordered'
          ? `${snapshot.label} · ${snapshot.total} 个知识点 · 分支可自由选择`
          : `${snapshot.label} · ${snapshot.total} 个知识点`;
      container.dataset.routeKind = snapshot.kind;
      container.dataset.routePalette = String(model.chapters.indexOf(owner) % 3);
      stops.replaceChildren();
      cardElements = new Map();
      const wave = [0, -0.65, -1, -0.45, 0.5, 1];
      for (const [localIndex, step] of snapshot.steps.entries()) {
        const row = make(
          'li',
          undefined,
          `course-route-stop${step.selected ? ' is-current' : ''}${step.resume ? ' is-resume' : ''}`,
        );
        row.style.setProperty('--route-wave', wave[localIndex % wave.length]);
        row.classList.toggle('is-reversed', wave[localIndex % wave.length] > 0);
        const entry = button('', () => onOpenNode?.(step.node), 'course-route-node');
        entry.dataset.courseRouteNodeId = step.id;
        // Name from the visible title/ID/status, so a live resume or learned
        // badge remains available to assistive technology without a stale label.
        entry.setAttribute('aria-describedby', boundary.id);
        entry.setAttribute('title', `${step.id} · ${step.node.title || ''}`);
        if (step.selected) entry.setAttribute('aria-current', 'location');
        const circle = make(
          'span',
          String(step.index + 1).padStart(2, '0'),
          'course-route-medallion',
        );
        circle.setAttribute('aria-hidden', 'true');
        const copy = make('span', undefined, 'course-route-node-copy');
        const label = make('strong', step.node.title || step.id);
        const metadata = make('small', step.id);
        copy.append(metadata, label);
        const status = personalStatus(step);
        const badge = status ? make('span', status, 'course-route-status') : null;
        if (badge) copy.append(badge);
        if (step.branch.cycle)
          copy.append(make('small', '同组联系，可任选', 'course-route-branch'));
        else if (step.branch.fork || step.branch.merge)
          copy.append(make('small', '含分支联系', 'course-route-branch'));
        else if (step.kind === 'independent')
          copy.append(make('small', '独立知识点', 'course-route-branch'));
        entry.append(circle, copy);
        row.append(entry);
        stops.append(row);
        cardElements.set(step.id, { row, circle, entry, copy, badge });
      }
      if (!snapshot.total)
        stops.append(make('li', '本章尚未发布知识点，可选择其他章节。', 'course-route-empty'));
      exits.replaceChildren();
      const outside = new Map();
      for (const connection of snapshot.connections) {
        const id =
          connection.sourceVisible && !connection.targetVisible
            ? connection.target
            : connection.targetVisible && !connection.sourceVisible
              ? connection.source
              : '';
        if (!id) continue;
        const node = model.byId.get(id);
        if (!node) continue;
        const direction = connection.sourceVisible ? '接着了解' : '可先了解';
        outside.set(`${direction}:${id}`, { node, direction });
      }
      exits.hidden = outside.size === 0;
      if (outside.size) {
        exits.append(make('small', '其他分段的联系'));
        const more = make('details');
        more.append(make('summary', '更多相连知识点'));
        for (const [index, item] of [...outside.values()].entries()) {
          const entry = button(`${item.direction}：${item.node.title || item.node.id}`, () =>
            onOpenNode?.(item.node),
          );
          entry.dataset.courseRouteExitId = item.node.id;
          (index < 4 ? exits : more).append(entry);
        }
        if (outside.size > 4) exits.append(more);
      }
      previous.disabled = snapshot.previous == null;
      next.disabled = snapshot.next == null;
      range.textContent = snapshot.total
        ? `${snapshot.page * snapshot.pageSize + 1}–${snapshot.page * snapshot.pageSize + snapshot.steps.length} / ${snapshot.total}`
        : '暂无知识点';
      footer.hidden = snapshot.pageCount < 2;
      drawLines();
    }
    const observer = root.ResizeObserver ? new root.ResizeObserver(drawLines) : null;
    observer?.observe(canvas);
    function update(value = {}) {
      const nextChapter = value.selectedChapterId || '';
      const nextNode = value.selectedNodeId || '';
      if (previousSelection?.chapter === nextChapter && previousSelection?.node === nextNode)
        return;
      previousSelection = { chapter: nextChapter, node: nextNode };
      page = undefined;
      selectedChapterId = nextChapter;
      selectedNodeId = nextNode;
      draw();
    }
    return {
      update,
      updateResume(value) {
        resumeNodeId =
          typeof value === 'string' && model.byId.has(value) && !/-0+$/.test(value) ? value : '';
        if (!snapshot) return;
        snapshot = route.buildRoute(model.nodes, [...model.knowledgeEdges], {
          chapterId: selectedChapterId,
          selectedNodeId,
          resumeNodeId,
          page,
        });
        refreshEntry();
        for (const step of snapshot.steps) {
          const card = cardElements.get(step.id);
          if (!card) continue;
          card.row.classList.toggle('is-resume', Boolean(step.resume));
          const status = personalStatus(step);
          if (status) {
            if (!card.badge) {
              card.badge = make('span', status, 'course-route-status');
              card.copy.append(card.badge);
            } else card.badge.textContent = status;
          } else {
            card.badge?.remove?.();
            card.badge = null;
          }
        }
        drawLines();
      },
      reveal(id) {
        const entry = cardElements.get(id)?.entry;
        entry?.focus?.({ preventScroll: true });
        entry?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      },
      getSnapshot: () => snapshot,
      setPage(value) {
        if (!Number.isSafeInteger(value) || value < 0) return;
        page = value;
        draw();
        viewport.scrollTop = 0;
      },
      destroy() {
        observer?.disconnect();
        root.cancelAnimationFrame?.(focusFrame);
        container.removeEventListener?.('focusin', keepKeyboardFocusVisible);
      },
    };
  }
  return { create, focusVisibilityDelta };
});
