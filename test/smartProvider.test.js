const assert = require('node:assert/strict');
const test = require('node:test');

const { SmartProvider } = require('../out/providers/smartProvider');

function withFakeDate(dateText, fn) {
  const OriginalDate = Date;
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate(dateText);
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate(dateText).getTime();
    }
  };

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      global.Date = OriginalDate;
    });
}

test('routes China stocks to Tencent during opening auction', async () => {
  await withFakeDate('2026-07-03T01:18:00.000Z', async () => {
    const provider = new SmartProvider();
    const sinaCalls = [];
    const tencentCalls = [];
    provider.sina = {
      fetchQuotes: async (symbols) => {
        sinaCalls.push(symbols);
        return symbols.map(symbol => ({
          symbol,
          name: symbol,
          price: 0,
          change: 0,
          changePercent: 0,
        }));
      },
    };
    provider.tencent = {
      fetchQuotes: async (symbols) => {
        tencentCalls.push(symbols);
        return symbols.map(symbol => ({
          symbol,
          name: symbol,
          price: symbol === 'sz002027' ? 4.9 : 430.2,
          change: 0,
          changePercent: 0,
        }));
      },
    };

    const quotes = await provider.fetchQuotes(['sz002027', 'hk00700']);

    assert.deepEqual(sinaCalls, []);
    assert.deepEqual(tencentCalls, [['sz002027', 'hk00700']]);
    assert.equal(quotes[0].symbol, 'sz002027');
    assert.equal(quotes[0].price, 4.9);
    assert.equal(quotes[1].symbol, 'hk00700');
  });
});
