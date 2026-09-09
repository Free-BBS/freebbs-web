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
        <span class="band-challenge-eyebrow">身份验证 · 能带实验</span>
        <button
          class="band-challenge-close"
          id="band-challenge-close"
          type="button"
          aria-label="关闭验证"
        >
          ×
        </button>
      </div>
      <h2 id="band-challenge-title">移动一个粒子，完成验证</h2>
      <p id="band-challenge-task">正在准备能带…</p>
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
      <details class="band-challenge-hint">
        <summary>一点物理提示</summary>
        <p>
          有效质量与能带曲率的绝对值成反比：弯曲越缓，质量越大；弯曲越急，质量越小。判断的是二阶导数，不是斜率。
        </p>
        <p id="band-challenge-formula"></p>
        <p>只比较标记点处的正有效质量。完整能带包含波峰、波谷和拐点；可选点避开了有效质量发散的零曲率位置。</p>
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
  const confirmButton = element('confirm');
  const refreshButton = element('refresh');
  const closeButton = element('close');
  const status = element('status');
  let session = null;
  let generation = 0;
  let expiryTimer = null;
  let dragging = false;

  function isExpired() {
    return !session?.challenge || Date.now() >= Date.parse(session.challenge.expiresAt);
  }

  function updateControls() {
    const busy = !session || session.loading || session.submitting;
    slider.disabled = busy || isExpired();
    confirmButton.disabled = busy || !session?.moved || isExpired();
    refreshButton.disabled = busy;
    closeButton.disabled = Boolean(session?.submitting);
    const action = session?.mode === 'login' ? '登录' : '注册';
    confirmButton.textContent = session?.submitting ? `正在${action}…` : `确认位置并${action}`;
  }

  function finish(value, error) {
    const active = session;
    if (!active) return;
    session = null;
    generation += 1;
    dragging = false;
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
    if (!session?.challenge || session.loading || session.submitting || isExpired()) return;
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

  function renderChallenge() {
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
    dragging = false;
    element('plot').hidden = true;
    element('expiry').textContent = '';
    status.textContent = message || '正在准备能带…';
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
      if (
        !Array.isArray(challenge.band?.points) ||
        challenge.band.points.length < 3 ||
        !Array.isArray(challenge.band.candidates) ||
        challenge.band.candidates.length < 2 ||
        !challenge.band.candidates.every((point) => Number.isFinite(point.k)) ||
        !Number.isFinite(Date.parse(challenge.expiresAt))
      ) {
        throw new Error('能带题目加载失败，请换一道题重试。');
      }
      active.challenge = challenge;
      active.loading = false;
      status.textContent = message || '拖动粒子，选择你的位置。';
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
    if (!session?.challenge) return;
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
      const payload = await active.submit({
        challengeId: active.challenge.challengeId,
        k: active.k,
      });
      finish(payload);
    } catch (error) {
      active.submitting = false;
      if (/^(registration|login)_captcha_/.test(String(error.code || ''))) {
        await loadChallenge(`${error.message} 请在新能带上重试。`);
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
