const assert = require('node:assert/strict');
const test = require('node:test');
const { isValidNodeId, normalizeNodeId } = require('./course-maps');

test('normalizes knowledge node ids to uppercase ASCII', () => {
  assert.equal(normalizeNodeId(' ss-01-01 '), 'SS-01-01');
});

test('accepts structured ASCII knowledge node ids', () => {
  assert.equal(isValidNodeId('SS-01-01'), true);
  assert.equal(isValidNodeId('CIRCUIT-A1-02'), true);
});

test('rejects unsafe or unstructured knowledge node ids', () => {
  assert.equal(isValidNodeId('signal-basics'), false);
  assert.equal(isValidNodeId('SS 01 01'), false);
  assert.equal(isValidNodeId('信号-01-01'), false);
  assert.equal(isValidNodeId('../SS-01'), false);
});
