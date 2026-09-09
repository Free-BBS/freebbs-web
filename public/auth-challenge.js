(() => {
  if (!['login', 'register'].includes(document.getElementById('auth-page-form')?.dataset.authMode))
    return;
  document.body.insertAdjacentHTML(
    'beforeend',
    `
    <dialog
      class="band-challenge"
      id="band-challenge"
      aria-labelledby="band-challenge-title"
      aria-describedby="band-challenge-task"
    >
      <div class="band-challenge-heading">
        <span class="band-challenge-eyebrow">身份验证 · 物理实验</span>
        <button
          class="band-challenge-close"
          id="band-challenge-close"
          type="button"
          aria-label="关闭验证"
        >
          ×
        </button>
      </div>
      <h2 id="band-challenge-title">完成一次实验验证</h2>
      <p id="band-challenge-task">正在准备验证实验…</p>
      <div class="band-challenge-plot" id="band-challenge-plot" hidden>
        <div class="band-challenge-legend">
          <span id="band-challenge-band-label"></span><span>示意能带 · 任意单位</span>
        </div>
        <svg
          id="band-challenge-graph"
          viewBox="0 0 600 300"
          role="img"
          aria-label="能量 E 随波矢 k 的变化曲线，可拖动图上的粒子"
        >
          <g class="band-grid" aria-hidden="true">
            <path
              d="M56 82H562 M56 144H562 M56 206H562 M157 28V268 M258 28V268 M359 28V268 M460 28V268"
            />
          </g>
          <path class="band-axes" d="M56 28V268H572" />
          <text class="band-axis-label" x="25" y="31">E</text>
          <text class="band-axis-label" x="576" y="290">k</text>
          <text class="band-axis-label" id="band-k-min" x="56" y="290" text-anchor="middle"></text>
          <text class="band-axis-label" id="band-k-max" x="562" y="290" text-anchor="middle"></text>
          <path class="band-curve" id="band-challenge-curve" />
          <g class="band-candidates" id="band-challenge-candidates" aria-hidden="true"></g>
          <path class="band-particle-guide" id="band-particle-guide" />
          <g id="band-challenge-particle" class="band-particle" aria-hidden="true">
            <circle class="band-particle-halo" r="24" />
            <circle class="band-particle-core" r="15" />
            <text id="band-challenge-symbol" text-anchor="middle" dy="5">e−</text>
          </g>
        </svg>
        <div class="band-position-heading">
          <label for="band-challenge-position" id="band-position-label">粒子位置</label
          ><output id="band-challenge-position-value" for="band-challenge-position"></output>
        </div>
        <input
          id="band-challenge-position"
          type="range"
          min="-1"
          max="1"
          step="0.001"
          value="0"
          aria-describedby="band-challenge-controls"
        />
        <p class="band-challenge-controls" id="band-challenge-controls">
          沿能带自由拖动粒子，停在目标标记附近的小范围内即可；也可用下方滑块或方向键微调。
        </p>
      </div>
      <div class="band-challenge-plot wien-challenge-plot" id="wien-challenge-plot" hidden>
        <div class="band-challenge-legend wien-challenge-legend">
          <span>文氏桥 · 等值 RC</span><span id="wien-challenge-components"></span>
        </div>
        <svg
          id="wien-challenge-graph"
          viewBox="0 0 600 380"
          role="img"
          aria-label="文氏桥振荡器电路：输出经串联 RC 接同相端，同相端经并联 RC 接地；反相端经 Rg 接地，输出经滑动变阻器 Rf 反馈到反相端。拖动下方滑片调节 Rf。"
        >
          <g class="wien-wire" aria-hidden="true">
            <path d="M400 210H550V45H480 M430 45H390 M380 45H208V180H272" />
            <path d="M88 124V100H208 M150 100V142 M88 170V210H150V154 M120 210V225" />
            <path d="M272 240H195V275 M195 321V340 M245 240V320H263 M289 320H300 M500 320H550V210" />
            <path d="M108 225H132 M112 232H128 M116 239H124 M183 340H207 M187 347H203 M191 354H199" />
            <path d="M380 31V59 M390 31V59 M136 142H164 M136 154H164" />
            <path class="wien-amplifier" d="M272 150L400 210L272 270Z" />
            <rect x="430" y="35" width="50" height="20" />
            <rect x="78" y="124" width="20" height="46" />
            <rect x="185" y="275" width="20" height="46" />
            <rect x="263" y="310" width="26" height="20" />
            <rect class="wien-rheostat-track" x="300" y="310" width="200" height="20" rx="2" />
            <path class="wien-wiper-wire" id="wien-challenge-wiper-wire" />
            <circle class="wien-junction" cx="208" cy="100" r="4" />
            <circle class="wien-junction" cx="245" cy="240" r="4" />
            <circle class="wien-junction" cx="550" cy="210" r="4" />
          </g>
          <g class="wien-circuit-label" aria-hidden="true">
            <text x="455" y="23" text-anchor="middle">R</text>
            <text x="385" y="23" text-anchor="middle">C</text>
            <text x="55" y="155">R</text>
            <text x="174" y="155">C</text>
            <text x="286" y="188">+</text>
            <text x="286" y="249">−</text>
            <text class="wien-gain-symbol" x="325" y="220" text-anchor="middle">A</text>
            <text x="480" y="193">输出</text>
            <text x="145" y="307">R<tspan dy="5" font-size="16">g</tspan></text>
            <text x="273" y="360" text-anchor="middle">R<tspan dy="5" font-size="16">0</tspan></text>
            <text x="415" y="362" text-anchor="middle">R<tspan dy="5" font-size="16">v</tspan><tspan dy="-5"> · 拖动滑片</tspan></text>
          </g>
          <g id="wien-challenge-wiper" class="wien-wiper" aria-hidden="true">
            <circle class="wien-wiper-halo" cy="285" r="28" />
            <circle class="wien-wiper-handle" cy="285" r="15" />
            <path class="wien-wiper-arrow" d="M0 299V306 M-6 304L0 311L6 304" />
            <path class="wien-wiper-grip" d="M-4 280V290 M4 280V290" />
          </g>
        </svg>
        <div class="band-position-heading">
          <label for="wien-challenge-position">反馈电阻 Rf = R0 + Rv</label>
          <output id="wien-challenge-position-value" for="wien-challenge-position"></output>
        </div>
        <input id="wien-challenge-position" type="range" min="0" max="1" step="0.001" value="0" aria-describedby="wien-challenge-controls" />
        <p class="band-challenge-controls" id="wien-challenge-controls">
          拖动滑片，或用滑块 / 方向键微调。
        </p>
        <dl class="wien-challenge-readings">
          <div><dt>放大倍数 A</dt><dd id="wien-challenge-gain"></dd></div>
          <div><dt>起振等效 |Q|</dt><dd id="wien-challenge-q"></dd></div>
        </dl>
        <p class="wien-challenge-state" id="wien-challenge-state" aria-live="polite"></p>
        <p class="band-challenge-controls" id="wien-challenge-frequency"></p>
      </div>
      <details class="band-challenge-hint" id="band-challenge-hint" hidden>
        <summary>一点物理提示</summary>
        <p>
          有效质量与能带曲率的绝对值成反比：弯曲越缓，质量越大；弯曲越急，质量越小。判断的是二阶导数，不是斜率。
        </p>
        <p id="band-challenge-formula"></p>
        <p>只比较标记点处的正有效质量。完整能带包含波峰、波谷和拐点；可选点避开了有效质量发散的零曲率位置。</p>
      </details>
      <details class="band-challenge-hint" id="wien-challenge-hint" hidden>
        <summary>一点电路提示</summary>
        <p>理想等值 RC 电路中，A = 1 + Rf / Rg，振荡频率 f₀ = 1 / (2πRC)。让 A 略大于 3，即可开始振荡；本题要求 3 &lt; A &lt; 5。</p>
        <p>本题的起振等效 |Q| = 1 / |3 − A|，取自小信号极点；它不是无源文氏桥的 Q，也不是稳态波形的纯度。A = 3 是临界状态，不能自行起振。</p>
        <p>起振时通常定义的有符号 Q 为负，因此这里比较其绝对值。电路未加入稳幅环节，满足起振条件表示振幅开始增长。</p>
      </details>
      <p
        class="band-challenge-status"
        id="band-challenge-status"
        role="status"
        aria-live="polite"
      ></p>
      <div class="band-challenge-actions">
        <button id="band-challenge-refresh" type="button">换一道题</button>
        <button class="auth-submit" id="band-challenge-confirm" type="button" disabled>
          确认位置
        </button>
      </div>
      <p class="band-challenge-expiry" id="band-challenge-expiry"></p>
    </dialog>
  `,
  );
  const dialog = document.getElementById('band-challenge');

  const element = (suffix) => document.getElementById(`band-challenge-${suffix}`);
  const graph = element('graph');
  const slider = element('position');
  const wienElement = (suffix) => document.getElementById(`wien-challenge-${suffix}`);
  const wienGraph = wienElement('graph');
  const wienSlider = wienElement('position');
  const confirmButton = element('confirm');
  const refreshButton = element('refresh');
  const closeButton = element('close');
  const status = element('status');
  let session = null;
  let generation = 0;
  let expiryTimer = null;
  let dragging = false;
  let draggingWiper = false;

  function isWien() {
    return session?.challenge?.type === 'wien';
  }

  function isExpired() {
    return !session?.challenge || Date.now() >= Date.parse(session.challenge.expiresAt);
  }

  function updateControls() {
    const busy = !session || session.loading || session.submitting;
    slider.disabled = busy || isExpired() || isWien();
    wienSlider.disabled = busy || isExpired() || !isWien();
    confirmButton.disabled = busy || !session?.moved || isExpired();
    refreshButton.disabled = busy;
    closeButton.disabled = Boolean(session?.submitting);
    const action = session?.mode === 'login' ? '登录' : '注册';
    confirmButton.textContent = session?.submitting
      ? `正在${action}…`
      : `确认${isWien() ? '阻值' : '位置'}并${action}`;
  }

  function finish(value, error) {
    const active = session;
    if (!active) return;
    session = null;
    generation += 1;
    dragging = false;
    draggingWiper = false;
    window.clearInterval(expiryTimer);
    dialog.close();
    if (error) active.reject(error);
    else active.resolve(value);
  }

  function plotPosition(k, energy) {
    const { band } = session.challenge;
    const { energyMin, energySpan } = session;
    return {
      x: 56 + ((k - band.kMin) / (band.kMax - band.kMin)) * 506,
      y: 244 - ((energy - energyMin) / energySpan) * 190,
    };
  }

  function energyAt(k) {
    const { points } = session.challenge.band;
    let right = points.findIndex((point) => point.k >= k);
    if (right < 1) right = 1;
    const leftPoint = points[right - 1];
    const rightPoint = points[right];
    const fraction = (k - leftPoint.k) / (rightPoint.k - leftPoint.k);
    return leftPoint.energy + fraction * (rightPoint.energy - leftPoint.energy);
  }

  function setPosition(value, moved = true) {
    if (!session?.challenge || isWien() || session.loading || session.submitting || isExpired())
      return;
    if (!Number.isFinite(Number(value))) return;
    const { kMin, kMax } = session.challenge.band;
    const k = Math.min(kMax, Math.max(kMin, Number(value)));
    const energy = energyAt(k);
    const { x, y } = plotPosition(k, energy);
    session.k = k;
    session.moved ||= moved;
    slider.value = String(k);
    element('position-value').textContent = `k = ${k.toFixed(3)}`;
    slider.setAttribute('aria-valuetext', `波矢 k = ${k.toFixed(3)}`);
    element('particle').setAttribute('transform', `translate(${x}, ${y})`);
    document.getElementById('band-particle-guide').setAttribute('d', `M${x} ${y}V268`);
    if (moved)
      status.textContent = `位置已选择，确认后继续${session.mode === 'login' ? '登录' : '注册'}。`;
    updateControls();
  }

  function formatResistance(value) {
    return value >= 1000 ? `${(value / 1000).toFixed(3)} kΩ` : `${value.toFixed(1)} Ω`;
  }

  function setResistance(value, moved = true) {
    if (!isWien() || session.loading || session.submitting || isExpired()) return;
    if (!Number.isFinite(Number(value))) return;
    const parameters = session.challenge.oscillator;
    const resistanceOhms = Math.min(
      parameters.rfMaxOhms,
      Math.max(parameters.rfMinOhms, Number(value)),
    );
    const state = window.freeBbsWienModel.evaluate(parameters, resistanceOhms);
    const position =
      300 +
      ((resistanceOhms - parameters.rfMinOhms) / (parameters.rfMaxOhms - parameters.rfMinOhms)) *
        200;
    session.resistanceOhms = resistanceOhms;
    session.moved ||= moved;
    wienSlider.value = String(resistanceOhms);
    wienSlider.setAttribute('aria-valuetext', `反馈电阻 ${formatResistance(resistanceOhms)}`);
    wienElement('position-value').textContent = formatResistance(resistanceOhms);
    wienElement('wiper').setAttribute('transform', `translate(${position}, 0)`);
    wienElement('wiper-wire').setAttribute('d', `M550 320V285H${position}`);
    wienElement('gain').textContent = state.gain.toFixed(3);
    wienElement('q').textContent = Number.isFinite(state.q) ? state.q.toFixed(2) : '∞（临界）';
    wienElement('state').classList.toggle('is-satisfied', state.satisfies);
    let stateDescription;
    if (state.satisfies) {
      stateDescription = `已起振，且 |Q| > ${parameters.qMin}，满足要求`;
    } else if (!Number.isFinite(state.q)) {
      stateDescription = '临界未起振：请略微增大反馈电阻';
    } else if (state.starts) {
      stateDescription = `已起振，需继续调整至 |Q| > ${parameters.qMin}`;
    } else if (state.gain <= 3) {
      stateDescription = '尚未起振：请增大反馈电阻';
    } else {
      stateDescription = '增益过大，未形成振荡：请减小反馈电阻';
    }
    wienElement('state').textContent = stateDescription;
    if (moved)
      status.textContent = `阻值已选择，确认后继续${session.mode === 'login' ? '登录' : '注册'}。`;
    updateControls();
  }

  function updateExpiry() {
    if (!session?.challenge || session.loading) return;
    const seconds = Math.max(
      0,
      Math.ceil((Date.parse(session.challenge.expiresAt) - Date.now()) / 1000),
    );
    element('expiry').textContent = seconds
      ? `本题剩余 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
      : '本题已过期，请换一道题';
    updateControls();
  }

  function renderWienChallenge() {
    const { oscillator } = session.challenge;
    const state = window.freeBbsWienModel.evaluate(oscillator, oscillator.rfInitialOhms);
    element('title').textContent = '让文氏振荡器起振';
    dialog.querySelector('.band-challenge-eyebrow').textContent =
      `${session.mode === 'login' ? '登录' : '注册'}验证 · 电路实验`;
    element('task').textContent =
      `拖动反馈电阻的滑片，使电路起振，且起振等效 |Q| > ${oscillator.qMin}。`;
    wienElement('components').textContent =
      `R = ${formatResistance(oscillator.rOhms)} · C = ${(oscillator.cFarads * 1e9).toFixed(1)} nF`;
    wienElement('frequency').textContent =
      `Rg = ${formatResistance(oscillator.rgOhms)} · R0 = ${formatResistance(oscillator.rfMinOhms)}；` +
      `f₀ ≈ ${state.frequencyHz >= 1000 ? `${(state.frequencyHz / 1000).toFixed(2)} kHz` : `${state.frequencyHz.toFixed(1)} Hz`}`;
    wienSlider.min = String(oscillator.rfMinOhms);
    wienSlider.max = String(oscillator.rfMaxOhms);
    wienSlider.step = String((oscillator.rfMaxOhms - oscillator.rfMinOhms) / 2000);
    setResistance(oscillator.rfInitialOhms, false);
    wienElement('plot').hidden = false;
    wienElement('hint').hidden = false;
    updateExpiry();
    wienSlider.focus({ preventScroll: true });
  }

  function renderChallenge() {
    if (isWien()) {
      renderWienChallenge();
      return;
    }
    const { challenge } = session;
    const { band } = challenge;
    const isHole = challenge.carrier === 'hole';
    const carrier = isHole ? '空穴' : '电子';
    const objective = challenge.objective === 'maximum' ? '最大' : '最小';
    element('title').textContent = `让${carrier}的有效质量${objective}`;
    dialog.querySelector('.band-challenge-eyebrow').textContent =
      `${session.mode === 'login' ? '登录' : '注册'}验证 · 能带实验`;
    element('task').textContent = `比较标记位置，将${carrier}拖到正有效质量${objective}的点附近。`;
    element('band-label').textContent = isHole ? '价带 · 空穴 h+' : '导带 · 电子 e−';
    element('symbol').textContent = isHole ? 'h+' : 'e−';
    element('particle').classList.toggle('is-hole', isHole);
    element('formula').textContent = isHole
      ? '图中 E 是价带电子能量，空穴有效质量 mₕ* = −ℏ² / (d²E/dk²)。'
      : '图中 E 是导带电子能量，电子有效质量 mₑ* = ℏ² / (d²E/dk²)。';
    graph.setAttribute(
      'aria-label',
      `${isHole ? '价带' : '导带'}能量 E 随波矢 k 的变化曲线，拖动${carrier}使有效质量${objective}`,
    );
    document.getElementById('band-position-label').textContent = `${carrier}位置`;
    const energies = band.points.map((point) => point.energy);
    session.energyMin = Math.min(...energies);
    session.energySpan = Math.max(...energies) - session.energyMin || 1;
    const path = band.points
      .map((point, index) => {
        const { x, y } = plotPosition(point.k, point.energy);
        return `${index ? 'L' : 'M'}${x.toFixed(3)} ${y.toFixed(3)}`;
      })
      .join(' ');
    element('curve').setAttribute('d', path);
    const candidateGroup = element('candidates');
    candidateGroup.replaceChildren();
    band.candidates.forEach((candidate, index) => {
      const { x, y } = plotPosition(candidate.k, energyAt(candidate.k));
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('r', 5);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', y < 218 ? y + 34 : y - 30);
      label.setAttribute('text-anchor', 'middle');
      label.textContent = String.fromCharCode(65 + index);
      candidateGroup.append(dot, label);
    });
    document.getElementById('band-k-min').textContent = String(band.kMin);
    document.getElementById('band-k-max').textContent = String(band.kMax);
    slider.min = String(band.kMin);
    slider.max = String(band.kMax);
    slider.step = String((band.kMax - band.kMin) / 2000);
    setPosition((band.kMin + band.kMax) / 2, false);
    element('plot').hidden = false;
    element('hint').hidden = false;
    updateExpiry();
    slider.focus({ preventScroll: true });
  }

  async function loadChallenge(message = '') {
    if (!session || session.submitting) return;
    const active = session;
    generation += 1;
    const currentGeneration = generation;
    active.loading = true;
    active.moved = false;
    active.challenge = null;
    active.k = null;
    active.resistanceOhms = null;
    dragging = false;
    draggingWiper = false;
    element('plot').hidden = true;
    element('hint').hidden = true;
    wienElement('plot').hidden = true;
    wienElement('hint').hidden = true;
    element('title').textContent = '完成一次实验验证';
    element('task').textContent = '正在准备验证实验…';
    dialog.querySelector('.band-challenge-eyebrow').textContent = '身份验证 · 物理实验';
    element('expiry').textContent = '';
    status.textContent = message || '正在准备验证实验…';
    updateControls();
    try {
      const challenge = await active.request(
        active.mode === 'login' ? '/auth/login-challenge' : '/auth/registration-challenge',
        {
          method: 'POST',
          body: JSON.stringify(
            active.mode === 'login' ? { identifier: active.identity } : { email: active.identity },
          ),
        },
      );
      if (session !== active || currentGeneration !== generation) return;
      if (
        active.mode === 'register' &&
        challenge.communityAgreementVersion !== active.agreementVersion
      ) {
        throw new Error('社区公约已更新，请刷新注册页面并重新阅读、确认。');
      }
      const wienChallenge = challenge.type === 'wien';
      const bandChallenge = challenge.type === undefined || challenge.type === 'band';
      const validBand =
        bandChallenge &&
        Number.isFinite(challenge.band?.kMin) &&
        Number.isFinite(challenge.band?.kMax) &&
        challenge.band.kMin < challenge.band.kMax &&
        Array.isArray(challenge.band.points) &&
        challenge.band.points.length >= 3 &&
        challenge.band.points.every(
          (point) => Number.isFinite(point.k) && Number.isFinite(point.energy),
        ) &&
        Array.isArray(challenge.band.candidates) &&
        challenge.band.candidates.length >= 2 &&
        challenge.band.candidates.every((point) => Number.isFinite(point.k));
      const validWien =
        wienChallenge && window.freeBbsWienModel?.validParameters(challenge.oscillator);
      if ((!validBand && !validWien) || !Number.isFinite(Date.parse(challenge.expiresAt)))
        throw new Error('验证题目加载失败，请换一道题重试。');
      active.challenge = challenge;
      active.loading = false;
      status.textContent =
        message || (wienChallenge ? '拖动滑片，调节反馈电阻。' : '拖动粒子，选择你的位置。');
      renderChallenge();
    } catch (error) {
      if (session !== active || currentGeneration !== generation) return;
      status.textContent = error.message || '加载失败，请换一道题重试。';
    } finally {
      if (session === active && currentGeneration === generation) {
        active.loading = false;
        updateControls();
      }
    }
  }

  function setPointerPosition(event) {
    if (!session?.challenge || isWien()) return;
    const matrix = graph.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const { kMin, kMax } = session.challenge.band;
    setPosition(kMin + ((point.x - 56) / 506) * (kMax - kMin));
  }

  graph.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || slider.disabled) return;
    event.preventDefault();
    dragging = true;
    graph.setPointerCapture(event.pointerId);
    setPointerPosition(event);
  });
  graph.addEventListener('pointermove', (event) => {
    if (dragging) setPointerPosition(event);
  });
  graph.addEventListener('pointerup', (event) => {
    if (dragging) setPointerPosition(event);
    dragging = false;
  });
  graph.addEventListener('pointercancel', () => {
    dragging = false;
  });
  graph.addEventListener('lostpointercapture', () => {
    dragging = false;
  });
  slider.addEventListener('input', () => {
    setPosition(slider.value);
  });

  function wienPointerPosition(event) {
    const matrix = wienGraph.getScreenCTM();
    if (!matrix) return null;
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  }

  function setWiperPosition(event) {
    if (!isWien()) return;
    const point = wienPointerPosition(event);
    if (!point) return;
    const { rfMinOhms, rfMaxOhms } = session.challenge.oscillator;
    setResistance(rfMinOhms + ((point.x - 300) / 200) * (rfMaxOhms - rfMinOhms));
  }

  wienGraph.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || wienSlider.disabled) return;
    const point = wienPointerPosition(event);
    if (!point || point.y < 258 || point.y > 350 || point.x < 272 || point.x > 528) return;
    event.preventDefault();
    draggingWiper = true;
    wienGraph.setPointerCapture(event.pointerId);
    setWiperPosition(event);
  });
  wienGraph.addEventListener('pointermove', (event) => {
    if (draggingWiper) setWiperPosition(event);
  });
  wienGraph.addEventListener('pointerup', (event) => {
    if (draggingWiper) setWiperPosition(event);
    draggingWiper = false;
  });
  wienGraph.addEventListener('pointercancel', () => {
    draggingWiper = false;
  });
  wienGraph.addEventListener('lostpointercapture', () => {
    draggingWiper = false;
  });
  wienSlider.addEventListener('input', () => setResistance(wienSlider.value));
  refreshButton.addEventListener('click', () => loadChallenge());
  closeButton.addEventListener('click', () => finish(null));
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    if (!session?.submitting) finish(null);
  });
  dialog.addEventListener('close', () => {
    if (session && !dialog.open) finish(null);
  });
  confirmButton.addEventListener('click', async () => {
    if (confirmButton.disabled || !session) return;
    const active = session;
    active.submitting = true;
    status.textContent = active.mode === 'login' ? '正在验证并登录…' : '正在验证并创建账号…';
    updateControls();
    try {
      const answer = isWien() ? { resistanceOhms: active.resistanceOhms } : { k: active.k };
      const payload = await active.submit({ challengeId: active.challenge.challengeId, ...answer });
      finish(payload);
    } catch (error) {
      active.submitting = false;
      if (/^(registration|login)_captcha_/.test(String(error.code || ''))) {
        await loadChallenge(`${error.message} 请完成新的验证题目。`);
      } else {
        finish(null, error);
      }
    } finally {
      updateControls();
    }
  });

  window.freeBbsAuthChallenge = {
    run({ mode, identity, agreementVersion, request, submit }) {
      if (session) return Promise.reject(new Error('请先完成当前验证。'));
      return new Promise((resolve, reject) => {
        session = {
          mode,
          identity,
          agreementVersion,
          request,
          submit,
          resolve,
          reject,
          loading: false,
          submitting: false,
        };
        dialog.showModal();
        loadChallenge();
        expiryTimer = window.setInterval(updateExpiry, 1000);
      });
    },
  };
})();
