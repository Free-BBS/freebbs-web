(() => {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  function create(container, callbacks) {
    const model = globalThis.FreeBbsCircuitAnnotations;
    let result = null;
    let display = null;
    let editable = false;
    let selectedId = '';
    let adding = false;
    let picking = false;
    let identity = '';
    let selectedSnapshot = '';
    let pendingListAction = null;
    let deferredChange = false;
    container.innerHTML = `<div class="circuit-section-heading"><h3>标记与注释</h3><div class="circuit-actions"><button type="button" data-annotation-pick aria-pressed="false">在图上选点</button><button type="button" data-annotation-new>按坐标添加</button></div></div><p data-annotation-help class="circuit-parameter-hint">点击“在图上选点”，再点击或轻触曲线。标记保留真实采样点，注释随图像一起保存。</p><p data-annotation-error class="circuit-status is-error" role="status" hidden></p><form data-annotation-form hidden><div class="circuit-annotation-fields"><label>标记曲线<select data-annotation-field="traceId"></select></label><label><span data-annotation-coordinate>采样坐标</span><input type="number" step="any" data-annotation-field="at" required /></label><label>测量类型<select data-annotation-field="axis"><option value="value">数值 / 幅值</option><option value="phase">相位</option></select></label></div><label>注释（可留空）<textarea data-annotation-field="text" maxlength="160" rows="2" placeholder="例如：输出峰值、开始衰减、相位交点"></textarea></label><div class="circuit-actions"><button type="submit" data-annotation-apply>添加标记</button><button type="button" data-annotation-cancel>完成</button></div></form><ol data-annotation-list class="circuit-annotation-list"></ol>`;
    const field = (key) => container.querySelector(`[data-annotation-field="${key}"]`);
    const form = container.querySelector('[data-annotation-form]');
    const pickButton = container.querySelector('[data-annotation-pick]');
    const list = container.querySelector('[data-annotation-list]');
    const errorNode = container.querySelector('[data-annotation-error]');
    function error(message = '') {
      errorNode.textContent = message;
      errorNode.hidden = !message;
    }
    function setPicking(value) {
      const changed = picking !== Boolean(value && editable && result && display);
      picking = Boolean(value && editable && result && display);
      pickButton.setAttribute('aria-pressed', String(picking));
      pickButton.textContent = picking ? '取消选点' : '在图上选点';
      container.querySelector('[data-annotation-help]').textContent = !editable
        ? '复制为新电路后可添加或修改标记。'
        : picking
          ? '点击或轻触图中的采样点添加标记；拖动画面不会添加。按 Esc 取消。'
          : '标记绑定真实采样点；修改图像或采样范围后，无法显示的标记会在下方说明原因。';
      if (changed) callbacks.onPickingChange?.(picking);
    }
    function setEditable(value) {
      editable = Boolean(value);
      container.querySelectorAll('input,select,textarea,button').forEach((input) => {
        const node = input;
        node.disabled =
          !editable &&
          !node.hasAttribute('data-annotation-select') &&
          !node.hasAttribute('data-annotation-cancel');
      });
      setPicking(picking);
    }
    function nextId() {
      const ids = new Set((display.annotations || []).map((item) => item.id));
      let number = 1;
      while (ids.has(`A${number}`)) number += 1;
      return `A${number}`;
    }
    function format(value, unit = '') {
      return globalThis.FreeBbsCircuitRenderer.formatValue(value, unit);
    }
    function redrawList() {
      list.innerHTML = (display.annotations || [])
        .map((item, index) => {
          const point = model.resolve(item, result, display);
          const coordinates = point.error
            ? point.error
            : `${format(point.at, result.xUnit)} · ${item.mode === 'xy' ? `X ${format(point.x, point.xUnit)} · ` : ''}${format(point.y, point.yUnit)}`;
          return `<li data-annotation-row="${escape(item.id)}"><button type="button" data-annotation-select="${escape(item.id)}" aria-label="编辑标记 ${escape(item.id)}" class="circuit-annotation-entry"><strong>${index + 1}. ${escape(item.id)} · ${escape(item.traceId)}${item.axis === 'phase' ? ' · 相位' : ''}</strong><span>${escape(item.text || '无注释')}</span><small class="${point.error ? 'is-error' : ''}">${escape(coordinates)}</small></button><button type="button" data-annotation-delete="${escape(item.id)}" aria-label="删除标记 ${escape(item.id)}" ${editable ? '' : 'disabled'}>删除</button></li>`;
        })
        .join('');
    }
    function populate(item) {
      const traces = result.traces.filter((trace) =>
        display.mode === 'xy'
          ? trace.id === (display.xyY || display.ch2)
          : display.traceIds.includes(trace.id),
      );
      if (item?.traceId && !traces.some((trace) => trace.id === item.traceId)) {
        traces.push(
          result.traces.find((trace) => trace.id === item.traceId) || {
            id: item.traceId,
            label: `${item.traceId}（当前未显示）`,
          },
        );
      }
      const traceSelect = field('traceId');
      traceSelect.innerHTML = traces
        .map((trace) => `<option value="${escape(trace.id)}">${escape(trace.label)}</option>`)
        .join('');
      traceSelect.value = item?.traceId || traces[0]?.id || '';
      const setValue = (key, value) => {
        if (field(key).value !== String(value)) field(key).value = value;
      };
      setValue('at', item?.at ?? result.x[0] ?? 0);
      setValue('axis', item?.axis || 'value');
      field('axis').querySelector('[value="phase"]').disabled = !(
        result.analysis.type === 'ac' &&
        display.mode === 'xt' &&
        display.phase
      );
      setValue('text', item?.text || '');
      container.querySelector('[data-annotation-coordinate]').textContent =
        `${result.xLabel || '采样坐标'}${result.xUnit ? ` / ${result.xUnit}` : ''}${display.mode === 'xy' ? '（原始采样轴）' : ''}`;
      container.querySelector('[data-annotation-apply]').textContent = adding
        ? '添加标记'
        : '保存注释';
      container.querySelector('[data-annotation-cancel]').textContent = adding ? '取消' : '完成';
      selectedSnapshot = item ? JSON.stringify(item) : '';
      form.hidden = false;
    }
    function update(nextResult, nextDisplay, options = {}) {
      if (!nextResult || !nextDisplay) {
        reset();
        setEditable(false);
        return;
      }
      result = nextResult;
      display = nextDisplay;
      setEditable(options.editable !== false);
      redrawList();
      const nextIdentity = JSON.stringify([
        model.analysisKey(result.analysis),
        display.mode,
        display.xyX,
        display.xyY,
        display.phase,
        display.traceIds,
      ]);
      if (
        !adding &&
        selectedId &&
        !(display.annotations || []).some((item) => item.id === selectedId)
      ) {
        selectedId = '';
        selectedSnapshot = '';
        form.hidden = true;
      }
      if (identity !== nextIdentity) {
        if (identity && adding) error('图像设置已改变，已关闭坐标草稿；尚未提交的标记未保存。');
        identity = nextIdentity;
        selectedId = '';
        selectedSnapshot = '';
        adding = false;
        form.hidden = true;
        if (picking) setPicking(false);
      }
      const selected = (display.annotations || []).find((item) => item.id === selectedId);
      if (!adding && selected && selectedSnapshot !== JSON.stringify(selected)) populate(selected);
      if (!selectedId && !adding) form.hidden = true;
    }
    function current() {
      if (!result || !display) throw new Error('请先运行仿真。');
      if (!form.checkValidity()) {
        form.reportValidity();
        throw new Error('请填写有效的采样坐标，注释最多 160 字。');
      }
      const previous = (display.annotations || []).find((item) => item.id === selectedId);
      const sameAnchor =
        previous &&
        previous.traceId === field('traceId').value &&
        previous.at === Number(field('at').value) &&
        previous.axis === field('axis').value;
      const item = sameAnchor
        ? globalThis.FreeBbsCircuitEngine.normalizeAnnotation({
            ...previous,
            text: field('text').value,
          })
        : model.create(result, display, {
            id: selectedId || nextId(),
            traceId: field('traceId').value,
            at: Number(field('at').value),
            text: field('text').value,
            axis: field('axis').value,
          });
      return item;
    }
    function write(item) {
      const annotations = [...(display.annotations || [])];
      const index = annotations.findIndex((entry) => entry.id === item.id);
      if (index < 0) annotations.push(item);
      else annotations[index] = item;
      if (annotations.length > 32)
        throw new Error('每张图最多保存 32 个标记，请先删除不需要的标记。');
      const next = { ...display, annotations };
      // The parent can reject a change (for example after a concurrent edit). Keep
      // the draft and picking state intact until it accepts the new document.
      callbacks.onChange(next);
      display = next;
      selectedId = item.id;
      adding = false;
      redrawList();
      populate(item);
      error();
    }
    function commitPending() {
      if (!editable || form.hidden) return true;
      try {
        const item = current();
        const previous = (display.annotations || []).find((entry) => entry.id === item.id);
        if (JSON.stringify(previous) !== JSON.stringify(item)) write(item);
        else error();
        return true;
      } catch (reason) {
        error(reason.message);
        return false;
      }
    }
    function pick(point) {
      if (!editable || !result) return;
      try {
        const item = model.create(result, display, { ...point, id: nextId(), text: '' });
        write(item);
        setPicking(false);
        populate(item);
        field('text').focus({ preventScroll: true });
      } catch (reason) {
        error(reason.message);
      }
    }
    function select(id) {
      if (!display || !result || !(display.annotations || []).some((entry) => entry.id === id))
        return;
      if (!commitPending()) return;
      const item = (display.annotations || []).find((entry) => entry.id === id);
      selectedId = id;
      adding = false;
      populate(item);
      setEditable(editable);
      if (editable) field('text').focus({ preventScroll: true });
    }
    function reset() {
      result = null;
      display = null;
      selectedId = '';
      selectedSnapshot = '';
      adding = false;
      identity = '';
      pendingListAction = null;
      deferredChange = false;
      form.hidden = true;
      list.innerHTML = '';
      error();
      setPicking(false);
    }
    pickButton.addEventListener('click', () => {
      if (commitPending()) setPicking(!picking);
    });
    container.querySelector('[data-annotation-new]').addEventListener('click', () => {
      if (!editable || !result || !display || !commitPending()) return;
      if ((display.annotations || []).length >= 32) {
        error('每张图最多保存 32 个标记。');
        return;
      }
      setPicking(false);
      selectedId = '';
      selectedSnapshot = '';
      adding = true;
      error();
      populate(null);
      field('at').focus({ preventScroll: true });
    });
    container.querySelector('[data-annotation-cancel]').addEventListener('click', () => {
      // A new coordinate form can be cancelled; existing text edits are kept.
      if (!adding && !commitPending()) return;
      adding = false;
      selectedId = '';
      selectedSnapshot = '';
      form.hidden = true;
      error();
      setPicking(false);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      commitPending();
    });
    field('text').addEventListener('input', () => {
      if (!adding) commitPending();
    });
    ['traceId', 'at', 'axis'].forEach((key) =>
      field(key).addEventListener('change', () => {
        if (pendingListAction) {
          deferredChange = true;
          return;
        }
        if (!adding) commitPending();
      }),
    );
    // Pressing a list button blurs the coordinate field before click. Defer that
    // change so a synchronous parent redraw cannot remove the pressed button.
    const beginListAction = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const target = event.target.closest('[data-annotation-select], [data-annotation-delete]');
      if (target && !target.disabled) pendingListAction = target;
    };
    const cancelListAction = () => {
      pendingListAction = null;
      if (deferredChange) {
        deferredChange = false;
        if (!adding) commitPending();
      }
    };
    const releaseListAction = (event) => {
      if (pendingListAction && !pendingListAction.contains(event.target)) cancelListAction();
    };
    list.addEventListener('pointerdown', beginListAction);
    list.addEventListener('mousedown', beginListAction);
    document.addEventListener('pointerup', releaseListAction);
    document.addEventListener('mouseup', releaseListAction);
    document.addEventListener('pointercancel', cancelListAction);
    list.addEventListener('click', (event) => {
      const target = event.target.closest('[data-annotation-select], [data-annotation-delete]');
      if (!target) return;
      pendingListAction = null;
      deferredChange = false;
      if (target.hasAttribute('data-annotation-select')) select(target.dataset.annotationSelect);
      else if (editable) {
        const id = target.dataset.annotationDelete;
        try {
          const next = {
            ...display,
            annotations: (display.annotations || []).filter((item) => item.id !== id),
          };
          callbacks.onChange(next);
          display = next;
          if (selectedId === id) {
            selectedId = '';
            selectedSnapshot = '';
            adding = false;
            form.hidden = true;
          }
          redrawList();
          error();
        } catch (reason) {
          error(reason.message);
        }
      }
    });
    container.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cancelListAction();
      if (event.key === 'Escape' && picking) {
        event.preventDefault();
        setPicking(false);
      }
    });
    return {
      update,
      pick,
      select,
      reset,
      setEditable,
      commitPending,
      togglePicking: () => {
        if (commitPending()) setPicking(!picking);
      },
      cancelPicking: () => setPicking(false),
    };
  }
  globalThis.FreeBbsCircuitAnnotationControls = { create };
})();
