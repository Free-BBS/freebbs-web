(function expose(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.FreeBbsRanchDesignData = api;
})(() => {
  const MAX_LAYERS = 64;
  const modes = ['splat', 'rings', 'stripes', 'spiral'];
  const blends = ['normal', 'multiply', 'screen', 'overlay', 'soft-light'];
  const blank = () => ({
    version: 1,
    wool: { base: null, layers: [] },
    face: { base: null, layers: [] },
    horns: { left: null, right: null },
  });
  function invalid() {
    throw new Error('花纹格式不正确，请重新打开染坊');
  }
  function color(value) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) invalid();
    return value.toLowerCase();
  }
  function number(value, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      invalid();
    return Math.round(value * 10000) / 10000;
  }
  function validate(value) {
    if (!value || value.version !== 1) invalid();
    const result = blank();
    for (const side of ['left', 'right']) {
      const horn = value.horns?.[side] ?? null;
      if (![null, 'gold', 'silver'].includes(horn)) invalid();
      result.horns[side] = horn;
    }
    for (const part of ['wool', 'face']) {
      const input = value[part];
      if (!input || !Array.isArray(input.layers) || input.layers.length > MAX_LAYERS) invalid();
      result[part].base = input.base === null ? null : color(input.base);
      result[part].layers = input.layers.map((layer) => {
        if (!layer || !modes.includes(layer.mode) || !blends.includes(layer.blend)) invalid();
        return {
          mode: layer.mode,
          blend: layer.blend,
          color: color(layer.color),
          x: number(layer.x, 0, 1),
          y: number(layer.y, 0, 1),
          radius: number(layer.radius, 0.04, 1),
          opacity: number(layer.opacity, 0.05, 1),
          angle: number(layer.angle, 0, 360),
        };
      });
    }
    return result;
  }
  function read(value) {
    try {
      return validate(typeof value === 'string' ? JSON.parse(value) : value);
    } catch {
      return blank();
    }
  }
  return { MAX_LAYERS, modes, blends, blank, validate, read };
});
