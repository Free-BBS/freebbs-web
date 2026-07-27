(() => {
  const page = document.querySelector('[data-knowledge-page]');
  if (!page) {
    return;
  }

  const app = window.freeBbsApp;
  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || 'signals';
  const nodeId = params.get('point') || '';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function knowledgeHref(nextNodeId) {
    const query = new URLSearchParams({ course: courseSlug, point: nextNodeId });
    return `/knowledge?${query.toString()}`;
  }

  function setNeighbourLink(linkId, neighbour, directionLabel) {
    const link = document.getElementById(linkId);
    if (!neighbour) {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled', 'true');
      link.classList.add('is-disabled');
      link.textContent = directionLabel;
      return;
    }
    link.href = knowledgeHref(neighbour.id);
    link.removeAttribute('aria-disabled');
    link.classList.remove('is-disabled');
    link.innerHTML =
      linkId === 'knowledge-previous-link'
        ? `<small>上一个</small><strong>← ${escapeHtml(neighbour.title)}</strong>`
        : `<small>下一个</small><strong>${escapeHtml(neighbour.title)} →</strong>`;
  }

  function findNeighbours(map, currentNodeId) {
    const orderedEdges = (map.edges || []).filter((edge) => edge.type === 'ordered');
    const previousId = orderedEdges.find((edge) => edge.target === currentNodeId)?.source;
    const nextId = orderedEdges.find((edge) => edge.source === currentNodeId)?.target;
    const orderedByPosition = [...(map.nodes || [])].sort(
      (a, b) =>
        a.position.x - b.position.x || a.position.y - b.position.y || a.id.localeCompare(b.id),
    );
    const currentIndex = orderedByPosition.findIndex((item) => item.id === currentNodeId);
    return {
      previous:
        map.nodes.find((item) => item.id === previousId) ||
        (currentIndex > 0 ? orderedByPosition[currentIndex - 1] : null),
      next:
        map.nodes.find((item) => item.id === nextId) ||
        (currentIndex >= 0 && currentIndex < orderedByPosition.length - 1
          ? orderedByPosition[currentIndex + 1]
          : null),
    };
  }

  async function initialize() {
    await app.sessionReady;
    if (!nodeId) {
      page.innerHTML = '<section class="course-empty">未指定知识结点。</section>';
      return;
    }
    try {
      const [detail, map] = await Promise.all([
        app.callApi(
          `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(nodeId)}`,
          { method: 'GET' },
        ),
        app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map`, { method: 'GET' }),
      ]);
      const { course, node } = detail;
      const neighbours = findNeighbours(map, node.id);
      document.title = `FREE-BBS - ${node.title}`;
      const courseLink = document.getElementById('knowledge-course-link');
      courseLink.href = `/course?course=${encodeURIComponent(courseSlug)}`;
      document.getElementById('knowledge-node-id').textContent = node.id;
      document.getElementById('knowledge-title').textContent = node.title;
      document.getElementById('knowledge-summary').textContent = node.summary || '';
      const body = document.getElementById('knowledge-body');
      body.innerHTML = app.renderMarkdownContent(
        node.markdown || '*这个知识结点还没有挂载 Markdown 文档。*',
      );
      app.enhanceMarkdownContent(body);
      setNeighbourLink('knowledge-previous-link', neighbours.previous, '已经是第一个');
      setNeighbourLink('knowledge-next-link', neighbours.next, '已经是最后一个');
      document.getElementById('knowledge-discussion-link').href =
        `/discussion?board=${encodeURIComponent(course.boardSlug || 'all')}`;
    } catch (error) {
      page.innerHTML = `<section class="course-empty">${escapeHtml(error.message)}</section>`;
    }
  }

  initialize();
})();
