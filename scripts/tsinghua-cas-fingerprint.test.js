const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const wrapperPath = path.join(root, 'public', 'tsinghua-cas-fingerprint.js');
const vendorPath = path.join(root, 'public', 'assets', 'vendor', 'fingerprint2-1.5.1.min.js');
const licensePath = path.join(root, 'public', 'assets', 'vendor', 'fingerprintjs2-LICENSE.txt');
const wrapperSource = fs.readFileSync(wrapperPath, 'utf8');
const createFingerprintApi = require('../public/tsinghua-cas-fingerprint');

const expectedOptions = {
  excludeUserAgent: true,
  excludeScreenResolution: true,
  excludeAvailableScreenResolution: true,
  excludeTimezoneOffset: true,
  excludeAddBehavior: true,
  excludeOpenDatabase: true,
  excludeDoNotTrack: true,
  excludePlugins: true,
  excludeAdBlock: true,
  excludeHasLiedLanguages: true,
  excludeHasLiedResolution: true,
  excludeHasLiedOs: true,
  excludeHasLiedBrowser: true,
  excludeJsFonts: true,
  excludeFlashFonts: true,
  excludePixelRatio: true,
  excludeColorDepth: true,
};

test('vendored FingerprintJS2 file is the unmodified 1.5.1 distribution', () => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(vendorPath)).digest('hex');
  assert.equal(digest, '973c41770723e02cb80d35336660171f74e31602a63f52fc22165190e94b0a7c');

  const license = fs.readFileSync(licensePath, 'utf8');
  assert.match(license, /Fingerprintjs2 1\.5\.1/);
  assert.match(license, /Copyright \(c\) 2015 Valentin Vasilyev/);
  assert.match(license, /Permission is hereby granted, free of charge/);
});

test('generate uses the current Tsinghua exclusions and returns a normalized Promise result', async () => {
  const receivedOptions = [];
  let constructorCount = 0;

  function FakeFingerprint2(options) {
    constructorCount += 1;
    receivedOptions.push(options);
  }

  FakeFingerprint2.prototype.get = function get(done) {
    done('ABCDEF0123456789ABCDEF0123456789');
  };

  const api = createFingerprintApi(FakeFingerprint2);
  assert.equal(constructorCount, 0, 'creating the API must not fingerprint automatically');

  const pending = api.generate();
  assert.equal(typeof pending.then, 'function');
  assert.equal(await pending, 'abcdef0123456789abcdef0123456789');
  assert.equal(constructorCount, 1);
  assert.deepEqual(receivedOptions[0], expectedOptions);
});

test('classic browser loading exposes the Promise API on globalThis', async () => {
  let receivedOptions;

  function FakeFingerprint2(options) {
    receivedOptions = options;
  }

  FakeFingerprint2.prototype.get = function get(done) {
    done('fedcba9876543210fedcba9876543210');
  };

  const browserContext = { Error, Fingerprint2: FakeFingerprint2, Object, Promise };
  vm.runInNewContext(wrapperSource, browserContext, { filename: wrapperPath });

  assert.equal(typeof browserContext.TsinghuaCasFingerprint.generate, 'function');
  assert.equal(
    await browserContext.TsinghuaCasFingerprint.generate(),
    'fedcba9876543210fedcba9876543210',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(receivedOptions)), expectedOptions);
});

test('wrapper does not cache a fingerprint or access browser storage', async () => {
  let constructorCount = 0;

  function FakeFingerprint2() {
    constructorCount += 1;
  }

  FakeFingerprint2.prototype.get = function get(done) {
    done('0123456789abcdef0123456789abcdef');
  };

  const api = createFingerprintApi(FakeFingerprint2);
  await api.generate();
  await api.generate();
  assert.equal(constructorCount, 2, 'each explicit request must create a fresh in-memory run');
  assert.doesNotMatch(wrapperSource, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});

test('generate rejects a missing library or malformed fingerprint', async () => {
  await assert.rejects(
    createFingerprintApi(undefined).generate(),
    /Fingerprint2 1\.5\.1 is unavailable/,
  );

  function InvalidFingerprint2() {}
  InvalidFingerprint2.prototype.get = function get(done) {
    done('not-a-fingerprint');
  };

  await assert.rejects(createFingerprintApi(InvalidFingerprint2).generate(), /invalid fingerprint/);
});
