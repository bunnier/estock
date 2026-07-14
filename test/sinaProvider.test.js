const assert = require('node:assert/strict');
const test = require('node:test');

const httpClient = require('../out/providers/httpClient');
const { SinaProvider } = require('../out/providers/sinaProvider');

function buildSinaLine(symbol, fields) {
  return `var hq_str_${symbol}="${fields.join(',')}";`;
}

test('keeps China stock at previous close when auction current price is zero', async () => {
  const originalHttpGet = httpClient.httpGet;
  const OriginalDate = Date;
  const fields = Array.from({ length: 32 }, () => '');
  fields[0] = '分众传媒';
  fields[1] = '0.000';
  fields[2] = '4.910';
  fields[3] = '0.000';
  fields[4] = '0.000';
  fields[5] = '0.000';
  fields[8] = '0';
  fields[30] = '2026-07-03';
  fields[31] = '09:18:09';

  httpClient.httpGet = async () => buildSinaLine('sz002027', fields);
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate('2026-07-03T01:18:00.000Z');
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate('2026-07-03T01:18:00.000Z').getTime();
    }
  };

  try {
    const provider = new SinaProvider();
    const quotes = await provider.fetchQuotes(['sz002027']);

    assert.equal(quotes[0].price, 4.91);
    assert.equal(quotes[0].previousClose, 4.91);
    assert.equal(quotes[0].change, 0);
    assert.equal(quotes[0].changePercent, 0);
  } finally {
    httpClient.httpGet = originalHttpGet;
    global.Date = OriginalDate;
  }
});
