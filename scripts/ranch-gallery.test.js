const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const world = require('../public/ranch-world-data');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const sheep = Array.from({ length: 24 }, (_, i) => ({ uid: `u_owner${i}`, assets: {} }));

test('shared positions are deterministic across clients and late arrivals, with grounded depth', () => {
  const positions = sheep.map((actor, i) => world.positionFor(actor, i, sheep, 100000));
  assert.deepEqual(
    positions,
    sheep.map((actor, i) => world.positionFor(actor, i, sheep, 100000)),
  );
  assert.ok(new Set(positions.map((point) => point.top)).size >= 5);
  assert.ok(positions.some((point) => point.x > 75));
  assert.ok(positions.some((point) => point.x < 25));
  for (const point of positions) {
    assert.ok(point.x >= 4 && point.x <= 96);
    assert.ok(point.top >= 59 && point.top <= 80);
    assert.ok(point.scale >= 0.64 && point.scale <= 1.04);
  }
});
test('each sheep keeps an independent but deterministic animation rhythm', () => {
  const time = 100000;
  const frames = sheep.map((actor, index) => world.positionFor(actor, index, sheep, time));
  const phases = frames.map((frame) => (frame.animationTime % 1.2).toFixed(2));
  assert.ok(new Set(phases).size > sheep.length / 2, 'the flock does not step in unison');
  frames.forEach((frame, index) => {
    const repeated = world.positionFor(sheep[index], index, sheep, time);
    const next = world.positionFor(sheep[index], index, sheep, time + 1000);
    assert.equal(repeated.animationTime, frame.animationTime);
    assert.ok(next.animationTime - frame.animationTime >= 0.939);
    assert.ok(next.animationTime - frame.animationTime <= 1.061);
  });
});
test('paired stroll joins two sheep in a shared lane and walks in the same direction', () => {
  const event = {
    id: 1,
    actor: sheep[0].uid,
    partner: sheep[10].uid,
    kind: 'stroll',
    start: 100000,
    duration: 12000,
  };
  const a = world.positionFor(sheep[0], 0, sheep, 105000, [event]);
  const b = world.positionFor(sheep[10], 10, sheep, 105000, [event]);
  assert.equal(a.top, b.top);
  assert.equal(a.scale, b.scale);
  assert.equal(a.direction, b.direction);
  assert.equal(a.eventId, 1);
  assert.equal(b.eventId, 1);
  assert.ok(Math.abs(Math.abs(a.x - b.x) - 10) < 0.001);
});
test('random-looking tricks and vehicles require a purchased unlock and use a shared clock', () => {
  const actor = { uid: 'u_owner01', assets: { ranch_backflip: 1, ranch_bicycle: 1 } };
  const start = 60000 - (world.seedFor(actor.uid) % 60000);
  assert.equal(world.positionFor(actor, 0, [actor], start + 1000).kind, 'backflip');
  assert.equal(world.positionFor(actor, 0, [actor], start + 32000).kind, 'bicycle');
  assert.equal(world.positionFor({ ...actor, assets: {} }, 0, [actor], start + 1000).kind, 'walk');
  assert.equal(world.positionFor({ ...actor, assets: {} }, 0, [actor], start + 32000).kind, 'walk');
});
test('shared gallery uses SSE and server actions instead of local random interactions', () => {
  const html = read('public/ranch-gallery.html');
  const source = read('public/ranch-gallery.js');
  assert.match(html, /data-community-action="stroll"/);
  assert.match(html, /ranch-world-data\.js/);
  assert.match(html, /value="wing">中国羊能飞/);
  assert.match(html, /data-community-action="fly"/);
  assert.match(html, /id="community-clover"/);
  assert.match(html, /id="community-wind-status"/);
  assert.match(source, /new EventSource/);
  assert.match(source, /ranch-world\/actions/);
  assert.match(source, /syncFrame/);
  assert.doesNotMatch(source, /Math\.random|pickPartner|walkTo/);
  assert.match(source, /stream\?\.close/);
  assert.match(source, /lastSnapshot \+ 5000/);
  assert.match(source, /submit\('clover'\)/);
  assert.match(source, /ranch-world\/clovers/);
});
test('equipped wings fly high on a shared clock, while bicycle and wing never appear together', () => {
  const actor = {
    uid: 'u_owner01',
    gear: 'wing',
    assets: { ranch_bicycle: 1, ranch_flying_wings: 1 },
  };
  const start = 60000 - (world.seedFor(actor.uid) % 60000);
  const risen = world.positionFor(actor, 0, [actor], start + 12000);
  assert.equal(risen.kind, 'fly');
  assert.equal(risen.gear, 'wing');
  assert.ok(risen.top <= 34);
  assert.notEqual(world.positionFor(actor, 0, [actor], start + 32000).kind, 'bicycle');
  const bike = { ...actor, gear: 'bicycle' };
  assert.equal(world.positionFor(bike, 0, [bike], start + 32000).kind, 'bicycle');
  assert.notEqual(world.positionFor(bike, 0, [bike], start + 12000).kind, 'fly');
  const landing = world.positionFor(actor, 0, [actor], start + 24000);
  assert.equal(landing.kind, 'walk');
  assert.equal(landing.gear, 'wing');
  const manual = { id: 4, actor: actor.uid, kind: 'fly', start: start + 30000, duration: 12000 };
  const mid = world.positionFor(actor, 0, [actor], manual.start + 6000, [manual]);
  assert.equal(mid.kind, 'fly');
  assert.ok(mid.top <= 50);
});
test('clover catches airborne sheep for three seconds and returns each after five', () => {
  const flyer = {
    uid: 'u_flyer',
    gear: 'wing',
    assets: { ranch_flying_wings: 1 },
    fedUntilMs: 200000,
  };
  const walker = { uid: 'u_walker', assets: {}, fedUntilMs: 200000 };
  const hungry = { uid: 'u_hungry', gear: 'wing', assets: {}, fedUntilMs: 0 };
  const actors = [flyer, walker, hungry];
  const nextFlight = 60000 - (world.seedFor(flyer.uid) % 60000) + 60000;
  const start = nextFlight - 500;
  const clover = { id: 88, kind: 'clover', start, duration: 8000, targets: [] };
  clover.targets = world.cloverTargets(clover, actors, [], start);
  assert.equal(clover.targets.length, 1);
  const caught = clover.targets[0];
  assert.equal(caught.uid, flyer.uid);
  assert.ok(caught.at >= start && caught.at < start + 3000);
  const blown = world.positionFor(flyer, 0, actors, caught.at + 800, [clover]);
  assert.equal(blown.kind, 'clover');
  assert.ok(blown.top < 30);
  const returning = world.positionFor(flyer, 0, actors, caught.at + 4999, [clover]);
  const landed = world.positionFor(flyer, 0, actors, caught.at + 5000, [clover]);
  assert.notEqual(landed.kind, 'clover');
  assert.ok(Math.abs(returning.top - landed.top) < 0.1);
  const manual = {
    id: 89,
    actor: walker.uid,
    kind: 'backflip',
    start: start + 1000,
    duration: 1500,
  };
  clover.targets = world.cloverTargets(clover, actors, [manual], manual.start);
  assert.ok(
    clover.targets.some((target) => target.uid === walker.uid && target.at === manual.start),
  );
  assert.deepEqual(clover.targets, world.cloverTargets(clover, actors, [manual], manual.start));
});
test('cycling travels four times faster and retains its path after dismounting', () => {
  const uid = 'u_owner01';
  const start = 60000 - (world.seedFor(uid) % 60000);
  const assets = { ranch_bicycle: 1 };
  const distance = (a, b) => Math.abs(a.x - b.x);
  const walk = distance(
    world.basePosition(uid, start + 20000, assets),
    world.basePosition(uid, start + 20100, assets),
  );
  const ride = distance(
    world.basePosition(uid, start + 32000, assets),
    world.basePosition(uid, start + 32100, assets),
  );
  assert.ok(Math.abs(ride / walk - 4) < 0.0001);
  const motion = { offset: 0, start: 100000, duration: 10000 };
  const before = world.basePosition(uid, 109999, {}, motion);
  const after = world.basePosition(uid, 110001, {}, motion);
  assert.ok(distance(before, after) < 0.01);
  assert.notDeepEqual(after, world.basePosition(uid, 110001));
});
test('hungry sheep stay still, never ride or flip, and resume after feeding', () => {
  const actor = {
    uid: 'u_owner01',
    fedUntilMs: 90000,
    assets: { ranch_bicycle: 1, ranch_backflip: 1 },
  };
  const a = world.positionFor(actor, 0, [actor], 100000);
  const b = world.positionFor(actor, 0, [actor], 110000);
  assert.equal(a.kind, 'hungry');
  assert.equal(a.hungry, true);
  assert.equal(a.x, b.x);
  assert.equal(a.direction, b.direction);
  assert.equal(
    world.positionFor({ ...actor, fedUntilMs: 200000 }, 0, [actor], 100000).hungry,
    false,
  );
  assert.deepEqual(world.ambientEvents([actor, { ...actor, uid: 'u_owner02' }], 100000), []);
});
test('selected-target stroll moves only the owner to the target before walking together', () => {
  const event = {
    id: 2,
    actor: sheep[0].uid,
    partner: sheep[10].uid,
    kind: 'stroll',
    start: 100000,
    duration: 18000,
    origin: { x: 10, top: 60, scale: 0.65, direction: 1 },
    meeting: { x: 75, top: 75, scale: 0.95, direction: -1 },
  };
  const start = world.positionFor(sheep[0], 0, sheep, 100000, [event]);
  const approaching = world.positionFor(sheep[0], 0, sheep, 103000, [event]);
  const target = world.positionFor(sheep[10], 10, sheep, 103000, [event]);
  assert.equal(start.x, 10);
  assert.ok(approaching.x > 10 && approaching.x < 70);
  assert.equal(target.x, 75);
  assert.equal(target.top, 75);
  const a = world.positionFor(sheep[0], 0, sheep, 109000, [event]);
  const b = world.positionFor(sheep[10], 10, sheep, 109000, [event]);
  assert.equal(a.top, b.top);
  assert.equal(a.direction, b.direction);
  assert.ok(Math.abs(Math.abs(a.x - b.x) - 5) < 0.001);
  assert.deepEqual(a, world.positionFor(sheep[0], 0, sheep, 109000, [event]));
});
