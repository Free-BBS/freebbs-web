(() => {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  function create(container, onChange) {
    let display;
    let result;
    let pendingAction = null;
    let deferredChange = false;
    let structure = '';
    const field = (key) => container.querySelector(`[data-plot-field="${key}"]`);
    function choicesFor(traces, value) {
      const choices = [...traces];
      if (!value) choices.unshift({ id: '', label: '未选择', unit: '' });
      if (value && !choices.some((trace) => trace.id === value))
        choices.unshift({ id: value, label: `${value}（通道不存在）`, unit: '' });
      return choices;
    }
    function select(key, label, traces, value) {
      const choices = choicesFor(traces, value);
      return `<label>${label}<select data-plot-field="${key}">${choices.map((trace) => `<option value="${escape(trace.id)}" ${trace.id === value ? 'selected' : ''}>${escape(trace.label)}${trace.unit ? ` / ${escape(trace.unit)}` : ''}</option>`).join('')}</select></label>`;
    }
    function update(nextResult, nextDisplay) {
      result = nextResult;
      display = nextDisplay;
      const active = container.contains(document.activeElement) ? document.activeElement : null;
      const focusedKey = active?.dataset.plotField;
      const focusedMath = active?.dataset.mathField;
      const focusedId = active?.closest('[data-math-id]')?.dataset.mathId;
      const selection =
        active?.type === 'text' ? [active.selectionStart, active.selectionEnd] : null;
      const mathOpen =
        container.querySelector('[data-plot-math]')?.open ?? Boolean(display.math.length);
      const rangesOpen = container.querySelector('[data-plot-ranges]')?.open ?? false;
      const physical = result.traces.filter((trace) => !trace.id.startsWith('M:'));
      const axisNames =
        display.mode === 'xy' ? ['X', 'Y'] : [result.xLabel || '横轴', '纵轴（各单位）'];
      const choices = Object.fromEntries(
        ['ch1', 'ch2', 'xyX', 'xyY'].map((key) => [
          key,
          choicesFor(key.startsWith('ch') ? physical : result.traces, display[key]),
        ]),
      );
      const nextStructure = JSON.stringify([
        display.mode,
        result.analysis?.type,
        axisNames,
        display.math.map((item) => item.id),
        Object.values(choices).map((items) => items.map((item) => item.id)),
      ]);
      if (structure === nextStructure) {
        // Keep ordinary edits in the same controls: replacing them during blur/change
        // would swallow the click or Tab navigation into the next input/select.
        const setValue = (input, value) => {
          const text = String(value ?? '');
          if (input && input.value !== text) input.value = text;
        };
        ['mode', 'ch1', 'ch2', 'xyX', 'xyY'].forEach((key) => {
          const input = field(key);
          setValue(input, display[key]);
          if (input && choices[key])
            input.querySelectorAll('option').forEach((option, index) => {
              const item = choices[key][index];
              option.textContent = `${item.label}${item.unit ? ` / ${item.unit}` : ''}`;
            });
        });
        ['xMin', 'xMax', 'yMin', 'yMax'].forEach((key) =>
          setValue(field(key), display.ranges[key]),
        );
        container.querySelectorAll('[data-math-id]').forEach((row, index) => {
          ['label', 'expression', 'unit'].forEach((key) =>
            setValue(row.querySelector(`[data-math-field="${key}"]`), display.math[index][key]),
          );
        });
        if (selection && active?.setSelectionRange) active.setSelectionRange(...selection);
        error('');
        return;
      }
      structure = nextStructure;
      container.innerHTML = `<div class="circuit-plot-channels">
        <label>坐标模式<select data-plot-field="mode"><option value="xt" ${display.mode === 'xt' ? 'selected' : ''}>X–T · 曲线随时间 / 扫描量</option><option value="xy" ${display.mode === 'xy' ? 'selected' : ''}>X–Y · 两通道关系</option></select></label>
        ${select('ch1', 'CH1', physical, display.ch1)}${select('ch2', 'CH2', physical, display.ch2)}
        ${display.mode === 'xy' ? select('xyX', 'X 轴曲线', result.traces, display.xyX) + select('xyY', 'Y 轴曲线', result.traces, display.xyY) : ''}
      </div>
      <p class="circuit-parameter-hint">CH1 / CH2 是数学运算的输入；X–T 显示的曲线由下方勾选项决定。</p>
      ${result.analysis?.type === 'ac' && display.mode === 'xy' ? '<p class="circuit-parameter-hint">AC 的 X–Y 图比较各频点的幅值；观察随时间形成的李萨如图，请使用瞬态分析。</p>' : ''}
      <details data-plot-math ${mathOpen ? 'open' : ''}><summary>数学运算${display.math.length ? ` · ${display.math.length} 条` : ''}</summary>
        <p class="circuit-parameter-hint">用 CH1、CH2 或前面的 M 通道计算，例如 CH1-CH2、CH1/CH2、abs(CH1)。支持 + − * / ^、sqrt、sin、cos、exp、log；瞬态还支持 diff(CH1)、integral(CH1)。AC 按复数相量运算。</p>
        <div class="circuit-math-list">${display.math.map((item) => `<div class="circuit-math-row" data-math-id="${escape(item.id)}"><strong>${escape(item.id)}</strong><label>名称<input type="text" data-math-field="label" maxlength="40" value="${escape(item.label)}" placeholder="${escape(item.id)}" /></label><label class="circuit-math-expression">公式<input type="text" data-math-field="expression" maxlength="160" value="${escape(item.expression)}" spellcheck="false" aria-label="${escape(item.id)} 公式" /></label><label>单位<input type="text" data-math-field="unit" maxlength="12" value="${escape(item.unit)}" placeholder="自动" /></label><button type="button" data-remove-math="${escape(item.id)}" aria-label="删除 ${escape(item.id)} 运算">删除</button></div>`).join('')}</div>
        <button type="button" data-add-math ${display.math.length >= 8 ? 'disabled' : ''}>＋ 添加运算曲线</button>
      </details>
      <details data-plot-ranges ${rangesOpen ? 'open' : ''}><summary>坐标范围 · 留空自动</summary><div class="circuit-plot-ranges">${['xMin', 'xMax', 'yMin', 'yMax'].map((key, index) => `<label>${axisNames[Math.floor(index / 2)]}${index % 2 ? '上限' : '下限'}<input type="number" step="any" data-plot-field="${key}" value="${escape(display.ranges[key])}" placeholder="自动" /></label>`).join('')}</div></details>
      <p class="circuit-status is-error" data-plot-error role="status" hidden></p>`;
      let focus;
      if (focusedKey) focus = field(focusedKey);
      else if (focusedMath && focusedId)
        focus = [...container.querySelectorAll('[data-math-id]')]
          .find((row) => row.dataset.mathId === focusedId)
          ?.querySelector(`[data-math-field="${focusedMath}"]`);
      if (focus) {
        focus.focus({ preventScroll: true });
        if (selection && focus.setSelectionRange) focus.setSelectionRange(...selection);
      }
    }
    function read() {
      const next = JSON.parse(JSON.stringify(display));
      ['mode', 'ch1', 'ch2', 'xyX', 'xyY'].forEach((key) => {
        if (field(key)) next[key] = field(key).value || null;
      });
      ['xMin', 'xMax', 'yMin', 'yMax'].forEach((key) => {
        next.ranges[key] = field(key).value === '' ? null : Number(field(key).value);
      });
      next.math = [...container.querySelectorAll('[data-math-id]')].map((row) => {
        const item = { id: row.dataset.mathId };
        ['label', 'expression', 'unit'].forEach((key) => {
          item[key] = row.querySelector(`[data-math-field="${key}"]`).value.trim();
        });
        globalThis.FreeBbsCircuitPlot.compileExpression(item.expression);
        return item;
      });
      // A removed draft row may still exist in the last accepted display while another
      // field is invalid. Reconcile it when the user finishes fixing the remaining form.
      const removed = new Set(
        display.math
          .filter((item) => !next.math.some((row) => row.id === item.id))
          .map((item) => `M:${item.id}`),
      );
      next.traceIds = next.traceIds.filter((id) => !removed.has(id));
      if (removed.has(next.xyX)) next.xyX = next.ch1;
      if (removed.has(next.xyY)) next.xyY = next.ch2;
      // CH1/CH2 changes also follow the corresponding default XY assignment.
      if (next.ch1 !== display.ch1 && next.xyX === display.ch1) next.xyX = next.ch1;
      if (next.ch2 !== display.ch2 && next.xyY === display.ch2) next.xyY = next.ch2;
      const replacements = new Map();
      ['ch1', 'ch2'].forEach((key) => {
        if (next[key] === display[key] || !display[key]) return;
        const ids = replacements.get(display[key]) || [];
        if (next[key]) ids.push(next[key]);
        replacements.set(display[key], ids);
      });
      next.traceIds = [...new Set(next.traceIds.flatMap((id) => replacements.get(id) || [id]))];
      return globalThis.FreeBbsCircuitEngine.normalizeDisplay(next);
    }
    function error(message) {
      const output = container.querySelector('[data-plot-error]');
      output.hidden = !message;
      output.textContent = message || '';
    }
    function validate() {
      try {
        const invalid = [...container.querySelectorAll('input')].find(
          (input) => !input.checkValidity(),
        );
        if (invalid) {
          invalid.reportValidity();
          return false;
        }
        read();
        error('');
        return true;
      } catch (reason) {
        error(reason.message);
        return false;
      }
    }
    function notify(next) {
      try {
        onChange(next);
        return true;
      } catch (reason) {
        error(reason.message || '无法更新图像设置，请检查输入后重试。');
        return false;
      }
    }
    function beginAction(event) {
      if (event.button !== undefined && event.button !== 0) return;
      const button =
        event.target.closest('[data-remove-math]') || event.target.closest('[data-add-math]');
      if (button && !button.disabled) pendingAction = button;
    }
    function cancelAction() {
      pendingAction = null;
      if (!deferredChange) return;
      deferredChange = false;
      if (validate()) notify(read());
    }
    function releaseAction(event) {
      if (pendingAction && !pendingAction.contains(event.target)) cancelAction();
    }
    // A button press blurs the edited input before click fires. Hold its change until
    // click so the synchronous parent render cannot replace the pressed button.
    container.addEventListener('pointerdown', beginAction);
    container.addEventListener('mousedown', beginAction);
    document.addEventListener('pointerup', releaseAction);
    document.addEventListener('mouseup', releaseAction);
    document.addEventListener('pointercancel', cancelAction);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') cancelAction();
    });
    container.addEventListener('change', () => {
      if (pendingAction) {
        deferredChange = true;
        return;
      }
      if (!validate()) return;
      notify(read());
    });
    container.addEventListener('click', (event) => {
      pendingAction = null;
      deferredChange = false;
      const remove = event.target.closest('[data-remove-math]');
      const add = event.target.closest('[data-add-math]');
      if (!remove && !add) return;
      if (remove) {
        const row = remove.closest('[data-math-id]');
        if (!row) return;
        const index = [...container.querySelectorAll('[data-math-id]')].indexOf(row);
        // Remove first: a blank/invalid formula must not prevent deleting that formula.
        // Keep the remaining DOM intact if another field still needs correcting.
        row.remove();
        const count = container.querySelectorAll('[data-math-id]').length;
        container.querySelector('[data-plot-math] summary').textContent =
          `数学运算${count ? ` · ${count} 条` : ''}`;
        container.querySelector('[data-add-math]').disabled = count >= 8;
        if (validate()) notify(read());
        const inputs = container.querySelectorAll('[data-math-field="expression"]');
        const focus =
          inputs[Math.min(index, inputs.length - 1)] || container.querySelector('[data-add-math]');
        focus?.focus({ preventScroll: true });
        return;
      }
      if (add && validate()) {
        const next = read();
        const highest = Math.max(0, ...next.math.map((item) => Number(item.id.slice(1))));
        const number =
          highest < 8
            ? highest + 1
            : Array.from({ length: 8 }, (_, index) => index + 1).find(
                (index) => !next.math.some((item) => item.id === `M${index}`),
              );
        if (!number) return;
        const id = `M${number}`;
        next.math.push({ id, label: id, expression: 'CH1-CH2', unit: '' });
        const full = next.traceIds.length >= 32;
        if (!full && !next.traceIds.includes(`M:${id}`)) next.traceIds.push(`M:${id}`);
        if (!notify(next)) return;
        if (full) error('运算曲线已添加；当前已选 32 条曲线，请先取消一条再勾选新的运算曲线。');
        container.querySelector('[data-plot-math]').open = true;
        const inputs = container.querySelectorAll('[data-math-field="expression"]');
        inputs[inputs.length - 1]?.focus();
      }
    });
    return { update, validate, read };
  }
  globalThis.FreeBbsCircuitPlotControls = { create };
})();
