const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeSymbol } = require('../out/utils/symbolParser');

test('normalizes Shenzhen ETF and fund codes to sz prefix', () => {
  assert.equal(normalizeSymbol('159915'), 'sz159915');
  assert.equal(normalizeSymbol('161725'), 'sz161725');
  assert.equal(normalizeSymbol('180101'), 'sz180101');
});

test('keeps Shanghai ETF and existing stock routing intact', () => {
  assert.equal(normalizeSymbol('510300'), 'sh510300');
  assert.equal(normalizeSymbol('601318'), 'sh601318');
  assert.equal(normalizeSymbol('000001'), 'sz000001');
  assert.equal(normalizeSymbol('00700'), 'hk00700');
});
