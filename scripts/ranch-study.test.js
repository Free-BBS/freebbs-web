const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createTimer, countdown } = require('../public/ranch-study');

test('focus countdown uses an absolute deadline, including background and sleep time', () => {
  const timer = createTimer(25);
  assert.equal(timer.snapshot(0).remaining, 1500000);
  timer.start(1000);
  assert.equal(timer.snapshot(11000).remaining, 1490000);
  timer.start(21000);
  assert.equal(timer.snapshot(31000).remaining, 1470000, 'duplicate start does not reset deadline');
  assert.deepEqual(timer.snapshot(2000000), {
    duration: 1500000,
    remaining: 0,
    running: false,
    complete: true,
  });
  timer.start(2000000);
  assert.equal(timer.snapshot(2001000).remaining, 1499000);
});

test('pause, resume, reset and valid duration selection preserve exact remaining time', () => {
  const timer = createTimer(15);
  timer.start(0);
  timer.pause(12345);
  assert.equal(timer.snapshot(100000).remaining, 887655);
  timer.start(200000);
  assert.equal(timer.snapshot(210000).remaining, 877655);
  timer.reset(45);
  assert.deepEqual(timer.snapshot(), {
    duration: 2700000,
    remaining: 2700000,
    running: false,
    complete: false,
  });
  timer.reset('not-a-duration');
  assert.equal(timer.snapshot().duration, 2700000);
  timer.reset(60);
  assert.equal(timer.snapshot().duration, 3600000);
  timer.start(0);
  timer.pause(4000000);
  assert.equal(timer.snapshot().complete, true);
  timer.reset();
  assert.equal(timer.snapshot().complete, false);
});

test('countdown rounds up without going negative or showing 00:00 prematurely', () => {
  for (const [ms, expected] of [
    [1500000, '25:00'],
    [60001, '01:01'],
    [59999, '01:00'],
    [1, '00:01'],
    [0, '00:00'],
    [-100, '00:00'],
  ])
    assert.equal(countdown(ms), expected);
});

test('study mode is ranch-only, desktop-gated, accessible and handles native fullscreen and Escape', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const source = read('public/ranch-study.js');
  const css = read('public/ranch-study.css');
  assert.match(source, /matchMedia\('\(min-width: 901px\)'\)/);
  assert.match(source, /root.requestFullscreen \|\| root.webkitRequestFullscreen/);
  assert.match(source, /document.exitFullscreen \|\| document.webkitExitFullscreen/);
  assert.match(source, /fullscreenchange/);
  assert.match(source, /event.key === 'Escape'/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /role="timer" aria-live="off"/);
  assert.match(source, /role="status"/);
  assert.match(css, /\.is-study-mode[\s\S]*?\.ranch-scene-actions/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(read('public/ranch.html'), /ranch-study.js/);
  assert.doesNotMatch(read('public/profile.html'), /ranch-study.js/);
});
