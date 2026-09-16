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
    { x: 58, y: 113 },
    { x: 114, y: 110 },
    { x: 64, y: 114 },
    { x: 120, y: 111 },
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
          x: i === 3 ? 113 + Math.sin(time * 6) * 5 : 46,
          y: i === 3 ? 49 + Math.cos(time * 6) * 5 : 95,
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
  function legPath(leg, index) {
    const { hip, foot } = leg;
    const dx = foot.x - hip.x;
    const dy = foot.y - hip.y;
    const distance = Math.hypot(dx, dy) || 1;
    const bend = Math.sqrt(Math.max(0, 31 * 31 - (distance * distance) / 4));
    const sign = index % 2 ? -1 : 1;
    const knee = {
      x: (hip.x + foot.x) / 2 + (dy / distance) * bend * sign,
      y: (hip.y + foot.y) / 2 - (dx / distance) * bend * sign,
    };
    return `M ${hip.x} ${hip.y} Q ${knee.x} ${knee.y} ${foot.x} ${foot.y - 4}`;
  }
  const limbMarkup = (i) =>
    `<g data-leg="${i}"><path data-limb fill="none" stroke="${i < 2 ? '#8b8e88' : '#d8d2bd'}" stroke-width="9" stroke-linecap="round"/><path data-hoof fill="${i < 2 ? '#354848' : '#425c5b'}" stroke="#263e3d" stroke-width="1.5"/></g>`;
  const markup =
    () => `<svg viewBox="0 0 180 180" role="img" aria-label="Max：四肢行走、后腿站立的电子仿生羊">
    <g data-facing>
      <ellipse cx="88" cy="165" rx="55" ry="5" fill="#1e4239" opacity=".16"/>
      ${limbMarkup(0)}${limbMarkup(1)}
      <g data-body>
        <path d="M44 105q-22-3-12-17q9-5 14 9" fill="#e8e1c9" stroke="#54665b" stroke-width="2.2"/>
        <path d="M43 94Q35 82 48 76Q46 62 62 65Q67 50 81 60Q92 49 103 61Q120 57 124 73Q137 78 131 92Q139 108 122 114Q117 128 103 121Q92 133 79 123Q60 133 55 119Q38 120 43 106Z" fill="#f9f1d9" stroke="#53685e" stroke-width="2.4"/>
        <path d="M55 91q8-12 17-3m7-17q8-8 16 1m6 31q12 5 19-3m-59 13q8 6 16 0" fill="none" stroke="#d6ccb0" stroke-width="2.2" stroke-linecap="round"/>
        <g data-head>
          <path d="M128 74q-17-15-23-5q-3 10 15 14m26-11q13-14 18-5q3 7-11 15" fill="#b8b9a3" stroke="#53685e" stroke-width="2"/>
          <path d="M126 77q-10-15-1-19q10-3 13 10" fill="#cfad75" stroke="#826f50" stroke-width="2"/>
          <path d="M147 74q12-14 7-20q-8-6-13 8" fill="#cfad75" stroke="#826f50" stroke-width="2"/>
          <path data-max-face d="M120 78q0-19 19-19q18 0 20 17l-3 26q-17 17-33-1Z" fill="#d9bd95" stroke="#705a45" stroke-width="2"/>
          <path d="M119 79q-6-10 2-15q1-10 11-7q8-9 14-1q13-1 14 11q8 10-3 14q-5-10-11-5q-9 6-12-1q-7 8-15 4" fill="#fff7e1" stroke="#53685e" stroke-width="2"/>
          <ellipse cx="139" cy="97" rx="13" ry="10" fill="#eddbc1"/>
          <ellipse cx="129" cy="85" rx="3" ry="4" fill="#203d38"/><ellipse cx="149" cy="85" rx="3" ry="4" fill="#203d38"/>
          <circle cx="130" cy="84" r="1" fill="white"/><circle cx="150" cy="84" r="1" fill="white"/>
          <path data-max-mouth d="m136 94 4 2 3-2m-3 2v4m-6 0q6 6 12 0" fill="none" stroke="#705a45" stroke-width="1.7" stroke-linecap="round"/>
          <g data-max-tears visibility="hidden">
            <path d="M127 88q-4 8-2 13q3 4 5 0l-1-13M150 88q4 8 2 13q-3 4-5 0l1-13" fill="#87cbea" stroke="#4c96b5" stroke-width="0.8"/>
            <path d="m125 80 7-2m14 0 7 2" fill="none" stroke="#705a45" stroke-width="1.8" stroke-linecap="round"/>
          </g>
          <circle cx="125" cy="95" r="3" fill="#d5a58a" opacity=".7"/><circle cx="154" cy="95" r="3" fill="#d5a58a" opacity=".7"/>
          <path d="m122 111 13 3 17-4" fill="none" stroke="#2d8e90" stroke-width="5"/>
          <rect x="133" y="114" width="10" height="9" rx="3" fill="#ecd184" stroke="#627767" stroke-width="1"/>
          <path d="m136 116 2 2-2 2m4-4v4" stroke="#46665b" fill="none"/>
        </g>
      </g>
      ${limbMarkup(2)}${limbMarkup(3)}
    </g>
  </svg>`;
  function mount(element, previous = {}) {
    if (!element) return null;
    element.innerHTML = markup();
    const hungry = Boolean(previous.hungry);
    element
      .querySelector('[data-max-tears]')
      .setAttribute('visibility', hungry ? 'visible' : 'hidden');
    if (hungry)
      element.querySelector('[data-max-mouth]').setAttribute('d', 'm136 94 4 2 3-2m-8 10q5-7 10 0');
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let paused = Boolean(previous?.paused);
    let x = previous?.x || 12;
    let direction = previous?.direction || 1;
    let walkTime = 0;
    let elapsed = 0;
    let mode = hungry ? 'hungry' : 'walk';
    let last = 0;
    let request;
    let destroyed = false;
    const resting = () => ({
      angle: 0,
      bob: 34,
      standing: 0,
      legs: hips.map((hip) => ({
        hip: { x: hip.x, y: hip.y + 34 },
        foot: { x: hip.x + 16, y: GROUND },
        planted: true,
      })),
    });
    let pose = hungry ? resting() : walkPose(0);
    let startPose = pose;
    const width = () => Math.max(0, element.parentElement.clientWidth - 180);
    const draw = () => {
      x = Math.max(0, Math.min(width(), x));
      element.style.transform = `translateX(${x}px)`;
      element.dataset.pose = mode;
      element.dataset.paused = String(paused || media.matches);
      element
        .querySelector('[data-facing]')
        .setAttribute('transform', direction < 0 ? 'translate(180 0) scale(-1 1)' : '');
      element
        .querySelector('[data-body]')
        .setAttribute('transform', `translate(0 ${pose.bob}) rotate(${pose.angle} 64 112)`);
      // Keep the face upright as the torso rears up.
      element
        .querySelector('[data-head]')
        .setAttribute('transform', `rotate(${-pose.angle * 0.8} 138 86)`);
      pose.legs.forEach((leg, i) => {
        const node = element.querySelector(`[data-leg="${i}"]`);
        node.querySelector('[data-limb]').setAttribute('d', legPath(leg, i));
        const { x: fx, y: fy } = leg.foot;
        node.querySelector('[data-hoof]').setAttribute('d', `M${fx - 6} ${fy - 7}h11l2 7h-14Z`);
        node.dataset.planted = String(leg.planted);
        node.dataset.footY = String(fy);
      });
    };
    const greet = () => {
      if (hungry) return;
      if (mode === 'greet') return;
      startPose = pose;
      elapsed = 0;
      mode = 'greet';
      if (media.matches || paused) pose = standPose();
      draw();
    };
    const frame = (stamp) => {
      if (destroyed) return;
      const delta = last ? Math.min(0.05, (stamp - last) / 1000) : 0;
      last = stamp;
      if (!hungry && !paused && !media.matches && !document.hidden) {
        if (mode === 'walk') {
          const next = x + direction * SPEED * delta;
          if (next < 0 || next > width()) greet();
          else {
            x = next;
            walkTime += delta;
            pose = walkPose(walkTime);
          }
        } else {
          elapsed += delta;
          if (elapsed < 0.3) pose = blend(startPose, standPose(0), smooth(elapsed / 0.3));
          else if (elapsed < 1.3) pose = standPose(smooth(elapsed - 0.3));
          else if (elapsed < 3.3) pose = standPose(1, elapsed - 1.3);
          else if (elapsed < 4.3) pose = standPose(1 - smooth(elapsed - 3.3));
          else if (elapsed < 4.6)
            pose = blend(standPose(0), walkPose(0), smooth((elapsed - 4.3) / 0.3));
          else {
            mode = 'walk';
            walkTime = 0;
            pose = walkPose(0);
            if (x < 2 || x > width() - 2) direction *= -1;
          }
        }
        draw();
      }
      request = window.requestAnimationFrame(frame);
    };
    const onMotion = () => {
      last = 0;
      if (hungry) {
        pose = resting();
        draw();
        return;
      }
      if (media.matches) {
        mode = 'walk';
        pose = standPose(0);
      }
      draw();
    };
    media.addEventListener('change', onMotion);
    if (media.matches && !hungry) pose = standPose(0);
    draw();
    request = window.requestAnimationFrame(frame);
    return {
      greet,
      pause(value) {
        paused = value;
        last = 0;
        draw();
      },
      snapshot: () => ({ x, direction, paused }),
      destroy() {
        destroyed = true;
        window.cancelAnimationFrame(request);
        media.removeEventListener('change', onMotion);
      },
    };
  }
  return { GROUND, SPEED, walkPose, standPose, blend, legPath, mount };
});
