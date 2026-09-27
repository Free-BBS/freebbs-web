(() => {
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const names = {
    c: 'C',
    cpp: 'C++',
    python: 'Python',
    matlab: 'MATLAB / Octave',
    verilog: 'Verilog',
  };
  function parseReference(value, origin) {
    try {
      const url = new URL(value, origin);
      if (
        url.origin !== new URL(origin).origin ||
        url.username ||
        url.password ||
        !['/code-lab', '/code-lab.html'].includes(url.pathname) ||
        url.searchParams.getAll('experiment').length !== 1
      )
        return null;
      const id = url.searchParams.get('experiment');
      return /^e_[a-f0-9]{32}$/.test(id || '') ? { id } : null;
    } catch {
      return null;
    }
  }
  function variables(trace) {
    const entries = Array.isArray(trace?.variables) ? trace.variables.slice(0, 100) : [];
    return `<table class="lab-variables"><thead><tr><th>变量</th><th>类型</th><th>值</th><th>作用域</th></tr></thead><tbody>${entries.map((v) => `<tr><td>${escape(v.name)}</td><td>${escape(v.type)}</td><td><code>${escape(v.value)}</code></td><td>${escape(v.scope)}</td></tr>`).join('') || '<tr><td colspan="4">当前还没有变量</td></tr>'}</tbody></table>`;
  }
  function digital(waveform, compact = false) {
    const signals = Array.isArray(waveform?.signals)
      ? waveform.signals.slice(0, compact ? 5 : 40)
      : [];
    if (!signals.length)
      return '<p class="lab-empty">没有波形。请提供带时钟、激励及 $finish 的测试平台。</p>';
    const end = Math.max(1, Number(waveform.end) || 1);
    if (!Number.isFinite(end)) return '';
    const width = compact ? 400 : 1000;
    const height = 38 + signals.length * 54;
    const x = (time) =>
      (compact ? 0 : 180) + Math.max(0, Math.min(1, Number(time) / end)) * (compact ? 400 : 800);
    let body = '';
    for (let i = 0; i <= 5; i += 1) {
      const pos = x((end * i) / 5);
      body += `<line x1="${pos}" x2="${pos}" y1="24" y2="${height}" stroke="currentColor" opacity=".12"/><text x="${pos}" y="17" fill="currentColor" font-size="11" text-anchor="${i === 5 ? 'end' : i === 0 ? 'start' : 'middle'}">${Number(((end * i) / 5).toPrecision(5))}</text>`;
    }
    signals.forEach((signal, index) => {
      const y = 42 + index * 54;
      const values = (Array.isArray(signal.values) ? signal.values : [])
        .filter((v) => Array.isArray(v) && Number.isFinite(v[0]) && v[0] >= 0 && v[0] <= end)
        .slice(0, 2000);
      if (!compact)
        body += `<text x="8" y="${y + 20}" fill="currentColor" font-size="12"><title>${escape(signal.name)}</title>${escape(String(signal.name).slice(-22))}</text>`;
      let previousY;
      values.forEach(([time, raw], j) => {
        const start = x(time);
        const finish = x(values[j + 1]?.[0] ?? end);
        const value = String(raw);
        const bus = Number(signal.width) > 1;
        const unknown = /[xz]/i.test(value);
        const color = unknown ? '#d58a39' : '#159a91';
        if (bus || unknown) {
          body += `<path d="M${start},${y + 14} L${Math.min(start + 4, finish)},${y + 2} H${Math.max(start, finish - 4)} L${finish},${y + 14} L${Math.max(start, finish - 4)},${y + 26} H${Math.min(start + 4, finish)} Z" fill="${color}" fill-opacity=".1" stroke="${color}"/>`;
          if (!compact && finish - start > 22)
            body += `<text x="${start + 6}" y="${y + 18}" fill="currentColor" font-size="11">${escape(value.length > 12 && !unknown ? `0x${BigInt(`0b${value.replace(/[^01]/g, '0')}`).toString(16)}` : value.slice(0, 12))}</text>`;
          previousY = undefined;
        } else {
          const level = y + (value === '1' ? 2 : 26);
          body += `<path d="M${start},${previousY ?? level} V${level} H${finish}" fill="none" stroke="${color}" stroke-width="2"/>`;
          previousY = level;
        }
      });
    });
    return `<div class="lab-wave-scroll"><svg class="lab-wave" viewBox="0 0 ${width} ${height}" role="img" aria-label="数字时序波形，时间单位 ${escape(waveform.timescale)}">${body}</svg></div><p class="lab-hint">时间单位 ${escape(waveform.timescale)} · 0–${end} · 总线以二进制 / 十六进制显示 · 橙色为 X / Z</p>`;
  }
  function figureMarkup(result, compact) {
    return (Array.isArray(result.figures) ? result.figures : [])
      .slice(0, compact ? 1 : 6)
      .filter(
        (src) =>
          typeof src === 'string' &&
          src.length < 330000 &&
          /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src),
      )
      .map(
        (src, i) =>
          `<figure class="lab-figure"><img src="${src}" alt="实验绘图 ${i + 1}" loading="lazy"/><figcaption>图 ${i + 1}</figcaption></figure>`,
      )
      .join('');
  }
  function preview(experiment, compact = false) {
    const { result } = experiment;
    const head = `<div class="lab-preview-heading"><strong>${escape(experiment.title)}</strong><span>${escape(names[experiment.language] || '')}${result ? ` · 退出码 ${escape(result.exitCode)}` : ' · 代码快照'}</span></div>`;
    let content = '';
    if (result?.waveform) content = digital(result.waveform, compact);
    else if (result?.figures?.length) content = figureMarkup(result, compact);
    else if (result?.lastTrace) content = variables(result.lastTrace);
    else if (result?.assembly)
      content = `<pre class="lab-preview-code">${escape(
        result.assembly.x86?.text
          ?.split('\n')
          .filter((line) => !/^\s*(?:[.#]|$)/.test(line))
          .slice(0, compact ? 10 : 20)
          .join('\n'),
      )}</pre><span class="lab-hint">x86-64 · MIPS32 · RISC-V64 汇编已保存</span>`;
    if (!content)
      content = `<pre class="lab-preview-code">${escape(
        String(experiment.source || '')
          .split('\n')
          .slice(0, compact ? 8 : 18)
          .join('\n'),
      )}</pre>`;
    return `<div class="lab-preview${compact ? ' is-compact' : ''}">${head}${content}${!compact && result?.stdout ? `<pre class="lab-console">${escape(result.stdout.slice(0, 4000))}</pre>` : ''}</div>`;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escape, parseReference, digital, variables, preview };
    return;
  }
  let styled = false;
  function styles() {
    if (styled || document.querySelector('link[href="/lab-results.css"]')) return;
    styled = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/lab-results.css';
    document.head.append(link);
  }
  async function load(id, apiBase = '/api') {
    const response = await fetch(`${apiBase}/labs/experiments/${id}`, {
      credentials: 'omit',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('实验预览暂不可用');
    const { experiment } = await response.json();
    if (experiment?.id !== id) throw new Error('实验编号不匹配');
    return experiment;
  }
  const enhanced = new WeakSet();
  function enhance(root, { apiBase = '/api' } = {}) {
    styles();
    let count = root.querySelectorAll('.lab-embed').length;
    for (const link of root.querySelectorAll('a[href]')) {
      const reference = parseReference(link.getAttribute('href'), window.location.origin);
      if (!reference || enhanced.has(link) || link.closest('pre, code, .lab-embed') || count >= 6)
        continue;
      enhanced.add(link);
      count += 1;
      const wrapper = document.createElement('span');
      wrapper.className = 'lab-embed';
      const content = document.createElement('span');
      content.textContent = '正在载入实验快照…';
      link.replaceWith(wrapper);
      wrapper.append(content, link);
      link.textContent = '打开实验 · 查看代码与完整结果';
      load(reference.id, apiBase)
        .then((experiment) => {
          content.innerHTML = preview(experiment);
        })
        .catch(() => {
          content.textContent = '暂时无法预览，可打开实验重试。';
        });
    }
  }
  window.FreeBbsLabResults = {
    escape,
    parseReference,
    digital,
    variables,
    preview,
    figureMarkup,
    enhance,
    load,
    styles,
    names,
  };
})();
