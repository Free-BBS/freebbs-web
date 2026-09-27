const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const gallery = require('../public/ranch-gallery');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('community pasture layout is deterministic, layered and viewport-safe', () => {
  const first = gallery.layoutFor('u_owner01', 0, 24);
  assert.deepEqual(first, gallery.layoutFor('u_owner01', 0, 24));
  assert.ok(first.top >= 59 && first.top <= 80);
  assert.ok(first.scale >= 0.64 && first.scale <= 1.04);
  assert.ok(first.start >= 3 && first.start <= 97);
  assert.ok([-1, 1].includes(first.direction));

  const positions = Array.from({ length: 24 }, (_, index) =>
    gallery.layoutFor(`u_owner${String(index).padStart(2, '0')}`, index, 24),
  );
  assert.ok(new Set(positions.map((position) => position.top)).size >= 5);
  assert.ok(new Set(positions.map((position) => position.start)).size >= 12);
  assert.ok(positions.some((position) => position.start > 75));
  assert.ok(positions.some((position) => position.start < 25));
});

test('interaction chooses the nearest other sheep and builds an encoded ranch link', () => {
  const actor = (left, top) => ({
    element: {
      getBoundingClientRect: () => ({ left, top, width: 80, height: 60 }),
    },
  });
  const selected = actor(10, 20);
  const nearest = actor(90, 30);
  const distant = actor(400, 400);
  assert.equal(gallery.pickPartner([selected, distant, nearest], selected), nearest);
  assert.equal(gallery.pickPartner([selected], selected), null);
  assert.equal(gallery.ranchHref('u_owner/1'), '/ranch?uid=u_owner%2F1');
});

test('community pasture replaces the portrait card wall with walking and social controls', () => {
  const html = read('public/ranch-gallery.html');
  const css = read('public/ranch-creative.css');
  const source = read('public/ranch-gallery.js');
  assert.match(html, /id="community-pasture"/);
  assert.match(html, /id="community-flock"/);
  assert.match(html, /data-community-action="greet"/);
  assert.match(html, /data-community-action="stroll"/);
  assert.match(html, /ranch-environment\.js/);
  assert.doesNotMatch(html, /id="sheep-gallery"/);
  assert.match(css, /\.community-sheep-lane/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(source, /FreeBbsMaxRanch\.mount/);
  assert.match(source, /pickPartner\(actors, actor\)/);
});
