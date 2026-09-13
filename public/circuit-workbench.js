(() => {
  const app = window.freeBbsApp;
  const plot = window.FreeBbsCircuitPlot;
  const renderer = window.FreeBbsCircuitRenderer;
  const editor = () => window.FreeBbsCircuitEditor;
  const escape = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const clone = (s) => JSON.parse(JSON.stringify(s));
  const status = (node, text) => {
    node.textContent = text;
  };
  const panels = document.getElementById('circuit-extra-plots');
  const activePanels = [];
  let base;
  let display;
  function updatePanels(result, settings) {
    if (!panels) return;
    base = result;
    display = settings;
    const extra = settings.plots || [];
    while (activePanels.length > extra.length) {
      const removed = activePanels.pop();
      removed.chart?.destroy();
      removed.controls.destroy();
      removed.section.remove();
    }
    extra.forEach((config, index) => {
      let item = activePanels[index];
      if (!item) {
        const section = document.createElement('section');
        section.className = 'circuit-extra-plot';
        section.innerHTML = `<div class="circuit-actions"><label>图标题<input data-title maxlength="80" aria-label="图 ${index + 2} 标题"></label><button type="button" data-remove>删除此图</button></div><div data-controls></div><fieldset><legend>显示曲线</legend><div data-traces></div></fieldset><p data-warning role="status"></p><div data-chart></div>`;
        panels.append(section);
        item = {
          section,
          controls: window.FreeBbsCircuitPlotControls.create(
            section.querySelector('[data-controls]'),
            (next) => changePanel(index, next),
          ),
        };
        activePanels.push(item);
        section
          .querySelector('[data-title]')
          .addEventListener('change', (event) =>
            changePanel(index, { ...display.plots[index], title: event.target.value }),
          );
        section.querySelector('[data-remove]').addEventListener('click', () => {
          const next = clone(display);
          next.plots.splice(index, 1);
          editor().updateDisplay(next);
        });
        section.querySelector('[data-traces]').addEventListener('change', () =>
          changePanel(index, {
            ...display.plots[index],
            traceIds: [...section.querySelectorAll('[data-trace]:checked')].map(
              (input) => input.dataset.trace,
            ),
          }),
        );
      }
      const prepared = plot.buildResult(result, config);
      item.controls.update(prepared.result, config);
      const title = item.section.querySelector('[data-title]');
      if (title !== document.activeElement) title.value = config.title || `图 ${index + 2}`;
      item.section.querySelector('[data-traces]').innerHTML = prepared.result.traces
        .map(
          (trace) =>
            `<label class="circuit-inline-check"><input type="checkbox" data-trace="${escape(trace.id)}" ${config.traceIds.includes(trace.id) ? 'checked' : ''}>${escape(trace.label)}</label>`,
        )
        .join('');
      status(item.section.querySelector('[data-warning]'), prepared.warnings.join('；'));
      item.chart?.destroy();
      item.chart = renderer.renderWaveform(
        item.section.querySelector('[data-chart]'),
        prepared.result,
        config,
      );
    });
    document.getElementById('circuit-add-plot').disabled = extra.length >= 5;
  }
  function changePanel(index, next) {
    const settings = clone(display);
    settings.plots[index] = next;
    editor().updateDisplay(settings);
  }
  window.FreeBbsCircuitPanels = {
    update: updatePanels,
    validate: () => activePanels.every((item) => item.controls.validate()),
    read: () => activePanels.map((item) => item.controls.read()),
  };
  document.getElementById('circuit-add-plot')?.addEventListener('click', () => {
    if (!base || (display.plots || []).length >= 5) return;
    const { plots, ...primary } = clone(display);
    editor().updateDisplay({
      ...display,
      plots: [
        ...(plots || []),
        { ...primary, title: `图 ${(plots || []).length + 2}`, annotations: [] },
      ],
    });
    activePanels.at(-1)?.section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const sourceDialog = document.getElementById('circuit-source-dialog');
  let sourceContext;
  let sourceColumns = [];
  const sourceStatus = sourceDialog?.querySelector('[data-status]');
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-import-source]');
    if (!button) return;
    sourceContext = { id: button.dataset.importSource, snapshot: editor().getSnapshot() };
    sourceColumns = [];
    sourceDialog.querySelector('[data-file]').value = '';
    sourceDialog.querySelector('[data-mapping]').hidden = true;
    status(
      sourceStatus,
      'CSV 第一列通常是时间（秒），其余列为 V / A；也可选择 MAT 数组或 .m 数值数组。',
    );
    sourceDialog.showModal();
  });
  sourceDialog?.querySelector('[data-file]').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const context = sourceContext;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('文件不能超过 4 MB。');
      const api = window.FreeBbsWaveformImport;
      const arrays = /\.mat$/i.test(file.name)
        ? await api.matArrays(await file.arrayBuffer())
        : api.textArrays(await file.text(), /\.m$/i.test(file.name));
      if (context !== sourceContext || !sourceDialog.open) return;
      sourceColumns = api.columns(arrays);
      const options = sourceColumns
        .map((c, i) => `<option value="${i}">${escape(c.name)} · ${c.values.length} 点</option>`)
        .join('');
      sourceDialog.querySelector('[data-time]').innerHTML = options;
      sourceDialog.querySelector('[data-values]').innerHTML = options;
      sourceDialog.querySelector('[data-values]').value = String(
        Math.min(1, sourceColumns.length - 1),
      );
      sourceDialog.querySelector('[data-mapping]').hidden = false;
      status(sourceStatus, `已读取 ${file.name}。选择时间列与波形列后应用。`);
    } catch (error) {
      status(sourceStatus, error.message);
    }
  });
  sourceDialog?.querySelector('[data-apply]').addEventListener('click', () => {
    try {
      const samples = window.FreeBbsWaveformImport.pair(
        sourceColumns[Number(sourceDialog.querySelector('[data-time]').value)].values,
        sourceColumns[Number(sourceDialog.querySelector('[data-values]').value)].values,
      );
      editor().importSource(sourceContext.id, samples, sourceContext.snapshot);
      sourceDialog.close();
    } catch (error) {
      status(sourceStatus, error.message);
    }
  });
  sourceDialog?.querySelector('[data-close]').addEventListener('click', () => sourceDialog.close());

  const historyDialog = document.getElementById('circuit-history-dialog');
  const historyStatus = historyDialog?.querySelector('[data-status]');
  let historyCid = '';
  let historyGeneration = 0;
  let oldest = null;
  async function history(more = false) {
    const snapshot = editor().getSnapshot();
    historyGeneration += 1;
    const generation = historyGeneration;
    historyCid = snapshot.cid;
    if (!more) {
      historyDialog.querySelector('[data-more]').hidden = true;
      historyDialog.querySelector('[data-branches]').replaceChildren();
    }
    if (!more) historyDialog.querySelector('[data-log]').replaceChildren();
    if (!snapshot.cid) {
      status(historyStatus, '保存电路后，即可创建存档和实验分支。');
      return;
    }
    status(historyStatus, '读取版本历史…');
    try {
      const response = await app.callApi(
        `/circuits/${snapshot.cid}/history${more && oldest ? `?before=${oldest}` : ''}`,
        { method: 'GET' },
      );
      if (generation !== historyGeneration) return;
      historyDialog
        .querySelector('[data-log]')
        .insertAdjacentHTML(
          'beforeend',
          response.entries
            .map(
              (entry) =>
                `<li><span class="circuit-log-dot"></span><div><strong>v${entry.revision} ${entry.revision === snapshot.revision ? '· 当前' : ''}</strong><span class="circuit-log-kind">${entry.kind === 'fork' ? 'fork' : entry.kind === 'restore' ? '恢复' : '存档'}</span><p>${escape(entry.message || entry.title)}</p><small>${escape(new Date(entry.createdAt).toLocaleString())}</small>${entry.sourceCid ? `<p>源自 <a href="/circuit?cid=${encodeURIComponent(entry.sourceCid)}&revision=${entry.sourceRevision}">${escape(entry.sourceCid)} · v${entry.sourceRevision}</a></p>` : ''}<div class="circuit-actions"><a href="/circuit?cid=${snapshot.cid}&revision=${entry.revision}" target="_blank" rel="noopener">查看</a><button data-fork="${entry.revision}">从此 fork</button>${snapshot.canEdit ? `<button data-restore="${entry.revision}">恢复此版本</button>` : ''}</div></div></li>`,
            )
            .join(''),
        );
      oldest = response.entries.at(-1)?.revision;
      historyDialog.querySelector('[data-more]').hidden = !response.hasMore;
      historyDialog.querySelector('[data-branches]').innerHTML = response.branches.length
        ? `<h3>实验分支</h3>${response.branches.map((b) => `<p>↳ <a href="/circuit?cid=${b.cid}">${escape(b.title)}</a> · 从 v${b.sourceRevision}</p>`).join('')}`
        : '';
      status(historyStatus, '恢复会产生新版本，已有存档仍可查看。未保存的修改会先存档。');
    } catch (error) {
      status(historyStatus, error.message);
    }
  }
  document.getElementById('circuit-history-open')?.addEventListener('click', () => {
    historyDialog.showModal();
    history();
  });
  historyDialog
    ?.querySelector('[data-close]')
    .addEventListener('click', () => historyDialog.close());
  historyDialog?.querySelector('[data-more]').addEventListener('click', () => history(true));
  historyDialog?.querySelector('[data-checkpoint]').addEventListener('click', async () => {
    const saved = await editor().save({
      message: historyDialog.querySelector('[data-message]').value || '手动存档',
    });
    if (saved) await history();
    else status(historyStatus, '未能存档，请检查电路参数和登录状态。');
  });
  historyDialog?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-fork], [data-restore]');
    if (!button || button.disabled) return;
    const before = editor().getSnapshot();
    if (before.cid !== historyCid) return;
    const kind = button.hasAttribute('data-fork') ? 'fork' : 'restore';
    const revision = Number(button.dataset[kind]);
    button.disabled = true;
    try {
      if (kind === 'restore' && before.dirty) {
        if (!(await editor().save({ message: '恢复前自动存档' })))
          throw new Error('当前修改未能保存，恢复已停止。');
      }
      const current = editor().getSnapshot();
      if (current.cid !== before.cid || current.generation !== before.generation)
        throw new Error('电路已切换，请重新打开版本历史。');
      const response = await app.callApi(`/circuits/${before.cid}/${kind}`, {
        method: 'POST',
        body: JSON.stringify({
          revision,
          expectedRevision: current.revision,
          message: historyDialog.querySelector('[data-message]').value || undefined,
        }),
      });
      if (kind === 'fork') {
        status(historyStatus, '实验分支已创建。');
        // Open the saved fork without discarding the original tab’s working draft.
        const link = document.createElement('a');
        link.href = `/circuit?cid=${response.circuit.cid}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = '打开新的实验分支 →';
        historyStatus.append(document.createTextNode(' '), link);
      } else {
        await editor().reload(response.circuit.cid);
        await history();
      }
    } catch (error) {
      status(historyStatus, error.message);
    } finally {
      button.disabled = false;
    }
  });
})();
