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
  function travelBoost(uid, time, assets = {}, gear = undefined) {
    const seed = seedFor(uid);
    if (gear === 'wing') {
      const shifted = time + (seed % 60000);
      const phase = shifted % 60000;
      return Math.floor(shifted / 60000) * 48000 + Math.max(0, Math.min(24000, phase)) * 2;
    }
    if (gear === 'bicycle' || (gear === undefined && assets.ranch_bicycle)) {
      const shifted = time + (seed % 60000);
      const phase = shifted % 60000;
      // Integrate the speed boost, so dismounting never snaps back to the walking path.
      return Math.floor(shifted / 60000) * 30000 + Math.max(0, Math.min(10000, phase - 28000)) * 3;
    }
    return 0;
  }
  function basePosition(uid, time, assets = {}, motion = null, gear = undefined) {
    const seed = seedFor(uid);
    const period = 140000 + (seed % 40000);
    let travel = time + travelBoost(uid, time, assets, gear);
    if (motion)
      travel +=
        motion.offset +
        Math.max(0, Math.min(motion.duration, time - motion.start)) * (motion.bonus ?? 3);
    const phase = ((travel + (seed % period)) % period) / period;
    return {
      x: 4 + (phase < 0.5 ? phase * 2 : 2 - phase * 2) * 92,
      direction: phase < 0.5 ? 1 : -1,
    };
  }
  function ambientEvents(sheep, time) {
    sheep = sheep.filter((item) => item.fedUntilMs === undefined || item.fedUntilMs > time);
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
    const hungry = sheep.fedUntilMs !== undefined && sheep.fedUntilMs <= time;
    const seed = seedFor(sheep.uid);
    const base = {
      ...basePosition(
        sheep.uid,
        hungry ? sheep.fedUntilMs : time,
        sheep.assets,
        sheep.motion,
        sheep.gear,
      ),
      ...layout(sheep.uid, index, all.length),
      gear: sheep.gear,
      kind: hungry ? 'hungry' : 'walk',
      hungry,
      progress: 0,
      time: time / 1000,
      // Stable per-sheep rhythm: viewers see the same gait without the flock marching in lockstep.
      animationTime: (time / 1000) * (0.94 + (seed % 13) * 0.01) + ((seed % 997) / 997) * 1.2,
    };
    if (hungry) return base;
    const phase = (time + (seed % 60000)) % 60000;
    if (sheep.gear === 'wing' && phase < 24000) {
      const lift = Math.min(1, phase / 4500, (24000 - phase) / 4500);
      const ease = lift * lift * (3 - 2 * lift);
      base.kind = 'fly';
      base.progress = phase / 24000;
      base.top =
        base.top * (1 - ease) +
        ease * Math.min(33, base.top - 28) +
        ease * Math.sin(phase / 900) * 1.5;
    } else if (sheep.assets?.ranch_backflip && phase < 1500) {
      base.kind = 'backflip';
      base.progress = phase / 1500;
    } else if (
      (sheep.gear === 'bicycle' || (sheep.gear === undefined && sheep.assets?.ranch_bicycle)) &&
      phase > 28000 &&
      phase < 38000
    ) {
      base.kind = 'bicycle';
      base.progress = (phase - 28000) / 10000;
    }
    const event = [...ambientEvents(all, time), ...events]
      .reverse()
      .find(
        (item) =>
          (item.actor === sheep.uid || item.partner === sheep.uid) &&
          (!item.partner ||
            !all.some(
              (actor) =>
                actor.uid === item.partner &&
                actor.fedUntilMs !== undefined &&
                actor.fedUntilMs <= time,
            )) &&
          !all.some(
            (actor) =>
              actor.uid === item.actor &&
              actor.fedUntilMs !== undefined &&
              actor.fedUntilMs <= time,
          ) &&
          time >= item.start &&
          time < item.start + item.duration,
      );
    if (!event) return base;
    const progress = (time - event.start) / event.duration;
    if (event.kind === 'fly') {
      const rise = Math.min(1, progress / 0.24, (1 - progress) / 0.23);
      const ease = Math.max(0, rise) ** 2 * (3 - 2 * Math.max(0, rise));
      base.top = base.top * (1 - ease) + ease * Math.max(22, Math.min(32, base.top - 30));
      base.kind = 'fly';
      base.progress = progress;
      base.eventId = event.id;
      return base;
    }
    if (event.kind === 'stroll' && event.origin && event.meeting) {
      const own = event.actor === sheep.uid;
      const approaching = Math.min(1, progress / 0.35);
      const approach = approaching * approaching * (3 - 2 * approaching);
      const side = own ? (event.origin.x < event.meeting.x ? -5 : 5) : 0;
      const direction = event.meeting.direction;
      const drift = direction * Math.max(0, progress - 0.35) * 18;
      const pairedX = Math.max(4, Math.min(96, event.meeting.x + side + drift));
      const from = own ? event.origin : event.meeting;
      const returning = Math.max(0, Math.min(1, (progress - 0.8) / 0.2));
      const returnMix = returning * returning * (3 - 2 * returning);
      base.x =
        (from.x + (pairedX - from.x) * (own ? approach : 1)) * (1 - returnMix) + base.x * returnMix;
      base.top =
        (from.top + (event.meeting.top - from.top) * (own ? approach : 1)) * (1 - returnMix) +
        base.top * returnMix;
      base.scale =
        (from.scale + (event.meeting.scale - from.scale) * (own ? approach : 1)) * (1 - returnMix) +
        base.scale * returnMix;
      base.direction =
        own && progress < 0.35 ? (event.meeting.x >= event.origin.x ? 1 : -1) : direction;
      return {
        ...base,
        kind: own || progress >= 0.35 ? 'stroll' : 'greet',
        progress,
        eventId: event.id,
      };
    }
    if (event.kind === 'stroll') {
      const actorIndex = all.findIndex((item) => item.uid === event.actor);
      const leader = all[actorIndex];
      const companion = all.find((item) => item.uid === event.partner);
      const actor = basePosition(
        event.actor,
        event.start,
        leader?.assets,
        leader?.motion,
        leader?.gear,
      );
      const partner = basePosition(
        event.partner,
        event.start,
        companion?.assets,
        companion?.motion,
        companion?.gear,
      );
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
  return { seedFor, layout, travelBoost, basePosition, ambientEvents, positionFor };
});
