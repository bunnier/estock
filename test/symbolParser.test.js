const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatPrice,
  isExchangeTradedFund,
  normalizeSymbol,
  toXueqiuUrl,
} = require('../out/utils/symbolParser');

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

test('formats mainland exchange-traded fund prices with three decimal places', () => {
  assert.equal(isExchangeTradedFund('sh513120'), true);
  assert.equal(isExchangeTradedFund('513120'), true);
  assert.equal(isExchangeTradedFund('sz159915'), true);
  assert.equal(isExchangeTradedFund('sz161725'), true);
  assert.equal(isExchangeTradedFund('sz180101'), true);
  assert.equal(formatPrice('sh513120', 1.234), '1.234');
  assert.equal(formatPrice('sz159915', 1.23), '1.230');
});

test('keeps stock and Hong Kong prices at two decimal places', () => {
  assert.equal(isExchangeTradedFund('sh600519'), false);
  assert.equal(isExchangeTradedFund('sz000001'), false);
  assert.equal(isExchangeTradedFund('hk00700'), false);
  assert.equal(formatPrice('sh600519', 1500), '1500.00');
  assert.equal(formatPrice('hk00700', 421), '421.00');
});

test('builds Xueqiu URLs for Shanghai and Shenzhen stocks', () => {
  assert.equal(toXueqiuUrl('sh600900'), 'https://xueqiu.com/S/SH600900');
  assert.equal(toXueqiuUrl('sz000001'), 'https://xueqiu.com/S/SZ000001');
});

test('builds Xueqiu URLs for Hong Kong stocks without a market prefix', () => {
  assert.equal(toXueqiuUrl('hk00772'), 'https://xueqiu.com/S/00772');
});
