(() => {
  const mapPage = document.querySelector('[data-course-map-page]');
  const editorPage = document.querySelector('[data-course-map-editor]');

  if (!mapPage && !editorPage) {
    return;
  }

  const app = window.freeBbsApp;
  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || 'signals';
  const NODE_WIDTH = 230;
  const NODE_HEIGHT = 104;
  const state = {
    course: null,
    nodes: [],
    edges: [],
    selectedNodeId: '',
    creatingNode: false,
    edgeTool: '',
    edgeSource: '',
    drag: null,
  };

  const canvas = document.getElementById('course-map-canvas');
  const scroller = document.getElementById('course-map-scroller');
  const status = document.getElementById('course-map-status');
  const nodeForm = document.getElementById('course-node-form');

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setStatus(message, isError = false) {
    if (!status) {
      return;
    }
    status.textContent = message || '';
    status.classList.toggle('is-error', isError);
    status.classList.toggle('hidden', !message);
  }

  function nodeById(nodeId) {
    return state.nodes.find((node) => node.id === nodeId) || null;
  }

  function knowledgeHref(nodeId) {
    const query = new URLSearchParams({ course: courseSlug, point: nodeId });
    return `/knowledge?${query.toString()}`;
  }

  function mapEditorHref() {
    return `/course-map-editor?course=${encodeURIComponent(courseSlug)}`;
  }

  function markdownEditorHref(nodeId) {
    const query = new URLSearchParams({ course: courseSlug, point: nodeId });
    return `/markdown-editor?${query.toString()}`;
  }

  function mapDimensions() {
    const maxX = Math.max(1100, ...state.nodes.map((node) => node.position.x + NODE_WIDTH + 180));
    const maxY = Math.max(680, ...state.nodes.map((node) => node.position.y + NODE_HEIGHT + 180));
    return { width: maxX, height: maxY };
  }

  function edgePath(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) {
      return '';
    }
    const sourceCenter = {
      x: source.position.x + NODE_WIDTH / 2,
      y: source.position.y + NODE_HEIGHT / 2,
    };
    const targetCenter = {
      x: target.position.x + NODE_WIDTH / 2,
      y: target.position.y + NODE_HEIGHT / 2,
    };
    const boundaryPoint = (from, toward) => {
      const dx = toward.x - from.x;
      const dy = toward.y - from.y;
      const xScale = dx ? NODE_WIDTH / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
      const yScale = dy ? NODE_HEIGHT / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
      const scale = Math.min(xScale, yScale);
      return {
        x: from.x + dx * scale,
        y: from.y + dy * scale,
      };
    };
    const sourcePoint = boundaryPoint(sourceCenter, targetCenter);
    const targetPoint = boundaryPoint(targetCenter, sourceCenter);
    const sourceX = sourcePoint.x;
    const sourceY = sourcePoint.y;
    const targetX = targetPoint.x;
    const targetY = targetPoint.y;
    const middleX = (sourceX + targetX) / 2;
    return `M ${sourceX} ${sourceY} C ${middleX} ${sourceY}, ${middleX} ${targetY}, ${targetX} ${targetY}`;
  }

  function renderEdgesSvg(dimensions) {
    return `
      <svg class="course-map-edges" width="${dimensions.width}" height="${dimensions.height}" aria-hidden="true">
        <defs>
          <marker id="course-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z"></path>
          </marker>
        </defs>
        ${state.edges
          .map(
            (edge, index) => `
          <path
            class="course-map-edge is-${edge.type}"
            data-edge-index="${index}"
            d="${edgePath(edge)}"
            ${edge.type === 'ordered' ? 'marker-end="url(#course-map-arrow)"' : ''}
          ></path>
        `,
          )
          .join('')}
      </svg>
    `;
  }

  function renderMap() {
    if (!canvas) {
      return;
    }
    const dimensions = mapDimensions();
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    canvas.innerHTML = `
      <div class="course-map-grid" aria-hidden="true"></div>
      ${renderEdgesSvg(dimensions)}
      ${state.nodes
        .map((node) => {
          const selectedClass = node.id === state.selectedNodeId ? ' is-selected' : '';
          const sourceClass = node.id === state.edgeSource ? ' is-edge-source' : '';
          return `
            <button
              class="course-map-node${selectedClass}${sourceClass}"
              type="button"
              data-node-id="${escapeHtml(node.id)}"
              style="left:${node.position.x}px;top:${node.position.y}px"
              aria-label="${escapeHtml(node.title)}"
            >
              <span class="course-map-node-id">${escapeHtml(node.id)}</span>
              <strong>${escapeHtml(node.title)}</strong>
              <small>${escapeHtml(node.summary || '暂无简介')}</small>
              <span class="course-map-document-state">${node.hasDocument ? '文档已挂载' : '暂无文档'}</span>
            </button>
          `;
        })
        .join('')}
    `;
    bindNodeEvents();
    renderEdgeList();
  }

  function updateEdgeGeometry() {
    canvas?.querySelectorAll('[data-edge-index]').forEach((pathNode) => {
      pathNode.setAttribute('d', edgePath(state.edges[Number(pathNode.dataset.edgeIndex)]));
    });
  }

  function renderReaderHeader() {
    document.title = `FREE-BBS - ${state.course.name}知识地图`;
    const editLink = document.getElementById('course-map-edit-link');
    editLink.href = mapEditorHref();
    editLink.classList.toggle('hidden', !state.course.canEditMap);
  }

  function renderEditorHeader() {
    document.title = `FREE-BBS - 编辑${state.course.name}地图`;
    document.getElementById('course-editor-title').textContent = `编辑「${state.course.name}」地图`;
    document.getElementById('course-map-reader-link').href =
      `/course?course=${encodeURIComponent(courseSlug)}`;
  }

  async function createEdge(targetNodeId) {
    if (!state.edgeSource) {
      state.edgeSource = targetNodeId;
      setEdgeStatus(`已选择起点 ${targetNodeId}，请选择终点。`);
      renderMap();
      return;
    }
    if (state.edgeSource === targetNodeId) {
      setEdgeStatus('起点和终点不能相同。', true);
      return;
    }
    try {
      const payload = await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map/edges`, {
        method: 'POST',
        body: JSON.stringify({
          source: state.edgeSource,
          target: targetNodeId,
          type: state.edgeTool,
        }),
      });
      state.edges.push(payload.edge);
      state.edgeSource = '';
      setEdgeStatus('连接已创建，可继续选择下一条连接的起点。');
      renderMap();
    } catch (error) {
      setEdgeStatus(error.message, true);
    }
  }

  function selectNode(nodeId) {
    const node = nodeById(nodeId);
    if (!node) {
      return;
    }
    state.selectedNodeId = nodeId;
    state.creatingNode = false;
    nodeForm?.classList.remove('hidden');
    document.getElementById('course-node-form-title').textContent = '编辑知识结点';
    const idInput = document.getElementById('course-node-id');
    idInput.value = node.id;
    idInput.readOnly = true;
    document.getElementById('course-node-title').value = node.title;
    document.getElementById('course-node-summary').value = node.summary || '';
    document.getElementById('course-node-x').value = node.position.x;
    document.getElementById('course-node-y').value = node.position.y;
    document.getElementById('course-delete-node').classList.remove('hidden');
    const documentLink = document.getElementById('course-document-edit-link');
    documentLink.href = markdownEditorHref(node.id);
    documentLink.classList.remove('hidden');
    setNodeMessage('');
    renderMap();
  }

  function bindNodeEvents() {
    canvas?.querySelectorAll('.course-map-node').forEach((nodeElement) => {
      nodeElement.addEventListener('click', (event) => {
        const nodeId = nodeElement.dataset.nodeId;
        if (state.drag?.moved) {
          event.preventDefault();
          return;
        }
        if (!editorPage) {
          window.location.href = knowledgeHref(nodeId);
          return;
        }
        if (state.edgeTool) {
          createEdge(nodeId);
          return;
        }
        selectNode(nodeId);
      });

      if (!editorPage) {
        return;
      }
      nodeElement.addEventListener('pointerdown', (event) => {
        if (state.edgeTool || event.button !== 0) {
          return;
        }
        const node = nodeById(nodeElement.dataset.nodeId);
        if (!node) {
          return;
        }
        state.drag = {
          node,
          element: nodeElement,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startX: node.position.x,
          startY: node.position.y,
          moved: false,
        };
        nodeElement.setPointerCapture(event.pointerId);
      });
      nodeElement.addEventListener('pointermove', (event) => {
        if (!state.drag || state.drag.element !== nodeElement) {
          return;
        }
        const dx = event.clientX - state.drag.startClientX;
        const dy = event.clientY - state.drag.startClientY;
        if (Math.abs(dx) + Math.abs(dy) > 4) {
          state.drag.moved = true;
        }
        state.drag.node.position.x = Math.max(0, Math.round(state.drag.startX + dx));
        state.drag.node.position.y = Math.max(0, Math.round(state.drag.startY + dy));
        nodeElement.style.left = `${state.drag.node.position.x}px`;
        nodeElement.style.top = `${state.drag.node.position.y}px`;
        updateEdgeGeometry();
      });
      nodeElement.addEventListener('pointerup', async (event) => {
        if (!state.drag || state.drag.element !== nodeElement) {
          return;
        }
        const drag = state.drag;
        state.drag = null;
        nodeElement.releasePointerCapture(event.pointerId);
        if (!drag.moved) {
          return;
        }
        try {
          await updateNode(drag.node);
          if (state.selectedNodeId === drag.node.id) {
            document.getElementById('course-node-x').value = drag.node.position.x;
            document.getElementById('course-node-y').value = drag.node.position.y;
          }
          setEdgeStatus(`已保存 ${drag.node.id} 的位置。`);
        } catch (error) {
          setEdgeStatus(error.message, true);
        }
      });
    });
  }

  function setNodeMessage(message, isError = false) {
    const messageNode = document.getElementById('course-node-message');
    if (messageNode) {
      messageNode.textContent = message || '';
      messageNode.classList.toggle('is-error', isError);
    }
  }

  function setEdgeStatus(message, isError = false) {
    const messageNode = document.getElementById('course-edge-status');
    if (messageNode) {
      messageNode.textContent = message || '';
      messageNode.classList.toggle('is-error', isError);
    }
  }

  function beginCreateNode() {
    state.selectedNodeId = '';
    state.creatingNode = true;
    nodeForm.classList.remove('hidden');
    document.getElementById('course-node-form-title').textContent = '添加知识结点';
    const idInput = document.getElementById('course-node-id');
    idInput.value = '';
    idInput.readOnly = false;
    document.getElementById('course-node-title').value = '';
    document.getElementById('course-node-summary').value = '';
    document.getElementById('course-node-x').value = Math.max(40, scroller.scrollLeft + 160);
    document.getElementById('course-node-y').value = Math.max(40, scroller.scrollTop + 160);
    document.getElementById('course-delete-node').classList.add('hidden');
    document.getElementById('course-document-edit-link').classList.add('hidden');
    setNodeMessage('结点 ID 创建后不可修改。');
    renderMap();
    idInput.focus();
  }

  function readNodeForm() {
    return {
      id: document.getElementById('course-node-id').value.trim().toUpperCase(),
      title: document.getElementById('course-node-title').value.trim(),
      summary: document.getElementById('course-node-summary').value.trim(),
      position: {
        x: Number(document.getElementById('course-node-x').value),
        y: Number(document.getElementById('course-node-y').value),
      },
    };
  }

  async function updateNode(node) {
    await app.callApi(
      `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(node.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          title: node.title,
          summary: node.summary,
          position: node.position,
        }),
      },
    );
  }

  async function saveNodeForm(event) {
    event.preventDefault();
    const draft = readNodeForm();
    setNodeMessage('正在保存…');
    try {
      if (state.creatingNode) {
        const payload = await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map/nodes`, {
          method: 'POST',
          body: JSON.stringify(draft),
        });
        state.nodes.push(payload.node);
        selectNode(payload.node.id);
        setNodeMessage('知识结点已创建。');
      } else {
        const node = nodeById(state.selectedNodeId);
        Object.assign(node, {
          title: draft.title,
          summary: draft.summary,
          position: draft.position,
        });
        await updateNode(node);
        renderMap();
        selectNode(node.id);
        setNodeMessage('知识结点已保存。');
      }
    } catch (error) {
      setNodeMessage(error.message, true);
    }
  }

  async function deleteSelectedNode() {
    const node = nodeById(state.selectedNodeId);
    if (!node || !window.confirm(`确认删除知识结点 ${node.id}？相关连接也会一并删除。`)) {
      return;
    }
    try {
      await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(node.id)}`,
        { method: 'DELETE' },
      );
      state.nodes = state.nodes.filter((item) => item.id !== node.id);
      state.edges = state.edges.filter(
        (edge) => edge.source !== node.id && edge.target !== node.id,
      );
      state.selectedNodeId = '';
      nodeForm.classList.add('hidden');
      renderMap();
      setEdgeStatus(`已删除 ${node.id}。`);
    } catch (error) {
      setNodeMessage(error.message, true);
    }
  }

  function renderEdgeList() {
    const list = document.getElementById('course-edge-list');
    if (!list) {
      return;
    }
    list.innerHTML = state.edges.length
      ? state.edges
          .map(
            (edge, index) => `
          <article class="course-edge-list-item">
            <span>${escapeHtml(edge.source)} ${edge.type === 'ordered' ? '→' : '---'} ${escapeHtml(edge.target)}</span>
            <button data-delete-edge="${index}" type="button" aria-label="删除连接">删除</button>
          </article>
        `,
          )
          .join('')
      : '<p class="course-muted">暂无连接。</p>';
  }

  async function deleteEdge(index) {
    const edge = state.edges[index];
    if (!edge || !window.confirm(`确认删除 ${edge.source} 与 ${edge.target} 之间的连接？`)) {
      return;
    }
    try {
      await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map/edges`, {
        method: 'DELETE',
        body: JSON.stringify(edge),
      });
      state.edges.splice(index, 1);
      renderMap();
      setEdgeStatus('连接已删除。');
    } catch (error) {
      setEdgeStatus(error.message, true);
    }
  }

  function bindEditorControls() {
    document.getElementById('course-add-node-button')?.addEventListener('click', beginCreateNode);
    nodeForm?.addEventListener('submit', saveNodeForm);
    document.getElementById('course-delete-node')?.addEventListener('click', deleteSelectedNode);
    document.querySelectorAll('[data-edge-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        state.edgeTool = button.dataset.edgeTool === 'none' ? '' : button.dataset.edgeTool;
        state.edgeSource = '';
        document.querySelectorAll('[data-edge-tool]').forEach((tool) => {
          tool.classList.toggle('is-active', tool.dataset.edgeTool === state.edgeTool);
        });
        setEdgeStatus(
          state.edgeTool
            ? `已选择${state.edgeTool === 'ordered' ? '顺序箭头' : '关联虚线'}，请点击起点。`
            : '连接工具已取消，可拖拽或编辑结点。',
        );
        renderMap();
      });
    });
    document.getElementById('course-edge-list')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-delete-edge]');
      if (button) {
        deleteEdge(Number(button.dataset.deleteEdge));
      }
    });
  }

  async function initialize() {
    await app.sessionReady;
    try {
      const payload = await app.callApi(`/courses/${encodeURIComponent(courseSlug)}/map`, {
        method: 'GET',
      });
      state.course = payload.course;
      state.nodes = payload.nodes || [];
      state.edges = payload.edges || [];
      if (editorPage && !state.course.canEditMap) {
        setStatus('你不是该课程的资料负责人，无法编辑这张地图。', true);
        document.querySelector('.course-editor-layout')?.classList.add('is-readonly');
        return;
      }
      if (mapPage) {
        renderReaderHeader();
      } else {
        renderEditorHeader();
        bindEditorControls();
      }
      renderMap();
      setStatus(state.nodes.length ? '' : '这门课程的知识地图还是空的。');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  initialize();
})();
