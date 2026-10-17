const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { runInContext } = require('node:vm');

const repo = resolve(__dirname, '..');
const requireDevelopment = createRequire(join(repo, 'development/package.json'));
const { JSDOM } = requireDevelopment('jsdom');
const acorn = requireDevelopment('acorn');
const site = join(repo, 'development/apps/web/public/organization-showcase/sites/audiovisual');

// Run the submitted player's actual callback, while leaving unrelated workspace
// modules idle. This exercises the generated public bundle and real controls.
function playerCallbackSource() {
  const source = readFileSync(join(site, 'app.js'), 'utf8');
  const ast = acorn.parse(source, { ecmaVersion: 'latest' });
  const registration = ast.body.find((statement) => {
    const call = statement.expression;
    return (
      call?.type === 'CallExpression' &&
      call.callee.type === 'MemberExpression' &&
      call.callee.object.name === 'MM' &&
      call.callee.property.name === 'register' &&
      call.arguments[0]?.value === 'player'
    );
  });
  assert.ok(registration, 'The generated bundle must register its original player');
  const callback = registration.expression.arguments[1];
  return source.slice(callback.start, callback.end);
}

const callbackSource = playerCallbackSource();

async function settle() {
  // Media promises and volumechange events finish on separate turns in browsers.
  await new Promise((done) => {
    setTimeout(done, 0);
  });
  await new Promise((done) => {
    setTimeout(done, 0);
  });
}

function createPlayer(t, { rejectAudioAttempts = 0 } = {}) {
  const dom = new JSDOM(readFileSync(join(site, 'index.html'), 'utf8'), {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://showcase.invalid/audiovisual/index.html',
  });
  const { window } = dom;
  const root = window.document.querySelector('.mm-app');
  const audio = root.querySelector('[data-player-audio]');
  const video = root.querySelector('[data-opening-video]');
  const volumes = [...root.querySelectorAll('[data-player-volume]')];
  const mute = root.querySelector('[data-player-mute]');
  const buttonCount = root.querySelectorAll('button').length;
  const cleanup = [];
  const subscribers = [];
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', { get: () => hidden });

  function simulateMedia(media, rejectedAttempts = 0) {
    let paused = true;
    const attempts = [];
    Object.defineProperty(media, 'paused', { get: () => paused });
    media.play = () => {
      attempts.push({ muted: media.muted, volume: media.volume });
      if (attempts.length <= rejectedAttempts) {
        return Promise.reject(new window.DOMException('Gesture required', 'NotAllowedError'));
      }
      const wasPaused = paused;
      paused = false;
      if (wasPaused) {
        window.queueMicrotask(() => {
          media.dispatchEvent(new window.Event('play'));
          media.dispatchEvent(new window.Event('playing'));
        });
      }
      return Promise.resolve();
    };
    media.pause = () => {
      const wasPlaying = !paused;
      paused = true;
      if (wasPlaying) {
        window.queueMicrotask(() => media.dispatchEvent(new window.Event('pause')));
      }
    };
    return attempts;
  }

  const audioAttempts = simulateMedia(audio, rejectAudioAttempts);
  const videoAttempts = simulateMedia(video);
  const ctx = {
    root,
    state: { screen: 0, motion: true },
    find: (selector) => root.querySelector(selector),
    all: (selector) => [...root.querySelectorAll(selector)],
    listen(target, type, listener) {
      target.addEventListener(type, listener);
      cleanup.push(() => target.removeEventListener(type, listener));
    },
    cleanup(callback) {
      cleanup.push(callback);
    },
    subscribe(callback) {
      subscribers.push(callback);
    },
    animate() {},
    setMotion(motion) {
      ctx.state.motion = motion;
      subscribers.forEach((subscriber) => subscriber({ changes: ['motion'] }));
    },
  };
  runInContext(`(${callbackSource})`, dom.getInternalVMContext())(ctx);
  t.after(async () => {
    cleanup.reverse().forEach((callback) => callback());
    await settle();
    dom.window.close();
  });

  return {
    audio,
    video,
    volumes,
    mute,
    root,
    ctx,
    buttonCount,
    audioAttempts,
    videoAttempts,
    input(index, value) {
      volumes[index].value = String(value);
      volumes[index].dispatchEvent(new window.Event('input', { bubbles: true }));
    },
    screen(index) {
      ctx.state.screen = index;
      subscribers.forEach((subscriber) => subscriber({ changes: ['screen'] }));
    },
    visibility(value) {
      hidden = value;
      window.document.dispatchEvent(new window.Event('visibilitychange'));
    },
  };
}

