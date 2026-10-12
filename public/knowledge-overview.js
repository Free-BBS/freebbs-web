/* Shared display model for legacy Markdown metadata. Does not rewrite course documents. */
(function exposeOverview(root) {
  const FIELD_ALIASES = {
    course: ['课程名称', '所属课程'],
    chapter: ['章节/单元', '章节', '所属章节'],
    type: ['知识点类型', '类型'],
    level: ['知识点层级', '层级'],
    difficulty: ['难度', '难度（1-5）', '难度(1-5)'],
    importance: ['重要程度', '重要程度（1-5）', '重要程度(1-5)', '重要性'],
    duration: ['建议学习时长', '建议时长', '学习时长'],
    participants: [
      '参与同学',
      '参与者',
      '贡献者',
      '填写人',
      '编写人',
      '编写者',
      '作者',
      '修改人',
      '修订人',
      '审核人',
    ],
  };
  const canonical = (value) =>
    value
      .replace(/[\s：:]/g, '')
      .replace(/（/g, '(')
      .replace(/）/g, ')');
  const aliases = new Map(
    Object.entries(FIELD_ALIASES).flatMap(([key, labels]) =>
      labels.map((label) => [canonical(label), key]),
    ),
  );
  function plain(value) {
    return String(value || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/[*`_]/g, '')
      .replace(/^[\s"'“”]+|[\s"'“”]+$/g, '')
      .trim();
  }
  function readFields(markdown) {
    const fields = {};
    let pending = '';
    for (const raw of String(markdown || '').split(/\r?\n/)) {
      if (!raw.trim() || /^\s*\|?[\s:|-]+\|?\s*$/.test(raw)) continue;
      const heading = /^\s*#{1,6}\s/.test(raw);
      const line = plain(
        raw.replace(/^\s*(?:#{1,6}\s*|[-+]\s+)/, '').replace(/^\d+(?:\.\d+)*[.、]?\s+/, ''),
      );
      const cells = raw.trim().startsWith('|') ? raw.split('|').slice(1, -1).map(plain) : null;
      const pair =
        cells?.length >= 2 ? [cells[0], cells[1]] : line.match(/^([^：:]+)[：:]\s*(.*)$/)?.slice(1);
      const label = pair ? pair[0] : line;
      const key = aliases.get(canonical(label));
      if (key) {
        const value = plain(pair?.[1]);
        if (value) {
          // Keep the first authoritative value; later relations may describe other nodes.
          if (key === 'participants') fields[key] = [...(fields[key] || []), value];
          else if (!fields[key]) fields[key] = value;
        }
        pending = value ? '' : key;
      } else if (pending && !heading && !pair) {
        if (pending === 'participants') fields[pending] = [...(fields[pending] || []), line];
        else if (!fields[pending]) fields[pending] = line;
        if (pending !== 'participants') pending = '';
      } else pending = '';
    }
    return fields;
  }
  function firstParagraph(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const result = [];
    for (const raw of lines) {
      if (/^\s*(#{1,6}\s|\||```|---)/.test(raw)) {
        if (result.length) break;
        continue;
      }
      if (!raw.trim()) {
        if (result.length) break;
        else continue;
      }
      result.push(plain(raw.replace(/^\s*[-+>]\s*/, '')));
    }
    return result.filter(Boolean).join(' ');
  }
  function model(node = {}, course = {}) {
    const fields = readFields(node.sections?.basicInfoMarkdown);
    const participants = [
      ...new Set(
        (fields.participants || [])
          .flatMap((value) => value.replace(/^\[|\]$/g, '').split(/[、,，;；\n]/))
          .map(plain)
          .filter((value) => value && !/^(待补充|暂无|无|未填写|—|-)$/.test(value)),
      ),
    ];
    const fullSummary = plain(node.summary) || firstParagraph(node.sections?.applicationsMarkdown);
    return {
      id: node.id || '',
      title: node.title || '知识点',
      course: course.name || fields.course || '',
      chapter: fields.chapter || '',
      type: fields.type || '',
      level: fields.level || '',
      difficulty: fields.difficulty || '',
      importance: fields.importance || '',
      duration: fields.duration || '',
      participants,
      summary: fullSummary.length > 150 ? `${fullSummary.slice(0, 150)}…` : fullSummary,
    };
  }
  function element(tag, className, text) {
    const result = document.createElement(tag);
    if (className) result.className = className;
    if (text) result.textContent = text;
    return result;
  }
  function render(container, node, course) {
    const info = model(node, course);
    container.replaceChildren();
    container.classList.add('knowledge-overview-content');
    const identity = element('div', 'knowledge-overview-identity');
    identity.append(
      element('p', 'knowledge-overview-course', [info.course, info.id].filter(Boolean).join(' · ')),
      element('h2', '', info.title),
    );
    if (info.chapter) identity.append(element('p', 'knowledge-overview-chapter', info.chapter));
    container.append(identity);
    const facts = element('dl', 'knowledge-overview-facts');
    for (const [label, value] of [
      ['类型', info.type],
      ['层级', info.level],
      ['难度', info.difficulty],
      ['重要程度', info.importance],
      ['建议时长', info.duration],
    ]) {
      if (!value) continue;
      const cell = element('div');
      const display =
        ['难度', '重要程度'].includes(label) && /^[1-5]$/.test(value) ? `${value} / 5` : value;
      cell.append(element('dt', '', label), element('dd', '', display));
      facts.append(cell);
    }
    if (facts.childElementCount) container.append(facts);
    if (info.summary) {
      const section = element('section', 'knowledge-overview-brief');
      section.append(element('h3', '', '学什么'), element('p', '', info.summary));
      container.append(section);
    }
    if (!/^[A-Z][A-Z0-9]*-[A-Z0-9]+-0+$/.test(node.id || '')) {
      const stars = element('div', 'learning-star-strip');
      container.append(stars);
      const courseSlug = course.slug || new URLSearchParams(window.location.search).get('course');
      window.FreeBbsLearningStars?.mount(stars, {
        courseSlug,
        nodeId: node.id,
        level: /拓展|extension|elective/.test(info.level) ? 'extension' : info.level,
      });
    }
    const people = element('section', 'knowledge-overview-people');
    people.append(element('h3', '', '参与同学'));
    const list = element('ul');
    info.participants.forEach((name) => list.append(element('li', '', name)));
    people.append(
      info.participants.length ? list : element('p', 'knowledge-overview-muted', '暂未署名'),
    );
    container.append(people);
    return info;
  }
  function createDrawer({ app, courseSlug }) {
    const dialog = element('dialog', 'knowledge-overview-drawer');
    dialog.id = 'course-knowledge-overview';
    dialog.setAttribute('aria-labelledby', 'course-knowledge-overview-title');
    const header = element('header', 'knowledge-overview-drawer-header');
    const heading = element('h2', '', '学习概览');
    heading.id = 'course-knowledge-overview-title';
    const close = element('button', '', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭学习概览');
    close.autofocus = true;
    header.append(heading, close);
    const content = element('div', 'knowledge-overview-drawer-body');
    const message = element('p', 'knowledge-overview-muted');
    message.setAttribute('role', 'status');
    const facts = element('div');
    const originals = element('details', 'knowledge-overview-originals');
    originals.append(element('summary', '', '完整说明'));
    const originalBody = element('div', 'discussion-markdown-body');
    originals.append(originalBody);
    content.append(message, facts, originals);
    const footer = element('footer', 'knowledge-overview-drawer-footer');
    const study = element('a', 'knowledge-overview-study', '进入学习');
    const relation = element('button', '', '查看知识关系');
    relation.type = 'button';
    footer.append(relation, study);
    dialog.append(header, content, footer);
    document.body.append(dialog);
    let requestId = 0;
    let returnFocus = null;
    let showRelations = null;
    let currentId = '';
    let chapterOverview = false;
    close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
    });
    dialog.addEventListener('click', (event) => {
      const rect = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom)
      )
        dialog.close();
    });
    dialog.addEventListener('close', () => {
      if (!dialog.open && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    });
    relation.addEventListener('click', () => {
      if (chapterOverview) {
        window.location.assign(`${study.href}#knowledge-chapter-network`);
        return;
      }
      const callback = showRelations;
      const id = currentId;
      dialog.close();
      callback?.(id);
    });
    async function open(node, course, trigger, onRelations) {
      requestId += 1;
      const id = requestId;
      currentId = node.id;
      chapterOverview = Boolean(window.FreeBbsLearningContent?.isChapterNode(node));
      relation.textContent = chapterOverview ? '查看章节知识网络' : '查看知识关系';
      showRelations = onRelations;
      returnFocus = trigger || document.activeElement;
      study.href = `/knowledge?${new URLSearchParams({ course: courseSlug, point: node.id, view: 'reading' })}`;
      relation.hidden = !onRelations;
      originals.hidden = true;
      originals.open = false;
      originalBody.replaceChildren();
      render(facts, node, course);
      message.textContent = '正在载入…';
      if (!dialog.open) dialog.showModal();
      content.scrollTop = 0;
      try {
        const detail = await app.callApi(
          `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(node.id)}`,
          { method: 'GET' },
        );
        if (id !== requestId || !dialog.open) return;
        render(facts, detail.node, detail.course || course);
        const sections = detail.node.sections || {};
        const markdown = [sections.basicInfoMarkdown, sections.applicationsMarkdown]
          .filter(Boolean)
          .join('\n\n');
        originals.hidden = !markdown;
        if (markdown) {
          originalBody.innerHTML = app.renderMarkdownContent(markdown);
          app.enhanceMarkdownContent(originalBody);
        }
        message.textContent = '';
      } catch {
        if (id === requestId && dialog.open)
          message.textContent = '概览暂未载入，可关闭后重试或直接进入学习。';
      }
    }
    return { open, isOpen: () => dialog.open };
  }
  const api = { readFields, model, render, createDrawer };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsKnowledgeOverview = api;
})(typeof window === 'undefined' ? globalThis : window);
