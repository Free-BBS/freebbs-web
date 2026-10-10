/* The same document conventions serve course authoring, maps and the reader. */
(function expose(root) {
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
    return (
      members.find(isChapterNode)?.title ||
      members.find((node) => node.chapterTitle)?.chapterTitle ||
      fallback
    );
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
    const positions = new Map(
      nodes.map((item, index) => [
        item.id,
        {
          x: Number.isFinite(Number(item.position?.x))
            ? Number(item.position.x)
            : (index % 3) * 290,
          y: Number.isFinite(Number(item.position?.y))
            ? Number(item.position.y)
            : Math.floor(index / 3) * 140,
        },
      ]),
    );
    const xs = [...positions.values()].map((point) => point.x);
    const ys = [...positions.values()].map((point) => point.y);
    const minX = Math.min(...xs) - 135;
    const minY = Math.min(...ys) - 52;
    const width = Math.max(...xs) - minX + 135;
    const height = Math.max(...ys) - minY + 52;
    const svg = make('svg', {
      viewBox: [minX, minY, width, height].join(' '),
      role: 'group',
      'aria-label': `${node.title}知识网络`,
    });
    const defs = make('defs');
    const marker = make('marker', {
      id: 'chapter-network-arrow',
      markerWidth: 9,
      markerHeight: 9,
      refX: 8,
      refY: 4.5,
      orient: 'auto',
    });
    marker.append(make('path', { d: 'M 0 0 L 9 4.5 L 0 9 z', fill: 'currentColor' }));
    defs.append(marker);
    svg.append(defs);
    for (const edge of edges) {
      const a = positions.get(edge.source);
      const b = positions.get(edge.target);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 1;
      const inset = Math.min(
        124 / (Math.abs(dx) / distance || 1e-9),
        40 / (Math.abs(dy) / distance || 1e-9),
        distance / 2,
      );
      svg.append(
        make('line', {
          x1: a.x + (dx / distance) * inset,
          y1: a.y + (dy / distance) * inset,
          x2: b.x - (dx / distance) * inset,
          y2: b.y - (dy / distance) * inset,
          class: edge.type === 'ordered' ? 'chapter-network-ordered' : 'chapter-network-related',
          ...(edge.type === 'ordered' ? { 'marker-end': 'url(#chapter-network-arrow)' } : {}),
        }),
      );
    }
    for (const item of nodes) {
      const point = positions.get(item.id);
      const link = make('a', {
        href: `/knowledge?${new URLSearchParams({ course: course.slug, point: item.id })}`,
        'aria-label': `查看${item.title}学习概览`,
      });
      link.append(
        make('rect', { x: point.x - 120, y: point.y - 36, width: 240, height: 72, rx: 12 }),
      );
      const id = make('text', {
        x: point.x,
        y: point.y - 10,
        'text-anchor': 'middle',
        class: 'chapter-network-id',
      });
      id.textContent = item.id;
      const label = make('text', { x: point.x, y: point.y + 15, 'text-anchor': 'middle' });
      label.textContent = item.title.length > 13 ? `${item.title.slice(0, 13)}…` : item.title;
      const tooltip = make('title');
      tooltip.textContent = item.title;
      link.append(tooltip, id, label);
      svg.append(link);
    }
    container.append(svg);
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