function assertVolumes(player, expected) {
  player.volumes.forEach((volume) => {
    assert.equal(Number(volume.value), expected);
    assert.equal(volume.disabled, false);
  });
}

test('the opening runs silently and music starts muted with only original controls', async (t) => {
  const player = createPlayer(t);
  await settle();
  assert.equal(player.audio.defaultMuted, true);
  assert.equal(player.audio.muted, true);
  assert.equal(player.audio.paused, false);
  assert.ok(player.audioAttempts.length > 0);
  assert.ok(player.audioAttempts.every((attempt) => attempt.muted));
  assert.equal(player.video.muted, true);
  assert.equal(player.video.paused, false);
  assert.equal(player.video.hidden, false);
  assert.ok(player.videoAttempts.length > 0);
  assert.equal(player.root.querySelectorAll('button').length, player.buttonCount);
  assertVolumes(player, 0);
  assert.equal(player.mute.getAttribute('aria-pressed'), 'true');
  assert.equal(player.mute.getAttribute('aria-label'), '取消静音');
});

test('either existing volume slider can enable sound and both remain synchronized', async (t) => {
  const player = createPlayer(t);
  await settle();
  player.input(0, 0.4);
  await settle();
  assert.equal(player.audio.muted, false);
  assert.equal(player.audio.volume, 0.4);
  assertVolumes(player, 0.4);
  assert.equal(player.mute.getAttribute('aria-pressed'), 'false');

  player.input(1, 0.2);
  await settle();
  assert.equal(player.audio.volume, 0.2);
  assertVolumes(player, 0.2);

  player.input(1, 0);
  await settle();
  assert.equal(player.audio.muted, true);
  assertVolumes(player, 0);
  assert.equal(player.ctx.state.motion, true);
  assert.equal(player.video.muted, true);
});

test('the original mute control restores the last audible volume, including after zero', async (t) => {
  const player = createPlayer(t);
  await settle();
  player.mute.click();
  await settle();
  assert.equal(player.audio.muted, false);
  assert.equal(player.audio.volume, 0.7);
  assertVolumes(player, 0.7);

  player.input(0, 0.35);
  await settle();
  player.mute.click();
  await settle();
  assert.equal(player.audio.muted, true);
  assertVolumes(player, 0);
  player.mute.click();
  await settle();
  assert.equal(player.audio.muted, false);
  assertVolumes(player, 0.35);

  player.input(1, 0);
  await settle();
  player.mute.click();
  await settle();
  assert.equal(player.audio.muted, false);
  assert.equal(player.audio.volume, 0.35);
  assertVolumes(player, 0.35);
});

test('an original volume slider retries when muted autoplay was denied', async (t) => {
  const player = createPlayer(t, { rejectAudioAttempts: 1 });
  await settle();
  assert.equal(player.audio.paused, true);
  assert.equal(player.audioAttempts.length, 1);
  assert.equal(player.video.paused, false);

  player.input(0, 0.3);
  await settle();
  assert.equal(player.audioAttempts.length, 2);
  assert.equal(player.audio.paused, false);
  assert.equal(player.audio.muted, false);
  assertVolumes(player, 0.3);
});

test('the original mute button also retries denied playback without an extra music button', async (t) => {
  const player = createPlayer(t, { rejectAudioAttempts: 1 });
  await settle();
  assert.equal(player.audio.paused, true);
  player.mute.click();
  await settle();
  assert.equal(player.audioAttempts.length, 2);
  assert.equal(player.audio.paused, false);
  assert.equal(player.audio.muted, false);
  assertVolumes(player, 0.7);
});

test('screen, background and pause lifecycle preserve independent silent video and music', async (t) => {
  const player = createPlayer(t);
  await settle();
  player.screen(1);
  await settle();
  assert.equal(player.video.paused, true);
  assert.equal(player.audio.paused, false);
  player.visibility(true);
  await settle();
  assert.equal(player.audio.paused, true);
  player.visibility(false);
  await settle();
  assert.equal(player.audio.paused, false);
  assert.equal(player.audio.muted, true);
  assert.equal(player.video.paused, true);
  player.screen(0);
  await settle();
  assert.equal(player.video.paused, false);
  player.ctx.player.pause();
  await settle();
  assert.equal(player.audio.paused, true);
  assert.equal(player.video.paused, true);
});
