(() => {
  const app = window.freeBbsApp;
  const view = window.FreeBbsLabResults;
  const $ = (id) => document.getElementById(id);
  const source = $('lab-source');
  const title = $('lab-title');
  const stdin = $('lab-stdin');
  const examples = {
    c: {
      title: '从 C 到三种汇编',
      source:
        '#include <stdio.h>\n\nint square(int x) {\n    return x * x;\n}\n\nint main(void) {\n    printf("square(7) = %d\\n", square(7));\n    return 0;\n}\n',
    },
    cpp: {
      title: '比较循环的汇编实现',
      source:
        '#include <iostream>\n\nint sum_squares(int n) {\n    int sum = 0;\n    for (int i = 1; i <= n; ++i) {\n        sum += i * i;\n    }\n    return sum;\n}\n\nint main() {\n    std::cout << sum_squares(5) << "\\n";\n}\n',
    },
    python: {
      title: '逐行观察列表与累加',
      source:
        'numbers = [2, 4, 6, 8]\ntotal = 0\nfor index, value in enumerate(numbers):\n    total += value\n    average = total / (index + 1)\n    print(index, total, average)\nprint("最终结果:", total)\n',
    },
    matlab: {
      title: '正弦信号与衰减振荡',
      source:
        "t = 0:0.01:5;\ny = sin(2*pi*t);\nz = exp(-0.6*t).*y;\nfigure;\nsubplot(2,1,1);\nplot(t,y,'b'); grid on;\ntitle('Sine wave'); xlabel('Time (s)'); ylabel('Amplitude');\nsubplot(2,1,2);\nplot(t,z,'r'); grid on;\ntitle('Damped oscillation'); xlabel('Time (s)'); ylabel('Amplitude');\ndisp(['Samples: ', num2str(length(t))]);\n",
    },
    verilog: {
      title: '时钟、复位与四位计数器',
      source:
        '`timescale 1ns/1ps\nmodule testbench;\n  reg clk = 0;\n  reg reset = 1;\n  reg [3:0] count = 0;\n\n  always #5 clk = ~clk;\n  always @(posedge clk) begin\n    if (reset) count <= 0;\n    else count <= count + 1;\n  end\n\n  initial begin\n    #12 reset = 0;\n    #150;\n    $display("count = %d", count);\n    $finish;\n  end\nendmodule\n',
    },
  };
  let language = 'cpp';
  let result = null;
  let trace = null;
  let runId = null;
  let snapshotId = null;
  let activeId = null;
  let running = false;
  let paused = false;
  let ready = false;
  let tab = '';
  let controller;
  let consoleText = '';
  let activeLine = 0;
  let uid = '';
  let draftTimer;
  const status = (text, failure = false) => {
    $('lab-status').textContent = text;
    $('lab-status').classList.toggle('is-error', failure);
  };
  const input = () => ({
    language,
    source: source.value,
    stdin: stdin.value,
    interval: Number($('lab-speed').value),
    optimization: $('lab-optimization').value,
  });
  const draftKey = () => `free_bbs_lab_draft:${uid || 'guest'}:${language}`;
  function saveDraft() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ ...input(), title: title.value }));
    } catch {
      status('浏览器无法保存草稿，请先下载代码。', true);
    }
  }
  function lines() {
    $('lab-lines').textContent = source.value
      .split('\n')
      .map((_, i) => i + 1)
      .join('\n');
    $('lab-lines').scrollTop = source.scrollTop;
    source.style.setProperty('--active-line', `${16 + (activeLine - 1) * 22 - source.scrollTop}px`);
  }
  function controls() {
    $('lab-run').disabled = running || !ready;
    $('lab-stop').disabled = !activeId;
    $('lab-pause').disabled = !activeId;
    $('lab-step').disabled = !ready || (running && !activeId);
    $('lab-share').disabled = running;
    $('lab-example').disabled = running;
    source.readOnly = running;
    stdin.disabled = running;
    $('lab-optimization').disabled = running;
    document.querySelectorAll('[data-language]').forEach((button) => {
      button.disabled = running;
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
    });
    $('lab-pause').textContent = paused ? '继续' : '暂停';
    $('lab-optimization-label').hidden = !['c', 'cpp'].includes(language);
    $('lab-speed-label').hidden = language !== 'python';
    $('lab-python-controls').hidden = language !== 'python';
    $('lab-runtime-note').textContent = {
      c: 'C17 · GCC · x86-64 实际运行，MIPS32 / RISC-V64 交叉编译汇编；标准输入在下方填写。',
      cpp: 'C++17 · GCC · x86-64 实际运行，MIPS32 / RISC-V64 交叉编译汇编；支持标准库。',
      python:
        '每行执行前显示变量；可在运行中调速、暂停和单步。最多 1500 次观察 / 180 秒。输入请预先填写。',
      matlab:
        'GNU Octave 兼容模式，非 MathWorks MATLAB；支持 plot、subplot、频谱等绘图，最多 6 张图。部分专有工具箱不兼容。',
      verilog:
        'Icarus Verilog（支持部分 SystemVerilog 2012）。自动采集 VCD；请在测试平台中使用 $finish 结束仿真。最多 40 路、每路 2000 个跳变。',
    }[language];
  }
  function clearResult() {
    result = null;
    trace = null;
    runId = null;
    snapshotId = null;
    activeLine = 0;
    source.classList.remove('is-tracing');
    $('lab-result-state').textContent = '尚未运行';
    $('lab-position').textContent = '等待运行';
    consoleText = '';
    $('lab-console').textContent = '等待运行…';
    render();
    lines();
  }
  function switchLanguage(next, loadDraft = true) {
    if (!examples[next]) next = 'cpp';
    language = next;
    let draft;
    try {
      if (loadDraft) draft = JSON.parse(localStorage.getItem(draftKey()) || 'null');
    } catch {
      /* A missing draft falls back to the example. */
    }
    const data = draft && typeof draft.source === 'string' ? draft : examples[next];
    source.value = data.source;
    title.value = data.title || examples[next].title;
    stdin.value = data.stdin || '';
    $('lab-speed').value = data.interval ?? 1;
    $('lab-optimization').value = data.optimization || '0';
    tab = ['c', 'cpp'].includes(next) ? 'x86' : next === 'python' ? 'variables' : 'waveform';
    clearResult();
    controls();
    $('lab-description').textContent =
      `${view.names[next]} · 写下代码，观察真实执行结果，再把发现带回讨论。`;
    const url = new URL(window.location.href);
    url.searchParams.set('language', next);
    url.searchParams.delete('experiment');
    window.history.replaceState(null, '', url);
  }
  function waveformControls() {
    const wave = result?.waveform;
    if (!wave?.signals?.length) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'lab-wave-tools';
    toolbar.innerHTML =
      '<label>缩放 <input type="range" min="1" max="8" value="1" aria-label="波形缩放"/></label><label>游标 <input type="range" min="0" max="1000" value="0" aria-label="波形时间游标"/></label>';
    const readout = document.createElement('div');
    readout.className = 'lab-wave-readout';
    const selectors = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '选择观察信号';
    selectors.append(summary);
    const picked = new Set(wave.signals.map((_, index) => index));
    const draw = () => {
      const plot = $('lab-result').querySelector('.lab-wave-container');
      plot.innerHTML = view.digital({
        ...wave,
        signals: wave.signals.filter((_, index) => picked.has(index)),
      });
      const svg = plot.querySelector('svg');
      if (svg) svg.style.width = `${Number(toolbar.querySelectorAll('input')[0].value) * 100}%`;
    };
    wave.signals.forEach((signal, index) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      label.append(checkbox, document.createTextNode(String(signal.name)));
      label.style.display = 'block';
      selectors.append(label);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) picked.add(index);
        else picked.delete(index);
        draw();
        read();
      });
    });
    const read = () => {
      const time = (Number(wave.end) * Number(toolbar.querySelectorAll('input')[1].value)) / 1000;
      readout.textContent = `t = ${time.toFixed(2)} × ${wave.timescale} | ${wave.signals
        .filter((_, i) => picked.has(i))
        .map(
          (signal) =>
            `${signal.name}: ${signal.values.filter(([at]) => at <= time).at(-1)?.[1] ?? 'X'}`,
        )
        .join(' · ')}`;
    };
    $('lab-result').prepend(toolbar, selectors);
    $('lab-result').append(readout);
    toolbar.querySelectorAll('input')[0].addEventListener('input', draw);
    toolbar.querySelectorAll('input')[1].addEventListener('input', read);
    read();
  }
  function render() {
    const tabs = ['c', 'cpp'].includes(language)
      ? [
          ['x86', 'x86-64'],
          ['mips', 'MIPS32'],
          ['riscv', 'RISC-V64'],
        ]
      : language === 'python'
        ? [['variables', '实时变量']]
        : [['waveform', language === 'matlab' ? '图形 / 波形' : '数字时序']];
    $('lab-result-tabs').innerHTML = tabs
      .map(
        ([id, name]) =>
          `<button type="button" data-result-tab="${id}" aria-pressed="${id === tab}">${name}</button>`,
      )
      .join('');
    if (tab === 'variables') {
      $('lab-result').innerHTML = view.variables(trace || result?.lastTrace);
      return;
    }
    if (!result) {
      $('lab-result').innerHTML = '<p class="lab-empty">运行后，这里会显示实验结果。</p>';
      return;
    }
    if (tab === 'waveform') {
      $('lab-result').innerHTML =
        language === 'matlab'
          ? view.figureMarkup(result, false) ||
            '<p class="lab-empty">未生成图形。试试 plot(t, y)，或检查终端错误信息。</p>'
          : `<div class="lab-wave-container">${view.digital(result.waveform)}</div>`;
      if (language === 'verilog') waveformControls();
      return;
    }
    const assembly = result.assembly?.[tab];
    const text = String(assembly?.text || assembly?.error || '没有可用的汇编输出');
    $('lab-result').innerHTML =
      `<div class="lab-assembly-toolbar"><button type="button" id="lab-copy-assembly">复制汇编</button><span class="lab-hint">点击 .loc 源码行号可定位代码</span></div><pre class="lab-assembly">${text
        .split('\n')
        .map((line) => {
          const loc = line.match(/^\s*\.loc\s+1\s+(\d+)/);
          return loc
            ? `<span class="lab-source-line" tabindex="0" role="button" data-source-line="${Number(loc[1])}">${view.escape(line)}</span>`
            : view.escape(line);
        })
        .join('\n')}</pre>`;
    $('lab-copy-assembly').addEventListener('click', () =>
      navigator.clipboard
        .writeText(text)
        .then(() => status('汇编已复制'))
        .catch(() => status('无法访问剪贴板，请选中汇编后复制', true)),
    );
  }
  function updateTrace(event) {
    trace = event;
    activeLine = event.line;
    source.classList.add('is-tracing');
    if (
      (activeLine - 1) * 22 < source.scrollTop ||
      activeLine * 22 > source.scrollTop + source.clientHeight - 32
    )
      source.scrollTop = Math.max(0, (activeLine - 4) * 22);
    lines();
    $('lab-position').textContent =
      `${event.event === 'line' ? '即将执行' : event.event === 'return' ? '函数返回' : '异常'} · 第 ${event.line} 行 · ${event.function} · 第 ${event.step} 步`;
    if (tab === 'variables') $('lab-result').innerHTML = view.variables(event);
  }
  async function control(action) {
    if (!activeId) return;
    try {
      await app.callApi(`/labs/runs/${activeId}/control`, {
        method: 'POST',
        body: JSON.stringify({ action, interval: Number($('lab-speed').value) }),
      });
      if (action === 'pause' || action === 'step') paused = true;
      if (action === 'resume') paused = false;
      if (action === 'stop') controller?.abort();
      controls();
    } catch (error) {
      status(error.message, true);
    }
  }
  async function run(singleStep = false) {
    await app.sessionReady;
    if (!app.userState.isLoggedIn) {
      saveDraft();
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    if (running) return;
    clearResult();
    running = true;
    paused = singleStep;
    controller = new AbortController();
    controls();
    saveDraft();
    status('正在准备隔离运行环境…');
    $('lab-result-state').textContent = '运行中';
    let hadResult = false;
    let failed = false;
    try {
      const response = await fetch(`${app.apiBaseUrl}/labs/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${app.userState.token}`,
        },
        body: JSON.stringify({ ...input(), paused: singleStep }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error((await response.json()).message || '运行失败');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while (buffer.includes('\n')) {
          end = buffer.indexOf('\n');
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'started') {
            activeId = event.id;
            controls();
            status(paused ? '已暂停，可单步或继续。' : '实验正在运行…');
          } else if (event.type === 'status') status(event.message);
          else if (event.type === 'trace') updateTrace(event);
          else if (event.type === 'output') {
            consoleText = (consoleText + event.text).slice(-64000);
            $('lab-console').textContent = consoleText;
          } else if (event.type === 'result') {
            result = event;
            hadResult = true;
            consoleText = [event.stdout ?? consoleText, event.stderr || '']
              .filter(Boolean)
              .join('\n');
            $('lab-console').textContent = consoleText || '（无终端输出）';
            render();
            $('lab-result-state').textContent = `退出码 ${event.exitCode}`;
            status(
              event.exitCode === 0
                ? '运行完成。可以保存实验并带到讨论区。'
                : '运行结束，存在错误，请查看终端输出。',
              event.exitCode !== 0,
            );
          } else if (event.type === 'saved-run') runId = event.id;
          else if (event.type === 'error') {
            failed = true;
            status(event.message, true);
          }
        }
      }
      if (!hadResult && !failed) status('运行已结束，未收到结果。', true);
    } catch (error) {
      status(
        error.name === 'AbortError' ? '实验已停止。' : error.message,
        error.name !== 'AbortError',
      );
    } finally {
      running = false;
      activeId = null;
      controller = null;
      controls();
      if (!hadResult) $('lab-result-state').textContent = '未完成';
    }
  }
  async function share() {
    await app.sessionReady;
    if (!app.userState.isLoggedIn) {
      saveDraft();
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    $('lab-share').disabled = true;
    try {
      if (!snapshotId) {
        const payload = await app.callApi('/labs/experiments', {
          method: 'POST',
          body: JSON.stringify({ ...input(), title: title.value, ...(runId ? { runId } : {}) }),
        });
        snapshotId = payload.experiment.id;
        result = payload.experiment.result;
      }
      const link = `${window.location.origin}/code-lab?experiment=${snapshotId}`;
      const draft = {
        uid: app.userState.uid,
        title: `${view.names[language]} 实验：${title.value}`.slice(0, 120),
        content: `[查看实验代码与结果](${link})\n\n${result ? '这是本次实验的代码与运行结果快照。' : '这是代码快照，尚未附带运行结果。'}\n\n我的观察：\n`,
      };
      sessionStorage.setItem('free_bbs_lab_share_draft', JSON.stringify(draft));
      window.location.href = '/publish?board=daily&lab_share=1';
    } catch (error) {
      status(error.message, true);
      controls();
    }
  }
  $('lab-result-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-result-tab]');
    if (button) {
      tab = button.dataset.resultTab;
      render();
    }
  });
  function locate(event) {
    const target = event.target.closest('[data-source-line]');
    if (!target || (event.type === 'keydown' && !['Enter', ' '].includes(event.key))) return;
    event.preventDefault();
    activeLine = Number(target.dataset.sourceLine);
    source.scrollTop = Math.max(0, (activeLine - 4) * 22);
    source.classList.add('is-tracing');
    lines();
  }
  $('lab-result').addEventListener('click', locate);
  $('lab-result').addEventListener('keydown', locate);
  document.querySelectorAll('[data-language]').forEach((button) =>
    button.addEventListener('click', () => {
      saveDraft();
      switchLanguage(button.dataset.language);
      status('草稿已自动保存，可继续编辑。');
    }),
  );
  source.addEventListener('scroll', lines);
  source.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !source.readOnly) {
      event.preventDefault();
      source.setRangeText('    ', source.selectionStart, source.selectionEnd, 'end');
      source.dispatchEvent(new Event('input'));
    }
  });
  [source, stdin, title, $('lab-optimization')].forEach((element) =>
    element.addEventListener('input', () => {
      if (element !== title) {
        clearResult();
        $('lab-result-state').textContent = '内容已修改，需重新运行';
      }
      snapshotId = null;
      lines();
      clearTimeout(draftTimer);
      draftTimer = setTimeout(saveDraft, 400);
    }),
  );
  $('lab-speed').addEventListener('change', () => {
    if (running) control('speed');
    else {
      clearResult();
      $('lab-result-state').textContent = '参数已修改，需重新运行';
    }
    saveDraft();
  });
  $('lab-run').addEventListener('click', () => run());
  $('lab-stop').addEventListener('click', () => control('stop'));
  $('lab-pause').addEventListener('click', () => control(paused ? 'resume' : 'pause'));
  $('lab-step').addEventListener('click', () => (running ? control('step') : run(true)));
  $('lab-share').addEventListener('click', share);
  $('lab-example').addEventListener('click', () => {
    if (
      source.value !== examples[language].source &&
      !window.confirm('载入示例会替换当前代码，是否继续？')
    )
      return;
    switchLanguage(language, false);
    saveDraft();
  });
  $('lab-download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([source.value], { type: 'text/plain' }));
    a.download = `experiment.${{ c: 'c', cpp: 'cpp', python: 'py', matlab: 'm', verilog: 'v' }[language]}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  window.addEventListener('pagehide', () => {
    saveDraft();
    controller?.abort();
  });
  window.addEventListener('freebbs:session-change', () => {
    if (uid !== (app.userState.uid || '')) {
      controller?.abort();
      uid = app.userState.uid || '';
      switchLanguage(language);
    }
  });
  async function initialize() {
    const query = new URLSearchParams(window.location.search);
    const id = query.get('experiment');
    await app.sessionReady;
    uid = app.userState.uid || '';
    switchLanguage(query.get('language') || 'cpp');
    if (id) {
      try {
        const experiment = await view.load(id, app.apiBaseUrl);
        switchLanguage(experiment.language, false);
        source.value = experiment.source;
        title.value = experiment.title;
        stdin.value = experiment.stdin || '';
        $('lab-speed').value = experiment.interval ?? 1;
        $('lab-optimization').value = experiment.optimization || '0';
        result = experiment.result;
        trace = result?.lastTrace;
        snapshotId = id;
        lines();
        render();
        $('lab-console').textContent =
          [result?.stdout, result?.stderr].filter(Boolean).join('\n') || '（无终端输出）';
        $('lab-result-state').textContent = result
          ? `快照 · 退出码 ${result.exitCode}`
          : '代码快照';
        const url = new URL(window.location.href);
        url.searchParams.set('experiment', id);
        window.history.replaceState(null, '', url);
      } catch (error) {
        status(error.message, true);
      }
    }
    try {
      const capabilities = await app.callApi('/labs/capabilities', { method: 'GET' });
      ready = capabilities.ready;
      status(
        ready
          ? '运行环境就绪 · 草稿自动保存于此浏览器 · 分享会创建公开实验快照'
          : '运行服务暂不可用，草稿仍可编辑、下载及分享。',
        !ready,
      );
    } catch {
      status('运行服务连接失败，请刷新重试。', true);
    }
    controls();
  }
  initialize();
})();
