const assert = require('node:assert/strict');
const test = require('node:test');

const {
  formatPrice,
  formatMarketCap,
  formatAmount,
  formatNavValue,
  isExchangeTradedFund,
  normalizeSymbol,
  toXueqiuUrl,
} = require('../out/utils/symbolParser');

test('normalizes Shenzhen ETF and fund codes to sz prefix', () => {
  assert.equal(normalizeSymbol('159915'), 'sz159915');
  assert.equal(normalizeSymbol('161725'), 'sz161725');
  assert.equal(normalizeSymbol('180101'), 'sz180101');
});

test('normalizes Hong Kong index codes and index aliases', () => {
  assert.equal(normalizeSymbol('hkHSI'), 'hkHSI');
  assert.equal(normalizeSymbol('hkhsi'), 'hkHSI');
  assert.equal(normalizeSymbol('HKHSTECH'), 'hkHSTECH');
  assert.equal(normalizeSymbol('HSI'), 'hkHSI');
  assert.equal(normalizeSymbol('hstech'), 'hkHSTECH');
  assert.equal(normalizeSymbol('hscei'), 'hkHSCEI');
  assert.equal(normalizeSymbol('SH600519'), 'sh600519');
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

test('builds Xueqiu URLs for Hong Kong indices', () => {
  assert.equal(toXueqiuUrl('hkHSI'), 'https://xueqiu.com/S/HSI');
  assert.equal(toXueqiuUrl('hkhstech'), 'https://xueqiu.com/S/HSTECH');
});

test('formats fund net value with four decimal places', () => {
  assert.equal(formatNavValue(1.1248), '1.1248');
  assert.equal(formatNavValue(0.5964), '0.5964');
  assert.equal(formatNavValue(4), '4.0000');
});

test('formats market capitalization with currency and scaled units', () => {
  assert.equal(formatMarketCap('sh600519', 1647058000000), '1.65万亿元');
  assert.equal(formatMarketCap('hk00700', 3702524970000), '3.70万亿港元');
  assert.equal(formatMarketCap('hk00772', 26500000000), '265.00亿港元');
  assert.equal(formatMarketCap('sz002027', 100000000), '1.00亿元');
  assert.equal(formatMarketCap('sz002027', 10000), '1.00万元');
  assert.equal(formatMarketCap('sz002027', 9999), '9999.00元');
});

test('uses a placeholder for unavailable market capitalization', () => {
  assert.equal(formatMarketCap('sh600519', undefined), '--');
  assert.equal(formatMarketCap('sh600519', 0), '--');
  assert.equal(formatMarketCap('sh600519', -1), '--');
  assert.equal(formatMarketCap('sh600519', NaN), '--');
  assert.equal(formatMarketCap('sh600519', Infinity), '--');
});

test('formats turnover with currency and preserves zero amounts', () => {
  assert.equal(formatAmount('sh600519', 1532738292), '15.33亿元');
  assert.equal(formatAmount('hk00700', 2494969123.5), '24.95亿港元');
  assert.equal(formatAmount('sh600519', 0), '0.00元');
  assert.equal(formatAmount('hk00700', 0), '0.00港元');
  assert.equal(formatAmount('hk00700', undefined), '--');
  assert.equal(formatAmount('sh600519', NaN), '--');
  assert.equal(formatAmount('sh600519', -1), '--');
});
