((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FreeBbsRanchWorld = api;
})(globalThis, () => {
  const seedFor = (value) => {
    let hash = 2166136261;
    // eslint-disable-next-line no-bitwise
    for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    // eslint-disable-next-line no-bitwise
    return hash >>> 0;
  };
  const layout = (uid, index, total) => {
    const lanes = Math.max(4, Math.min(9, Math.ceil(Math.sqrt(Math.max(1, total)) * 1.45)));
    const lane = index % lanes;
    const depth = lane / (lanes - 1);
    return { top: 59 + depth * 21, scale: 0.64 + depth * 0.4, zIndex: 20 + lane };
  };
  function basePosition(uid, time) {
    const seed = seedFor(uid);
    const period = 140000 + (seed % 40000);
    const phase = ((time + (seed % period)) % period) / period;
    return {
      x: 4 + (phase < 0.5 ? phase * 2 : 2 - phase * 2) * 92,
      direction: phase < 0.5 ? 1 : -1,
    };
  }
  function ambientEvents(sheep, time) {
    if (sheep.length < 2) return [];
    const block = Math.floor(time / 30000);
    const index = seedFor(block) % sheep.length;
    const partner = (index + 1) % sheep.length;
    return [
      {
        id: `ambient:${block}`,
        actor: sheep[index].uid,
        partner: sheep[partner].uid,
        kind: block % 3 ? 'greet' : 'stroll',
        start: block * 30000 + 18000,
        duration: block % 3 ? 3500 : 12000,
      },
    ];
  }
  function positionFor(sheep, index, all, time, events = []) {
    const base = {
      ...basePosition(sheep.uid, time),
      ...layout(sheep.uid, index, all.length),
      kind: 'walk',
      progress: 0,
      time: time / 1000,
    };
    const seed = seedFor(sheep.uid);
    const phase = (time + (seed % 60000)) % 60000;
    if (sheep.assets?.ranch_backflip && phase < 2100) {
      base.kind = 'backflip';
      base.progress = phase / 2100;
    } else if (sheep.assets?.ranch_bicycle && phase > 28000 && phase < 38000) {
      base.kind = 'bicycle';
      base.progress = (phase - 28000) / 10000;
    }
    const event = [...ambientEvents(all, time), ...events]
      .reverse()
      .find(
        (item) =>
          (item.actor === sheep.uid || item.partner === sheep.uid) &&
          time >= item.start &&
          time < item.start + item.duration,
      );
    if (!event) return base;
    const progress = (time - event.start) / event.duration;
    if (event.kind === 'stroll') {
      const actorIndex = all.findIndex((item) => item.uid === event.actor);
      const actor = basePosition(event.actor, event.start);
      const partner = basePosition(event.partner, event.start);
      const center = Math.max(15, Math.min(85, (actor.x + partner.x) / 2));
      const direction = actor.direction;
      const side = event.actor === sheep.uid ? -5 : 5;
      const pairedX = Math.max(
        4,
        Math.min(96, center + side + direction * Math.max(0, progress - 0.25) * 15),
      );
      const pairedTop = layout(event.actor, Math.max(0, actorIndex), all.length);
      const mix = Math.min(1, progress / 0.25, (1 - progress) / 0.2);
      base.x = base.x * (1 - mix) + pairedX * mix;
      base.top = base.top * (1 - mix) + pairedTop.top * mix;
      base.scale = base.scale * (1 - mix) + pairedTop.scale * mix;
      base.direction = direction;
    }
    return { ...base, kind: event.kind, progress, eventId: event.id };
  }
  return { seedFor, layout, basePosition, ambientEvents, positionFor };
});
