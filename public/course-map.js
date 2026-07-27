(() => {
  const mapPage = document.querySelector('[data-course-map-page]');
  const editorPage = document.querySelector('[data-course-map-editor]');

  if (!mapPage && !editorPage) {
    return;
  }

  const app = window.freeBbsApp;
  const params = new URLSearchParams(window.location.search);
  const courseSlug = params.get('course') || 'signals';
  const NODE_LABEL_WIDTH = 220;
  const NODE_LABEL_HEIGHT = 126;
  const NODE_DOT_RADIUS = 13;
  const EDITOR_CANVAS_INSET_X = editorPage ? 96 : 0;
  const EDITOR_CANVAS_INSET_Y = editorPage ? 104 : 0;
  const state = {
    course: null,
    nodes: [],
    edges: [],
    backgroundUrl: '',
    selectedNodeId: '',
    creatingNode: false,
    edgeTool: '',
    edgeSource: '',
    drag: null,
    suppressClickUntil: 0,
    activePanelId: '',
  };

  const canvas = document.getElementById('course-map-canvas');
  const scroller = document.getElementById('course-map-scroller');
  const status = document.getElementById('course-map-status');
  const nodeForm = document.getElementById('course-node-form');
  const saveState = document.getElementById('course-map-save-state');
  const nodePanel = document.getElementById('course-node-panel');
  const positionSaveQueues = new Map();

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

  function setSaveState(message, isError = false) {
    if (!saveState) {
      return;
    }
    saveState.textContent = message || '';
    saveState.classList.toggle('is-error', isError);
  }

  function resolveBackgroundUrl(value = state.backgroundUrl) {
    return app.resolveAssetUrl?.(value) || value || '';
  }

  function setBackgroundSurface() {
    if (!canvas) {
      return;
    }
    const resolvedUrl = resolveBackgroundUrl();
    canvas.classList.toggle('has-custom-background', Boolean(resolvedUrl));
    if (resolvedUrl) {
      canvas.style.setProperty('--course-map-background-image', `url("${resolvedUrl}")`);
    } else {
      canvas.style.removeProperty('--course-map-background-image');
    }
    const preview = document.getElementById('course-map-background-preview');
    if (preview) {
      preview.classList.toggle('has-image', Boolean(resolvedUrl));
      preview.style.backgroundImage = resolvedUrl ? `url("${resolvedUrl}")` : '';
      preview.innerHTML = `<span>${resolvedUrl ? '当前地图背景' : '当前使用默认星图背景'}</span>`;
    }
    document
      .getElementById('course-map-background-clear')
      ?.toggleAttribute('disabled', !resolvedUrl);
  }

  function closeStudioPanels() {
    document.querySelectorAll('.course-map-studio-panel').forEach((panel) => {
      panel.classList.add('hidden');
    });
    document
      .querySelectorAll('#course-edge-panel-toggle, #course-background-panel-toggle')
      .forEach((button) => {
        button.classList.remove('is-active');
        button.setAttribute('aria-expanded', 'false');
      });
    state.activePanelId = '';
  }

  function openStudioPanel(panelId, triggerId = '', allowToggle = false) {
    const panel = document.getElementById(panelId);
    if (!panel) {
      return;
    }
    const shouldClose =
      allowToggle && state.activePanelId === panelId && !panel.classList.contains('hidden');
    closeStudioPanels();
    if (shouldClose) {
      return;
    }
    panel.classList.remove('hidden');
    state.activePanelId = panelId;
    if (triggerId) {
      const trigger = document.getElementById(triggerId);
      trigger?.classList.add('is-active');
      trigger?.setAttribute('aria-expanded', 'true');
    }
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
    const viewportWidth = scroller?.clientWidth || 1100;
    const viewportHeight = scroller?.clientHeight || 680;
    const maxX = Math.max(
      viewportWidth,
      1100,
      ...state.nodes.map(
        (node) => node.position.x + EDITOR_CANVAS_INSET_X + NODE_LABEL_WIDTH / 2 + 180,
      ),
    );
    const maxY = Math.max(
      viewportHeight,
      680,
      ...state.nodes.map((node) => node.position.y + EDITOR_CANVAS_INSET_Y + NODE_DOT_RADIUS + 180),
    );
    return { width: maxX, height: maxY };
  }

  function edgePath(edge) {
    const source = nodeById(edge.source);
    const target = nodeById(edge.target);
    if (!source || !target) {
      return '';
    }
    const sourceCenter = source.position;
    const targetCenter = target.position;
    const boundaryPoint = (from, toward, radius) => {
      const dx = toward.x - from.x;
      const dy = toward.y - from.y;
      const distance = Math.hypot(dx, dy) || 1;
      const scale = radius / distance;
      return {
        x: from.x + dx * scale,
        y: from.y + dy * scale,
      };
    };
    const sourcePoint = boundaryPoint(sourceCenter, targetCenter, NODE_DOT_RADIUS);
    const targetPoint = boundaryPoint(targetCenter, sourceCenter, NODE_DOT_RADIUS + 6);
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
      <div class="course-map-background" aria-hidden="true"></div>
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
              aria-label="${escapeHtml(node.title)}，结点 ${escapeHtml(node.id)}${node.hasDocument ? '，已挂载文档' : ''}"
            >
              <span class="course-map-hologram">
                <span class="course-map-node-id">${escapeHtml(node.id)}</span>
                <strong>${escapeHtml(node.title)}</strong>
              </span>
              <span class="course-map-beacon" aria-hidden="true">
                <span></span>
              </span>
            </button>
          `;
        })
        .join('')}
    `;
    setBackgroundSurface();
    bindNodeEvents();
    renderEdgeList();
  }

  function updateEdgeGeometry() {
    canvas?.querySelectorAll('[data-edge-index]').forEach((pathNode) => {
      pathNode.setAttribute('d', edgePath(state.edges[Number(pathNode.dataset.edgeIndex)]));
    });
  }

  function syncCanvasDimensions() {
    if (!canvas) {
      return;
    }
    const dimensions = mapDimensions();
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;
    const edgesSvg = canvas.querySelector('.course-map-edges');
    edgesSvg?.setAttribute('width', String(dimensions.width));
    edgesSvg?.setAttribute('height', String(dimensions.height));
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
      setSaveState('连接已创建');
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
    openStudioPanel('course-node-panel');
    nodePanel?.classList.remove('hidden');
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
        if (Date.now() < state.suppressClickUntil) {
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
      nodeElement.addEventListener('keydown', (event) => {
        const direction = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        }[event.key];
        if (!direction || state.edgeTool) {
          return;
        }
        event.preventDefault();
        const node = nodeById(nodeElement.dataset.nodeId);
        if (!node) {
          return;
        }
        const previousPosition = { ...node.position };
        const step = event.shiftKey ? 12 : 1;
        node.position.x = Math.max(70, node.position.x + direction[0] * step);
        node.position.y = Math.max(NODE_LABEL_HEIGHT + 24, node.position.y + direction[1] * step);
        nodeElement.style.left = `${node.position.x}px`;
        nodeElement.style.top = `${node.position.y}px`;
        syncCanvasDimensions();
        updateEdgeGeometry();
        if (state.selectedNodeId === node.id) {
          document.getElementById('course-node-x').value = node.position.x;
          document.getElementById('course-node-y').value = node.position.y;
        }
        queuePositionSave(node, { ...node.position }, previousPosition);
      });
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
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startX: node.position.x,
          startY: node.position.y,
          moved: false,
        };
        nodeElement.setPointerCapture(event.pointerId);
        nodeElement.classList.add('is-dragging');
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
        state.drag.node.position.x = Math.max(70, Math.round(state.drag.startX + dx));
        state.drag.node.position.y = Math.max(
          NODE_LABEL_HEIGHT + 24,
          Math.round(state.drag.startY + dy),
        );
        nodeElement.style.left = `${state.drag.node.position.x}px`;
        nodeElement.style.top = `${state.drag.node.position.y}px`;
        syncCanvasDimensions();
        updateEdgeGeometry();
      });
      nodeElement.addEventListener('pointerup', (event) => {
        if (!state.drag || state.drag.element !== nodeElement) {
          return;
        }
        const drag = state.drag;
        state.drag = null;
        nodeElement.classList.remove('is-dragging');
        if (nodeElement.hasPointerCapture(event.pointerId)) {
          nodeElement.releasePointerCapture(event.pointerId);
        }
        if (!drag.moved) {
          return;
        }
        state.suppressClickUntil = Date.now() + 260;
        const savedPosition = { ...drag.node.position };
        if (state.selectedNodeId === drag.node.id) {
          document.getElementById('course-node-x').value = savedPosition.x;
          document.getElementById('course-node-y').value = savedPosition.y;
        }
        queuePositionSave(drag.node, savedPosition, {
          x: drag.startX,
          y: drag.startY,
        });
      });
      const cancelDrag = () => {
        if (!state.drag || state.drag.element !== nodeElement) {
          return;
        }
        const drag = state.drag;
        state.drag = null;
        drag.node.position.x = drag.startX;
        drag.node.position.y = drag.startY;
        nodeElement.style.left = `${drag.startX}px`;
        nodeElement.style.top = `${drag.startY}px`;
        nodeElement.classList.remove('is-dragging');
        syncCanvasDimensions();
        updateEdgeGeometry();
        setSaveState('已取消移动');
      };
      nodeElement.addEventListener('pointercancel', cancelDrag);
      nodeElement.addEventListener('lostpointercapture', cancelDrag);
    });
  }

  function queuePositionSave(node, position, previousPosition) {
    setSaveState(`正在保存 ${node.id} 的位置…`);
    const previousQueue = positionSaveQueues.get(node.id) || Promise.resolve();
    const nextQueue = previousQueue
      .catch(() => {})
      .then(async () => {
        try {
          await updateNode(node, position);
          if (node.position.x === position.x && node.position.y === position.y) {
            setSaveState(
              `已保存 · ${new Date().toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}`,
            );
          }
        } catch (error) {
          if (node.position.x === position.x && node.position.y === position.y) {
            node.position = { ...previousPosition };
            renderMap();
          }
          setSaveState(error.message, true);
          setEdgeStatus(`位置保存失败：${error.message}`, true);
        }
      })
      .finally(() => {
        if (positionSaveQueues.get(node.id) === nextQueue) {
          positionSaveQueues.delete(node.id);
        }
      });
    positionSaveQueues.set(node.id, nextQueue);
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
    state.edgeTool = '';
    state.edgeSource = '';
    openStudioPanel('course-node-panel');
    nodePanel?.classList.remove('hidden');
    nodeForm.classList.remove('hidden');
    document.getElementById('course-node-form-title').textContent = '添加知识结点';
    const idInput = document.getElementById('course-node-id');
    idInput.value = '';
    idInput.readOnly = false;
    document.getElementById('course-node-title').value = '';
    document.getElementById('course-node-summary').value = '';
    document.getElementById('course-node-x').value = Math.max(
      70,
      Math.round(scroller.scrollLeft + scroller.clientWidth / 2),
    );
    document.getElementById('course-node-y').value = Math.max(
      NODE_LABEL_HEIGHT + 24,
      Math.round(scroller.scrollTop + scroller.clientHeight / 2),
    );
    document.getElementById('course-delete-node').classList.add('hidden');
    document.getElementById('course-document-edit-link').classList.add('hidden');
    setNodeMessage('结点 ID 创建后不可修改。');
    updateToolState();
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

  async function updateNode(node, position = node.position) {
    await app.callApi(
      `/courses/${encodeURIComponent(courseSlug)}/map/nodes/${encodeURIComponent(node.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          title: node.title,
          summary: node.summary,
          position,
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
        setSaveState('结点已创建');
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
        setSaveState('结点已保存');
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
      closeStudioPanels();
      renderMap();
      setEdgeStatus(`已删除 ${node.id}。`);
      setSaveState('结点已删除');
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
      setSaveState('连接已删除');
    } catch (error) {
      setEdgeStatus(error.message, true);
    }
  }

  function updateToolState() {
    document.querySelectorAll('[data-edge-tool]').forEach((tool) => {
      const toolValue = tool.dataset.edgeTool;
      const isActive = toolValue === 'none' ? !state.edgeTool : toolValue === state.edgeTool;
      tool.classList.toggle('is-active', isActive);
      tool.setAttribute('aria-pressed', String(isActive));
    });
    scroller?.classList.toggle('is-connecting', Boolean(state.edgeTool));
  }

  async function saveBackground(body) {
    setSaveState('正在更新地图背景…');
    try {
      const payload = await app.callApi(
        `/courses/${encodeURIComponent(courseSlug)}/map/background`,
        {
          method: 'PUT',
          body: JSON.stringify(body),
        },
      );
      state.backgroundUrl = payload.backgroundUrl || '';
      setBackgroundSurface();
      setSaveState(state.backgroundUrl ? '地图背景已更新' : '已恢复默认背景');
    } catch (error) {
      setSaveState(error.message, true);
      setEdgeStatus(`背景更新失败：${error.message}`, true);
    }
  }

  async function uploadBackground(file) {
    if (!file?.type.startsWith('image/')) {
      setEdgeStatus('请选择图片文件。', true);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setEdgeStatus('背景图片需在 20MB 以内。', true);
      return;
    }
    setSaveState('正在处理背景图片…');
    try {
      const imageDataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取背景图片失败'));
        reader.readAsDataURL(file);
      });
      await saveBackground({ imageDataUrl });
    } catch (error) {
      setSaveState(error.message, true);
    }
  }

  function bindCanvasPanning() {
    if (!scroller) {
      return;
    }
    let pan = null;
    scroller.addEventListener('pointerdown', (event) => {
      if (
        event.button !== 0 ||
        state.edgeTool ||
        event.target.closest('.course-map-node') ||
        event.target.closest('button, a, input, textarea')
      ) {
        return;
      }
      pan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: scroller.scrollLeft,
        scrollTop: scroller.scrollTop,
      };
      scroller.setPointerCapture(event.pointerId);
      scroller.classList.add('is-panning');
    });
    scroller.addEventListener('pointermove', (event) => {
      if (!pan || pan.pointerId !== event.pointerId) {
        return;
      }
      scroller.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
      scroller.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
    });
    const finishPan = (event) => {
      if (!pan || pan.pointerId !== event.pointerId) {
        return;
      }
      pan = null;
      scroller.classList.remove('is-panning');
      if (scroller.hasPointerCapture(event.pointerId)) {
        scroller.releasePointerCapture(event.pointerId);
      }
    };
    scroller.addEventListener('pointerup', finishPan);
    scroller.addEventListener('pointercancel', finishPan);
    if ('ResizeObserver' in window) {
      new ResizeObserver(syncCanvasDimensions).observe(scroller);
    } else {
      window.addEventListener('resize', syncCanvasDimensions);
    }
  }

  function bindEditorControls() {
    document.getElementById('course-add-node-button')?.addEventListener('click', beginCreateNode);
    nodeForm?.addEventListener('submit', saveNodeForm);
    document.getElementById('course-delete-node')?.addEventListener('click', deleteSelectedNode);
    document
      .getElementById('course-edge-panel-toggle')
      ?.addEventListener('click', () =>
        openStudioPanel('course-edge-panel', 'course-edge-panel-toggle', true),
      );
    document.getElementById('course-background-panel-toggle')?.addEventListener('click', () => {
      openStudioPanel('course-background-panel', 'course-background-panel-toggle', true);
      setBackgroundSurface();
    });
    document.querySelectorAll('[data-close-studio-panel]').forEach((button) => {
      button.addEventListener('click', closeStudioPanels);
    });
    document.querySelectorAll('[data-edge-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        state.edgeTool = button.dataset.edgeTool === 'none' ? '' : button.dataset.edgeTool;
        state.edgeSource = '';
        updateToolState();
        setEdgeStatus(
          state.edgeTool
            ? `已选择${state.edgeTool === 'ordered' ? '顺序箭头' : '关联虚线'}，请点击起点。`
            : '拖拽光点移动结点 · 拖拽空白处平移画布',
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
    const backgroundInput = document.getElementById('course-map-background-input');
    document.getElementById('course-map-background-upload')?.addEventListener('click', () => {
      backgroundInput?.click();
    });
    backgroundInput?.addEventListener('change', (event) => {
      uploadBackground(event.target.files?.[0]);
      event.target.value = '';
    });
    document.getElementById('course-map-background-clear')?.addEventListener('click', () => {
      saveBackground({ backgroundUrl: '' });
    });
    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isEditingField =
        target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      if (event.key === 'Escape') {
        if (state.edgeTool) {
          state.edgeTool = '';
          state.edgeSource = '';
          updateToolState();
          renderMap();
          setEdgeStatus('已退出连接模式。');
        } else {
          closeStudioPanels();
        }
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        state.selectedNodeId &&
        !isEditingField
      ) {
        event.preventDefault();
        deleteSelectedNode();
      }
    });
    bindCanvasPanning();
    updateToolState();
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
      state.backgroundUrl = payload.backgroundUrl || '';
      if (editorPage && !state.course.canEditMap) {
        renderEditorHeader();
        renderMap();
        setStatus('你不是该课程的资料负责人，无法编辑这张地图。', true);
        editorPage.classList.add('is-readonly');
        editorPage.querySelectorAll('button, input, textarea').forEach((control) => {
          control.disabled = true;
        });
        return;
      }
      if (mapPage) {
        renderReaderHeader();
      } else {
        renderEditorHeader();
        bindEditorControls();
      }
      renderMap();
      setSaveState(editorPage ? '所有修改会自动保存' : '');
      setStatus(state.nodes.length ? '' : '这门课程的知识地图还是空的。');
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  initialize();
})();
