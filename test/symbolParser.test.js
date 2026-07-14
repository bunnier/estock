const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeSymbol, toXueqiuUrl } = require('../out/utils/symbolParser');

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

test('builds Xueqiu URLs for Shanghai and Shenzhen stocks', () => {
  assert.equal(toXueqiuUrl('sh600900'), 'https://xueqiu.com/S/SH600900');
  assert.equal(toXueqiuUrl('sz000001'), 'https://xueqiu.com/S/SZ000001');
});

test('builds Xueqiu URLs for Hong Kong stocks without a market prefix', () => {
  assert.equal(toXueqiuUrl('hk00772'), 'https://xueqiu.com/S/00772');
});
