const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isMarketOpenForSymbol,
  isAnyMarketOpenForSymbols,
} = require('../out/utils/marketTime');

const noHoliday = {
  isHoliday: async () => false,
};

const hkHolidayOnly = {
  isHoliday: async (market) => market === 'hk',
};

test('keeps China and Hong Kong market states independent', async () => {
  const date = new Date('2026-07-01T02:00:00.000Z');

  assert.equal(await isMarketOpenForSymbol('sh601318', date, hkHolidayOnly), true);
  assert.equal(await isMarketOpenForSymbol('hk00700', date, hkHolidayOnly), false);
});

test('uses market timezone instead of local timezone', async () => {
  const date = new Date('2026-07-02T01:30:00.000Z');

  assert.equal(await isMarketOpenForSymbol('sh601318', date, noHoliday), true);
  assert.equal(await isMarketOpenForSymbol('hk00700', date, noHoliday), true);
});

test('reports any market open only from the supplied symbols', async () => {
  const date = new Date('2026-07-01T06:00:00.000Z');

  assert.equal(await isAnyMarketOpenForSymbols(['hk00700'], date, hkHolidayOnly), false);
  assert.equal(await isAnyMarketOpenForSymbols(['sh601318', 'hk00700'], date, hkHolidayOnly), true);
});
