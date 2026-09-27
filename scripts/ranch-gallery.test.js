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
  assert.match(source, /new EventSource/);
  assert.match(source, /ranch-world\/actions/);
  assert.match(source, /syncFrame/);
  assert.doesNotMatch(source, /Math\.random|pickPartner|walkTo/);
  assert.match(source, /stream\?\.close/);
  assert.match(source, /lastSnapshot \+ 5000/);
});
