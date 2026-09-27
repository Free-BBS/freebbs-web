(() => {
  const data = window.FreeBbsRanchDesignData;
  const ns = 'http://www.w3.org/2000/svg';
  let sequence = 0;
  const bounds = { wool: { x: 20, y: 57, w: 124, h: 92 }, face: { x: 119, y: 84, w: 44, h: 41 } };
  function svgNode(name, attributes = {}) {
    const node = document.createElementNS(ns, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
  function layerNode(layer, box, defs, prefix) {
    const x = box.x + layer.x * box.w;
    const y = box.y + layer.y * box.h;
    const radius = layer.radius * Math.max(box.w, box.h);
    const gradient = svgNode('radialGradient', { id: prefix });
    // Gaussian falloff: sigma = radius / 3. No expensive SVG blur filter per dab.
    for (let i = 0; i <= 10; i += 1) {
      const t = i / 10;
      gradient.append(
        svgNode('stop', {
          offset: `${i * 10}%`,
          'stop-color': layer.color,
          'stop-opacity': i === 10 ? 0 : Math.exp(-4.5 * t * t),
        }),
      );
    }
    defs.append(gradient);
    const group = svgNode('g', {
      opacity: layer.opacity,
      transform: `translate(${x} ${y}) rotate(${layer.angle})`,
    });
    group.style.mixBlendMode = layer.blend;
    if (layer.mode === 'splat') {
      group.append(svgNode('circle', { r: radius, fill: `url(#${prefix})` }));
    } else if (layer.mode === 'rings') {
      group.append(svgNode('circle', { r: radius, fill: `url(#${prefix})`, opacity: 0.5 }));
      for (let i = 1; i <= 5; i += 1)
        group.append(
          svgNode('circle', {
            r: (radius * i) / 5,
            fill: 'none',
            stroke: layer.color,
            'stroke-width': radius * 0.07,
            opacity: 1 - i * 0.1,
          }),
        );
    } else if (layer.mode === 'stripes') {
      for (let i = -3; i <= 3; i += 1)
        group.append(
          svgNode('path', {
            d: `M${-radius} ${(i * radius) / 3} Q0 ${(i * radius) / 3 + radius / 5} ${radius} ${(i * radius) / 3}`,
            fill: 'none',
            stroke: layer.color,
            'stroke-width': radius * 0.12,
            'stroke-linecap': 'round',
          }),
        );
    } else {
      let d = '';
      for (let i = 0; i <= 100; i += 1) {
        const t = i / 100;
        const theta = t * Math.PI * 6;
        d += `${i ? 'L' : 'M'}${Math.cos(theta) * t * radius} ${Math.sin(theta) * t * radius} `;
      }
      group.append(
        svgNode('path', {
          d,
          fill: 'none',
          stroke: layer.color,
          'stroke-width': radius * 0.08,
          'stroke-linecap': 'round',
        }),
      );
    }
    return group;
  }
  function apply(root, value) {
    const svg = root?.matches?.('svg') ? root : root?.querySelector('svg');
    if (!svg) return;
    const design = data.read(value);
    svg.querySelectorAll('[data-ranch-dye-layer]').forEach((node) => node.remove());
    const defs = svgNode('defs', { 'data-ranch-dye-layer': '' });
    svg.prepend(defs);
    for (const side of ['left', 'right']) {
      const horn = svg.querySelector(`[data-horn-${side}]`);
      if (!horn) continue;
      if (!horn.dataset.originalFill) horn.dataset.originalFill = horn.getAttribute('fill');
      if (!horn.dataset.originalStroke) horn.dataset.originalStroke = horn.getAttribute('stroke');
      const metal = design.horns[side];
      if (!metal) {
        horn.setAttribute('fill', horn.dataset.originalFill);
        horn.setAttribute('stroke', horn.dataset.originalStroke);
        continue;
      }
      const id = `ranch-horn-${(sequence += 1)}`;
      const gradient = svgNode('linearGradient', {
        id,
        x1: '0%',
        y1: '0%',
        x2: '100%',
        y2: '100%',
      });
      const colors =
        metal === 'gold' ? ['#fff2c9', '#cb9434', '#ffe5a0'] : ['#f7fbff', '#8a9ba8', '#e3edf4'];
      colors.forEach((color, i) =>
        gradient.append(svgNode('stop', { offset: `${i * 50}%`, 'stop-color': color })),
      );
      defs.append(gradient);
      horn.setAttribute('fill', `url(#${id})`);
      horn.setAttribute('stroke', metal === 'gold' ? '#a97832' : '#71818f');
    }
    const targets = [
      [svg.querySelector('[data-wool-base]'), 'wool'],
      [svg.querySelector('[data-wool-ready] > path'), 'wool'],
      [svg.querySelector('[data-max-face]'), 'face'],
    ];
    for (const [base, part] of targets) {
      if (!base) continue;
      if (!base.dataset.originalFill) base.dataset.originalFill = base.getAttribute('fill');
      base.setAttribute('fill', design[part].base || base.dataset.originalFill);
      const prefix = `ranch-dye-${(sequence += 1)}`;
      const clip = svgNode('clipPath', { id: `${prefix}-clip` });
      clip.append(svgNode('path', { d: base.getAttribute('d') }));
      defs.append(clip);
      const group = svgNode('g', {
        'data-ranch-dye-layer': '',
        'clip-path': `url(#${prefix}-clip)`,
        'pointer-events': 'none',
      });
      // Include the base in an isolated group so blend modes operate on this part only.
      group.style.isolation = 'isolate';
      group.append(svgNode('path', { d: base.getAttribute('d'), fill: base.getAttribute('fill') }));
      design[part].layers.forEach((layer, index) =>
        group.append(layerNode(layer, bounds[part], defs, `${prefix}-${index}`)),
      );
      base.after(group);
    }
  }
  const cache = new Map();
  const requests = new WeakMap();
  async function load(uid, actor) {
    if (!actor || !/^u_?[a-z0-9]{6,32}$/i.test(uid || '')) return;
    actor.dataset.designOwner = uid;
    const ticket = {};
    requests.set(actor, ticket);
    try {
      if (!cache.has(uid)) {
        const base = window.freeBbsApp?.apiBaseUrl || window.FREEBBS_API_BASE || '/api';
        cache.set(
          uid,
          fetch(`${base}/ranch-designs/${encodeURIComponent(uid)}`)
            .then((response) => {
              if (!response.ok) throw new Error('Unavailable');
              return response.json();
            })
            .catch((error) => {
              cache.delete(uid);
              throw error;
            }),
        );
      }
      const result = await cache.get(uid);
      if (actor.isConnected && actor.dataset.designOwner === uid && requests.get(actor) === ticket)
        apply(actor, result.design);
    } catch {
      /* A network failure must not hide the sheep or stop its animation. */
    }
  }
  window.addEventListener('pageshow', () => {
    cache.clear();
    document
      .querySelectorAll('[data-design-owner]')
      .forEach((actor) => load(actor.dataset.designOwner, actor));
  });
  window.addEventListener('storage', (event) => {
    if (event.key === 'freebbs_ranch_design_updated') {
      cache.clear();
      document
        .querySelectorAll('[data-design-owner]')
        .forEach((actor) => load(actor.dataset.designOwner, actor));
    }
  });
  window.FreeBbsRanchDesign = { apply, load, bounds };
})();
