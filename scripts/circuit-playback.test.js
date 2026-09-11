const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const engine = require('../public/circuit-engine');

function sample(stop = 0.1, step = 0.000001) {
  return engine.validateDocument({
    version: 1,
    components: [
      {
        id: 'V1',
        type: 'voltage',
        params: { waveform: 'sine', frequency: 10000, amplitude: 12, dc: 0 },
      },
      { id: 'R1', type: 'resistor', params: { resistance: 1000 } },
      { id: 'G1', type: 'ground' },
    ],
    wires: [
      { id: 'w1', from: { componentId: 'V1', pin: 0 }, to: { componentId: 'R1', pin: 0 } },
      { id: 'w2', from: { componentId: 'V1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
      { id: 'w3', from: { componentId: 'R1', pin: 1 }, to: { componentId: 'G1', pin: 0 } },
    ],
    analysis: { type: 'transient', stop, step, initial: 'zero' },
  });
}

const highResolutionDocument = sample();
const highResolutionResult = engine.simulate(highResolutionDocument);

function source(filename) {
  return fs
    .readFileSync(path.join(__dirname, '../public', filename), 'utf8')
    .replace(/\r\n/g, '\n');
}

test('editor playback shows both sine half-cycles with 100001 points instead of locking to one phase', () => {
  const editor = source('circuit.js');
  const listener = editor.slice(
    editor.indexOf("    $('play').addEventListener('click', () => {"),
    editor.indexOf("    page\n      .querySelectorAll('[data-circuit-reference]')"),
  );
  assert.ok(listener.length > 0);
  const play = {
    addEventListener(type, callback) {
      assert.equal(type, 'click');
      this.click = callback;
    },
  };
  const state = {
    document: highResolutionDocument,
    result: highResolutionResult,
    playing: false,
    frame: 0,
  };
  let tick;
  const visited = [];
  vm.runInNewContext(listener, {
    $: () => play,
    engine,
    state,
    stopPlayback: () => {
      state.playing = false;
    },
    renderSchematic() {},
    setFrame(index) {
      state.frame = index;
      visited.push(index);
    },
    window: {
      setInterval(callback, interval) {
        assert.equal(interval, 50);
        tick = callback;
        return 1;
      },
    },
  });
  play.click();
  assert.match(play.textContent, /慢放/);
  for (let index = 0; index < 40; index += 1) tick();
  const trace = highResolutionResult.traces.find((item) => item.id === 'V:V1');
  assert.ok(visited.every((index, at) => index - (visited[at - 1] || 0) <= 5));
  assert.ok(visited.some((index) => trace.values[index] > 11.9));
  assert.ok(visited.some((index) => trace.values[index] < -11.9));
  play.click();
  assert.equal(state.playing, false);
});

function embedPlayback(document, result) {
  const embed = source('circuit-embed.js');
  const functions = embed.slice(
    embed.indexOf('  function tick(timestamp) {'),
    embed.indexOf('  function redrawWaveform() {'),
  );
  const state = { circuit: { document }, result, frame: 0, playing: false };
  const play = { setAttribute() {} };
  const visited = [];
  const context = vm.createContext({
    engine,
    state,
    play,
    document: { hidden: false },
    timeline: { hidden: false },
    root: { classList: { remove() {} } },
    window: { requestAnimationFrame: () => 1 },
    drawFrame(index) {
      state.frame = index;
      visited.push(index);
    },
  });
  vm.runInContext(functions, context);
  return { state, play, visited, tick: context.tick, start: context.startPlayback };
}

test('live embeds limit each visible jump even after dropped frames, preserving high-frequency playback', () => {
  const embed = embedPlayback(highResolutionDocument, highResolutionResult);
  embed.start();
  assert.match(embed.play.textContent, /慢放/);
  embed.tick(1000);
  assert.equal(embed.state.frame, 0, 'the initial animation frame does not advance time');
  for (let index = 1; index <= 40; index += 1) embed.tick(1000 + index * 250);
  const trace = highResolutionResult.traces.find((item) => item.id === 'V:V1');
  assert.ok(embed.visited.every((index, at) => index - (embed.visited[at - 1] || 0) <= 5));
  assert.ok(embed.visited.some((index) => trace.values[index] > 11.9));
  assert.ok(embed.visited.some((index) => trace.values[index] < -11.9));
});

test('low-point embeds retain fractional playback timing and resume from the chosen sample', () => {
  const document = sample(0.0001, 0.000001);
  const result = engine.simulate(document);
  const embed = embedPlayback(document, result);
  embed.state.frame = 20;
  embed.start();
  assert.equal(embed.play.textContent, '暂停');
  embed.tick(1000);
  assert.equal(embed.state.frame, 20);
  embed.tick(1050);
  assert.equal(embed.state.frame, 20, 'fractional frame increments are accumulated');
  embed.tick(1100);
  assert.equal(embed.state.frame, 21);
  embed.state.playing = false;
  embed.tick(1200);
  assert.equal(embed.state.frame, 21, 'paused animation callbacks cannot advance the sample');
});
