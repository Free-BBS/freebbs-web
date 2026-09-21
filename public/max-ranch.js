/* Articulated, ground-contact animation; geometry is shared with the regression tests. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsMaxRanch = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const GROUND = 164;
  const PERIOD = 1.2;
  const STRIDE = 26;
  const STANCE = 0.7;
  const SPEED = STRIDE / (PERIOD * STANCE);
  const smooth = (x) => {
    const t = Math.max(0, Math.min(1, x));
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a + (b - a) * t;
  const rotate = (p, angle) => {
    const r = (angle * Math.PI) / 180;
    return {
      x: 64 + (p.x - 64) * Math.cos(r) - (p.y - 112) * Math.sin(r),
      y: 112 + (p.x - 64) * Math.sin(r) + (p.y - 112) * Math.cos(r),
    };
  };
  const hips = [
    { x: 49, y: 132 },
    { x: 108, y: 131 },
    { x: 58, y: 133 },
    { x: 119, y: 132 },
  ];
  function walkPose(time) {
    const bob = Math.sin((time / PERIOD) * Math.PI * 4) * 1.1;
    return {
      angle: 0,
      bob,
      standing: 0,
      legs: hips.map((hip, i) => {
        const phase = (((time / PERIOD + [0, 0.5, 0.5, 0][i]) % 1) + 1) % 1;
        const planted = phase < STANCE;
        const swing = (phase - STANCE) / (1 - STANCE);
        return {
          hip: { x: hip.x, y: hip.y + bob },
          foot: {
            x:
              hip.x +
              (planted
                ? STRIDE / 2 - (STRIDE * phase) / STANCE
                : -STRIDE / 2 + STRIDE * smooth(swing)),
            y: GROUND - (planted ? 0 : Math.sin(swing * Math.PI) * 13),
          },
          planted,
        };
      }),
    };
  }
  function standPose(amount = 1, time = 0) {
    const angle = -64 * amount;
    return {
      angle,
      bob: 0,
      standing: amount,
      legs: hips.map((hip, i) => {
        const front = i === 1 || i === 3;
        const neutral = { x: hip.x + (front ? 5 : -3), y: GROUND };
        const hand = {
          x: i === 3 ? 113 + Math.sin(time * 5) * 6 : 46,
          y: i === 3 ? 49 + Math.cos(time * 5) * 3.5 : 95,
        };
        return {
          hip: rotate(hip, angle),
          foot: front
            ? { x: mix(neutral.x, hand.x, amount), y: mix(neutral.y, hand.y, amount) }
            : neutral,
          planted: !front || amount === 0,
        };
      }),
    };
  }
  function blend(a, b, t) {
    return {
      angle: mix(a.angle, b.angle, t),
      bob: mix(a.bob, b.bob, t),
      standing: mix(a.standing, b.standing, t),
      legs: a.legs.map((leg, i) => ({
        hip: { x: mix(leg.hip.x, b.legs[i].hip.x, t), y: mix(leg.hip.y, b.legs[i].hip.y, t) },
        foot: { x: mix(leg.foot.x, b.legs[i].foot.x, t), y: mix(leg.foot.y, b.legs[i].foot.y, t) },
        planted: leg.planted && b.legs[i].planted,
      })),
    };
  }
  // An animal greeting: settle onto all four hooves, nuzzle, then resume the same gait phase.
  // standPose remains exported for older geometry consumers; the actor never rears up.
  function greetPose(base, time) {
    const settled = {
      angle: 0,
      bob: 0,
      standing: 0,
      legs: hips.map((hip, i) => ({
        hip: { ...hip },
        foot: { x: base.legs[i].foot.x, y: GROUND },
        planted: true,
      })),
    };
    if (time < 0.3) return blend(base, settled, smooth(time / 0.3));
    if (time > 2.8) return blend(settled, base, smooth((time - 2.8) / 0.4));
    return settled;
  }
  function legPath(leg, index) {
    const { hip, foot } = leg;
    const dx = foot.x - hip.x;
    const dy = foot.y - hip.y;
    const distance = Math.hypot(dx, dy) || 1;
    const bend = Math.min(6, distance * 0.15);
    const sign = index % 2 ? -1 : 1;
    const knee = {
      x: (hip.x + foot.x) / 2 + (dy / distance) * bend * sign,
      y: (hip.y + foot.y) / 2 - (dx / distance) * bend * sign,
    };
    return `M ${hip.x} ${hip.y} Q ${knee.x} ${knee.y} ${foot.x} ${foot.y - 4}`;
  }
  const limbMarkup = (i) =>
    `<g data-leg="${i}"><path data-limb fill="none" stroke="${i < 2 ? '#bca181' : '#ebd5b5'}" stroke-width="${i < 2 ? 7 : 8}" stroke-linecap="round"/><path data-hoof fill="${i < 2 ? '#725d49' : '#997556'}" stroke="#6f5039" stroke-width="1.1" stroke-linejoin="round"/><path data-hoof-split fill="none" stroke="#d3b795" stroke-width="1.1" stroke-linecap="round"/></g>`;
  const markup =
    () => `<svg viewBox="0 0 180 180" role="img" aria-label="Max：戴眼镜的暖米色电子仿生羊">
    <g data-facing>
      <ellipse data-shadow cx="88" cy="166" rx="54" ry="4" fill="#715944" opacity=".16"/>
      ${limbMarkup(0)}${limbMarkup(1)}${limbMarkup(2)}${limbMarkup(3)}
      <g data-body>
        <g data-tail>
          <path d="M35 119C22 122 16 116 19 109C19 102 29 101 31 109" fill="#fff0d3" stroke="#a3825f" stroke-width="1.6" stroke-linecap="round"/>
          <path d="M21 109q5-3 7 3" fill="none" stroke="#dfc49d" stroke-width="1.4" stroke-linecap="round"/>
        </g>
        <g data-fleece>
          <path data-wool-base d="M35 103C29 94 34 84 43 83C45 72 56 70 64 75C71 67 84 69 90 74C102 69 115 77 116 85C128 85 136 97 131 107C138 118 130 130 120 131C114 141 100 141 92 137C78 143 66 141 59 137C46 140 36 132 37 125C27 121 27 109 35 103Z" fill="#fff1d5" stroke="#a78964" stroke-width="1.7" stroke-linejoin="round"/>
          <path d="M34 110C41 127 65 135 86 134C108 136 125 121 131 107C139 121 128 131 119 131C111 140 101 140 92 135C78 142 66 139 59 135C46 137 37 131 38 123C31 121 30 115 34 110Z" fill="#e7ceb0" opacity=".5"/>
          <path d="M42 96q2-6 8-3m6-12q5-5 10-1m13-5q6-3 10 1m13 10q6-2 8 3m-63 24q4 4 8 0m15 14q5 4 10-1m23-5q5 2 8-3m-39-22q-1-5 4-6" fill="none" stroke="#dcc4a3" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M42 87q6-7 14-6m16-6q7-3 13 1" fill="none" stroke="#fffdf2" stroke-width="3.5" stroke-linecap="round"/>
          <g data-wool-ready visibility="hidden">
            <path d="M28 100C18 93 23 77 36 77C35 65 50 59 60 65C68 54 83 57 90 64C105 57 120 67 120 77C136 76 145 91 138 103C148 116 136 133 123 133C117 147 100 148 90 141C77 151 59 145 55 140C40 146 26 135 28 125C17 121 17 106 28 100Z" fill="#fff5df" stroke="#a18461" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="M25 108C36 126 64 136 87 136C111 136 132 119 138 103C146 117 134 133 122 131C116 145 100 145 90 139C77 148 60 143 55 138C39 143 27 133 30 123C23 123 20 114 25 108Z" fill="#ead3b5" opacity=".58"/>
            <path d="M31 92c-4-10 10-16 15-8q3 6-4 8m9-20c1-9 15-10 17-1q1 6-6 6m15-11c6-7 17 1 12 8q-3 4-7 1m18-3c5-6 16 0 13 8m9 8c9-2 13 10 5 14m-72-8c-7-8 6-17 13-9q5 7-3 10m18-1c1-9 16-9 17 0q0 6-7 7m-53 11c-4-7 6-12 10-6m10 23c-6-9 8-16 14-8q3 5-3 8m17-12c-2-7 10-12 14-4q3 5-3 7m13-13c5 0 7 6 2 9" fill="none" stroke="#d9bd98" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M30 81q4-7 10-6m9-9q6-5 12 0m13-5q6-3 11 1m-50 58q2 7 8 7" fill="none" stroke="#fffdf4" stroke-width="3" stroke-linecap="round"/>
          </g>
        </g>
        <g data-head>
          <path d="M122 98C111 86 100 89 106 98Q111 107 126 107M151 95C161 86 174 89 169 97Q165 104 155 106" fill="#e2c19b" stroke="#9b7955" stroke-width="1.4"/>
          <path d="M109 94q6 0 12 7m45-7q-5 0-11 6" fill="none" stroke="#cba480" stroke-width="2" stroke-linecap="round"/>
          <path d="M119 98C104 98 101 82 109 75C119 65 132 74 132 84C133 93 122 97 117 90C113 85 117 80 122 83" fill="#ce965c" stroke="#97633d" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M151 94C164 92 168 78 160 71C150 63 139 70 141 80C142 89 153 91 157 83C159 78 153 75 150 79" fill="#d7a369" stroke="#97633d" stroke-width="1.7" stroke-linecap="round"/>
          <path d="M109 80q4-7 11-5m-13 12 6 2m1-16 3 6m37-8-3 6m10 1-6 1" fill="none" stroke="#efc897" stroke-width="1.8" stroke-linecap="round"/>
          <path data-max-face d="M121 96C120 87 130 82 141 85C153 86 161 95 162 106C163 116 155 123 144 124C132 125 121 118 120 108C119 104 120 100 121 96Z" fill="#efdabd" stroke="#a0805d" stroke-width="1.5"/>
          <path data-max-muzzle d="M133 111C137 107 141 109 146 110C150 108 156 110 158 114C159 120 150 123 144 122C137 122 132 117 133 111Z" fill="#faedd8"/>
          <path d="M121 97c-7-2-8-12 0-16c2-8 11-10 17-4c8-6 16-2 17 5c9 1 12 10 6 15q-7 3-12-3q-7 5-12-2q-8 7-16 5Z" fill="#fff4db" stroke="#a88a65" stroke-width="1.5"/>
          <path d="M124 86q0-6 6-5m9 4q3-6 8-2" fill="none" stroke="#d6b995" stroke-width="1.5" stroke-linecap="round"/>
          <g data-max-eyes>
            <ellipse cx="132" cy="103.5" rx="4.4" ry="5.1" fill="#aa7640"/><ellipse cx="151" cy="103.5" rx="3.8" ry="4.7" fill="#aa7640"/>
            <ellipse cx="132.4" cy="103.8" rx="2.7" ry="3.7" fill="#48382b"/><ellipse cx="151.3" cy="103.8" rx="2.3" ry="3.4" fill="#48382b"/>
            <path d="M128.8 106q3.1 3.1 6 0m13.7 0q2.5 2.5 5 0" fill="none" stroke="#d2a45b" stroke-width="1.1" stroke-linecap="round"/>
            <circle cx="133.2" cy="101.6" r="1.5" fill="#fffdf6"/><circle cx="152.1" cy="101.8" r="1.3" fill="#fffdf6"/>
            <circle cx="130.4" cy="106" r=".65" fill="#fff4d7"/><circle cx="149.4" cy="105.8" r=".55" fill="#fff4d7"/>
          </g>
          <g data-max-eyelids opacity="0">
            <path d="M126.5 98h11v12h-11Zm19 0h10v12h-10Z" fill="#efdabd"/>
            <path d="M128 104q4 3 8-1m12 1q3 3 6-1" fill="none" stroke="#947052" stroke-width="1.2" stroke-linecap="round"/>
          </g>
          <g data-max-glasses fill="none" stroke="#977957" stroke-width="1" stroke-linecap="round" opacity=".9">
            <ellipse cx="132" cy="103.5" rx="7.4" ry="7"/><ellipse cx="151" cy="103.5" rx="6.6" ry="6.5"/>
            <path d="M139.4 102q2.5-1.7 5 0m-22-3 2.2 2m33 1 2-1"/>
          </g>
          <path data-max-nose d="M143 112Q146 110 149 112Q148 115 146 115Q144 115 143 112Z" fill="#a38164"/>
          <path data-max-mouth d="m146 115v1.5m-3.5 0q3.5 3.5 7 0" fill="none" stroke="#a07d5e" stroke-width="1.1" stroke-linecap="round"/>
          <g data-max-tears visibility="hidden">
            <path d="M130 107q-3 6-2 9q3 3 4-1l-1-8M152 107q3 6 2 9q-3 3-4-1l1-8" fill="#aed7e6" stroke="#78a9b7" stroke-width=".6"/>
            <path d="m128 97 7-2m13 0 6 2" fill="none" stroke="#a0805e" stroke-width="1.3" stroke-linecap="round"/>
          </g>
          <ellipse cx="128" cy="112.5" rx="3.8" ry="2" fill="#dfa991" opacity=".3"/><ellipse cx="157" cy="112.5" rx="2.7" ry="1.8" fill="#dfa991" opacity=".24"/>
        </g>
      </g>
      <g data-max-celebration visibility="hidden" aria-hidden="true">
        <g data-effect-feed fill="#c77760" stroke="#985d4d" stroke-width="1.1">
          <path d="M65 42C45 30 56 19 65 28C74 19 85 30 65 42Z"/><path d="M93 53C82 46 89 40 93 45C99 39 105 46 93 53Z" opacity=".65"/>
        </g>
        <g data-effect-shear fill="#fff5df" stroke="#b79970" stroke-width="1.3">
          <path d="M56 35q-6-6 1-10q0-7 7-5q6-5 10 1q8 0 7 7q5 6-2 10q-1 7-8 5q-7 4-11-2q-7 0-4-6Z"/>
          <path d="m94 38 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#ddba6f" stroke="none"/>
        </g>
        <g data-effect-rub fill="#e6bc64" stroke="#a88035" stroke-width="1.1" stroke-linejoin="round">
          <path d="m66 19-8 15h8l-4 14 15-20h-9l5-9Z"/><path d="m92 43 2-7m5 12 6-3m-24-7-3-5" fill="none" stroke-width="2" stroke-linecap="round"/>
        </g>
      </g>
    </g>
  </svg>`;
  function mount(element, previous = {}) {
    if (!element) return null;
    element.innerHTML = markup();
    const hungry = Boolean(previous.hungry);
    const woolReady = previous.woolReady > 0;
    const longFleece = woolReady && !previous.shearedToday;
    const nodes = Object.fromEntries(
      ['facing', 'body', 'head', 'tail', 'fleece', 'shadow', 'max-eyelids', 'max-celebration'].map(
        (name) => [name, element.querySelector(`[data-${name}]`)],
      ),
    );
    const legs = hips.map((_, i) => {
      const node = element.querySelector(`[data-leg="${i}"]`);
      return {
        node,
        limb: node.querySelector('[data-limb]'),
        hoof: node.querySelector('[data-hoof]'),
        split: node.querySelector('[data-hoof-split]'),
      };
    });
    const effects = Object.fromEntries(
      ['feed', 'shear', 'rub'].map((kind) => [
        kind,
        element.querySelector(`[data-effect-${kind}]`),
      ]),
    );
    element.dataset.woolReady = String(woolReady);
    element.dataset.fleece = longFleece ? 'long' : 'short';
    element
      .querySelector('[data-wool-ready]')
      .setAttribute('visibility', longFleece ? 'visible' : 'hidden');
    element
      .querySelector('[data-max-tears]')
      .setAttribute('visibility', hungry ? 'visible' : 'hidden');
    if (hungry)
      element
        .querySelector('[data-max-mouth]')
        .setAttribute('d', 'm146 115v1.5m-3.5 3q3.5-3.5 7 0');
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let paused = Boolean(previous?.paused);
    let x = Number.isFinite(previous.x) ? previous.x : 12;
    let direction = previous.direction === -1 ? -1 : 1;
    let walkTime = 0;
    let motionTime = 0;
    let elapsed = 0;
    let mode = hungry ? 'hungry' : 'walk';
    let last = 0;
    let request = null;
    let effect = null;
    let effectTimer = null;
    let destroyed = false;
    const resting = () => ({
      angle: 0,
      bob: 17,
      standing: 0,
      legs: hips.map((hip) => ({
        hip: { x: hip.x, y: hip.y + 17 },
        foot: { x: hip.x + 16, y: GROUND },
        planted: true,
      })),
    });
    let pose = hungry ? resting() : walkPose(0);
    let startPose = pose;
    const actorWidth = () => element.clientWidth || 180;
    const scale = () => actorWidth() / 180;
    const width = () =>
      Math.max(0, (element.parentElement?.clientWidth || actorWidth()) - actorWidth());
    const canAnimate = () => !destroyed && !hungry && !paused && !media.matches && !document.hidden;
    const draw = () => {
      if (destroyed) return;
      x = Math.max(0, Math.min(width(), x));
      element.style.transform = `translateX(${x}px)`;
      element.dataset.pose = mode;
      element.dataset.paused = String(paused || media.matches || document.hidden);
      element.dataset.celebration = effect?.kind || '';
      nodes.facing.setAttribute('transform', direction < 0 ? 'translate(180 0) scale(-1 1)' : '');
      nodes.body.setAttribute('transform', `translate(0 ${pose.bob}) rotate(${pose.angle} 64 112)`);
      // The fleece breathes around the torso without moving the grounded skeleton.
      const breath = hungry ? 0 : Math.sin(motionTime * 2.2) * 0.008;
      nodes.fleece.setAttribute(
        'transform',
        `translate(81 114) scale(${1 + breath * 0.45} ${1 + breath}) translate(-81 -114)`,
      );
      const greeting = mode === 'greet' ? Math.sin((Math.min(3.2, elapsed) / 3.2) * Math.PI) : 0;
      nodes.tail.setAttribute(
        'transform',
        `rotate(${hungry ? 12 : Math.sin(motionTime * (greeting ? 9 : 4)) * (9 + greeting * 15)} 33 115)`,
      );
      // A soft nuzzle and a curious head tilt, never a human-like standing gesture.
      nodes.head.setAttribute(
        'transform',
        `translate(${greeting * 1.5} ${greeting * 3}) rotate(${hungry ? 6 : Math.sin(motionTime * 2.8) * 1.2 + greeting * (10 + Math.sin(elapsed * 4) * 4)} 126 112)`,
      );
      const blink = motionTime % 5.2;
      nodes['max-eyelids'].setAttribute('opacity', !hungry && blink > 4.95 ? '1' : '0');
      nodes.shadow.setAttribute('rx', String(hungry ? 57 : 54 - pose.standing * 12));
      pose.legs.forEach((leg, i) => {
        const { node, limb, hoof, split } = legs[i];
        limb.setAttribute('d', legPath(leg, i));
        const { x: fx, y: fy } = leg.foot;
        hoof.setAttribute('d', `M${fx - 5} ${fy - 8}q5-2 10 0l2 5q1 3-3 3h-9q-3 0-2-3Z`);
        split.setAttribute('d', `M${fx + 1} ${fy - 4}v3`);
        node.dataset.planted = String(leg.planted);
        node.dataset.footX = String(fx);
        node.dataset.footY = String(fy);
      });
      nodes['max-celebration'].setAttribute('visibility', effect ? 'visible' : 'hidden');
      if (effect) {
        Object.entries(effects).forEach(([kind, node]) => {
          node.setAttribute('visibility', kind === effect.kind ? 'visible' : 'hidden');
        });
        const { age } = effect;
        nodes['max-celebration'].setAttribute(
          'transform',
          `translate(0 ${-Math.min(10, age * 7)})`,
        );
        nodes['max-celebration'].setAttribute('opacity', String(Math.min(1, (1.8 - age) / 0.35)));
      } else {
        Object.values(effects).forEach((node) => node.setAttribute('visibility', 'hidden'));
      }
    };
    const stopFrame = () => {
      if (request !== null) window.cancelAnimationFrame(request);
      request = null;
    };
    const scheduleFrame = () => {
      if (canAnimate() && request === null) request = window.requestAnimationFrame(frame);
      else if (!canAnimate()) stopFrame();
    };
    const clearEffect = () => {
      if (effectTimer !== null) window.clearTimeout(effectTimer);
      effectTimer = null;
      effect = null;
    };
    const greet = () => {
      if (destroyed || hungry || document.hidden || mode === 'greet') return false;
      startPose = pose;
      elapsed = 0;
      mode = 'greet';
      if (media.matches || paused) {
        elapsed = 1.2;
        pose = greetPose(startPose, elapsed);
      }
      draw();
      scheduleFrame();
      return true;
    };
    const celebrate = (kind) => {
      if (destroyed || document.hidden || !Object.hasOwn(effects, kind)) return false;
      clearEffect();
      effect = { kind, age: 0 };
      // A static, briefly visible acknowledgement also works without motion.
      effectTimer = window.setTimeout(() => {
        effectTimer = null;
        effect = null;
        draw();
      }, 1800);
      draw();
      scheduleFrame();
      return true;
    };
    const frame = (stamp) => {
      request = null;
      if (!canAnimate()) return;
      const delta = last ? Math.min(0.05, (stamp - last) / 1000) : 0;
      last = stamp;
      motionTime += delta;
      if (effect) effect.age = Math.min(1.8, effect.age + delta);
      if (mode === 'walk') {
        // Match CSS scaling in world space so planted hooves do not drift.
        const next = x + direction * SPEED * scale() * delta;
        if (next < 0 || next > width()) greet();
        else {
          x = next;
          walkTime += delta;
          pose = walkPose(walkTime);
        }
      } else {
        elapsed += delta;
        if (elapsed < 3.2) pose = greetPose(startPose, elapsed);
        else {
          mode = 'walk';
          pose = walkPose(walkTime);
          if (x < 2 || x > width() - 2) direction *= -1;
        }
      }
      draw();
      scheduleFrame();
    };
    const onMotion = () => {
      last = 0;
      if (media.matches && !hungry) {
        mode = 'walk';
        pose = greetPose(walkPose(walkTime), 1);
      }
      draw();
      scheduleFrame();
    };
    const onVisibility = () => {
      last = 0;
      if (document.hidden) clearEffect();
      draw();
      scheduleFrame();
    };
    const onResize = () => draw();
    media.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    if (media.matches && !hungry) pose = greetPose(walkPose(0), 1);
    draw();
    scheduleFrame();
    return {
      greet,
      celebrate,
      pause(value) {
        if (destroyed) return;
        paused = Boolean(value);
        last = 0;
        draw();
        scheduleFrame();
      },
      snapshot: () => ({ x, direction, paused }),
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopFrame();
        clearEffect();
        media.removeEventListener('change', onMotion);
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('resize', onResize);
      },
    };
  }
  return { GROUND, SPEED, walkPose, standPose, greetPose, blend, legPath, mount };
});
