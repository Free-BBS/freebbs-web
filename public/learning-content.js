/* The same document conventions serve course authoring, maps and the reader. */
(function expose(root) {
  const graphLayout =
    typeof module === 'object' && module.exports
      ? require('./learning-graph-layout')
      : root.FreeBbsLearningGraphLayout;
  function chapterId(id) {
    return String(id || '')
      .split('-')
      .slice(0, 2)
      .join('-');
  }
  function isChapterNode(node) {
    return /^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(node?.id || '');
  }
  function chapterName(nodes, id, fallback = id) {
    const members = nodes.filter((node) => chapterId(node.id) === id);
    // An ordinal is not an authored chapter name. Older content may contain a
    // placeholder zero-level title even when its ordinary points name the unit.
    const publishedName = (value) => {
      const name = String(value || '')
        .replace(/[*`]/g, '')
        .trim();
      return !name ||
        /^(?:第\s*(?:\d+|[零〇一二三四五六七八九十百千]+|[Xx]+)\s*章|(?:chapter|unit)\s*(?:\d+|[ivxlcdm]+|n)|\d+)[.、:：。\s-]*$/i.test(
          name,
        ) ||
        name === id ||
        (chapterId(name) === id && isChapterNode({ id: name }))
        ? ''
        : name;
    };
    const overviewName = members
      .filter(isChapterNode)
      .map((node) => publishedName(node.title))
      .find(Boolean);
    const metadataName = members
      .map(
        (node) =>
          publishedName(node.chapterTitle) ||
          publishedName(node.metadata?.['章节/单元']) ||
          publishedName(node.metadata?.['章节']) ||
          publishedName(node.metadata?.['所属章节']),
      )
      .find(Boolean);
    // Do not invent a subject from the body or an obsolete course-specific list.
    return overviewName || metadataName || publishedName(fallback) || id;
  }
  function extractHeading(markdown, labels) {
    const lines = String(markdown || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    let level = 0;
    let fence = '';
    const result = [];
    for (const line of lines) {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = '';
      }
      const heading = !fence && !marker && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading && level && heading[1].length <= level) break;
      if (heading && !level && labels.includes(heading[2].trim())) {
        level = heading[1].length;
        continue;
      }
      if (level) result.push(line);
    }
    return result.join('\n').trim();
  }
  function originMarkdown(sections) {
    return extractHeading(sections?.applicationsMarkdown, ['知识起源', '为什么学', '产生背景']);
  }
  function stripQuizSource(markdown) {
    const lines = String(markdown || '')
      .replace(/\r\n?/g, '\n')
      .split('\n');
    let fence = '';
    return lines
      .filter((line) => {
        if (!fence) {
          const opening = line.match(/^\s{0,3}(`{3,}|~{3,})\s*freebbs-quiz\s*$/i);
          if (!opening) return true;
          fence = opening[1];
        } else {
          const closing = line.trim();
          if (
            closing.length >= fence.length &&
            closing[0] === fence[0] &&
            /^(?:`+|~+)$/.test(closing)
          )
            fence = '';
        }
        return false;
      })
      .join('\n');
  }
  function chapterNetwork(map, id) {
    const nodes = (map.nodes || []).filter(
      (node) => chapterId(node.id) === id && !isChapterNode(node),
    );
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: (map.edges || []).filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    };
  }
  function renderNetwork(container, map, node, course) {
    container.replaceChildren();
    container.hidden = !isChapterNode(node);
    if (container.hidden) return;
    const { nodes, edges } = chapterNetwork(map, chapterId(node.id));
    const title = document.createElement('h3');
    title.textContent = '本章知识网络';
    container.append(title);
    if (!nodes.length) {
      const empty = document.createElement('p');
      empty.textContent = '本章尚未发布知识点。';
      container.append(empty);
      return;
    }
    const make = (tag, attributes = {}) => {
      const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
      return element;
    };
    let diagram;
    try {
      if (
        !['layout', 'titleLines', 'fitSvgLabel'].every(
          (name) => typeof graphLayout?.[name] === 'function',
        )
      )
        throw new Error('Optional graph unavailable');
      diagram = graphLayout.layout(nodes, edges, { compact: container.clientWidth < 520 });
    } catch {
      const notice = document.createElement('p');
      notice.textContent = '关系图暂不可用，可从本章目录继续。';
      const list = document.createElement('ul');
      for (const item of nodes) {
        const entry = document.createElement('li');
        const link = document.createElement('a');
        link.textContent = `${item.title} · ${item.id}`;
        link.href = `/knowledge?${new URLSearchParams({ course: course.slug, point: item.id })}`;
        entry.append(link);
        list.append(entry);
      }
      container.append(notice, list);
      return;
    }
    const svg = make('svg', {
      viewBox: `0 0 ${diagram.width} ${diagram.height}`,
      width: diagram.width,
      height: diagram.height,
      role: 'group',
      'aria-label': `${node.title}知识网络`,
    });
    for (const route of diagram.routes) {
      const { edge } = route;
      const group = make('g', {
        class: `chapter-network-edge is-${edge.type}`,
        'data-source': edge.source,
        'data-target': edge.target,
      });
      group.append(make('path', { d: route.path, class: 'chapter-network-connector' }));
      if (route.arrow)
        group.append(make('path', { d: route.arrow, class: 'chapter-network-arrow' }));
      const tooltip = make('title');
      tooltip.textContent = `${edge.type === 'ordered' ? '学习顺序' : '补充联系'}${edge.note ? `：${edge.note}` : ''}`;
      group.append(tooltip);
      svg.append(group);
    }
    const textLabels = [];
    for (const box of diagram.boxes) {
      const item = box.node;
      const link = make('a', {
        href: `/knowledge?${new URLSearchParams({ course: course.slug, point: item.id })}`,
        'aria-label': `查看${item.title}学习概览`,
        'data-node-id': item.id,
        transform: `translate(${box.x} ${box.y})`,
      });
      link.append(make('rect', { width: box.width, height: box.height, rx: 12 }));
      const id = make('text', { x: 14, y: 25, class: 'chapter-network-id' });
      id.textContent = graphLayout.titleLines(item.id, 26, 1)[0];
      // A full accessible label and tooltip are kept even for very long names.
      const label = make('text', { x: 14, y: 50 });
      for (const [index, line] of graphLayout.titleLines(item.title || item.id, 21, 2).entries()) {
        const span = make('tspan', { x: 14, y: 50 + index * 23 });
        span.textContent = line;
        label.append(span);
      }
      const tooltip = make('title');
      tooltip.textContent = `${item.id} · ${item.title}`;
      link.append(tooltip, id, label);
      textLabels.push({ id, label, item, width: box.width - 28 });
      link.addEventListener('focus', () => {
        const reveal = () => {
          const frame = viewport.getBoundingClientRect();
          const card = link.querySelector('rect').getBoundingClientRect();
          const left = frame.left + viewport.clientLeft;
          const top = frame.top + viewport.clientTop;
          const right = left + viewport.clientWidth;
          const bottom = top + viewport.clientHeight;
          if (card.left < left + 8) viewport.scrollLeft -= left + 8 - card.left;
          else if (card.right > right - 8) viewport.scrollLeft += card.right - right + 8;
          if (card.top < top + 8) viewport.scrollTop -= top + 8 - card.top;
          else if (card.bottom > bottom - 8) viewport.scrollTop += card.bottom - bottom + 8;
        };
        reveal();
        // Finish after the browser's native SVG focus scrolling, which may only
        // reveal the text anchor rather than the complete clickable card.
        root.requestAnimationFrame?.(reveal);
      });
      svg.append(link);
    }
    const viewport = document.createElement('div');
    viewport.className = 'chapter-network-viewport';
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '本章知识网络，可滚动查看');
    viewport.append(svg);
    container.append(viewport);
    for (const { id, label, item, width } of textLabels) {
      graphLayout.fitSvgLabel(id, item.id, { width, identifier: true, x: 14, y: 25 });
      graphLayout.fitSvgLabel(label, item.title || item.id, { width, lines: 2, x: 14, y: 50 });
    }
    if (container.clientWidth < 520 && viewport.clientWidth > 0) {
      const first = diagram.boxes[0];
      // Keep a full card visible on narrow phones; the routing gutter remains
      // reachable by native scrolling instead of taking the first reading space.
      viewport.scrollLeft = Math.max(0, first.x - (viewport.clientWidth - first.width) / 2);
    }
    const legend = document.createElement('p');
    legend.className = 'learning-caption';
    legend.textContent = '实线箭头：学习顺序 · 虚线：关联';
    container.append(legend);
  }
  const api = {
    chapterId,
    isChapterNode,
    chapterName,
    extractHeading,
    originMarkdown,
    stripQuizSource,
    chapterNetwork,
    renderNetwork,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsLearningContent = api;
})(typeof window === 'undefined' ? globalThis : window);
