const assert = require('node:assert/strict');
const test = require('node:test');

const httpClient = require('../out/providers/httpClient');
const { TencentProvider } = require('../out/providers/tencentProvider');

function buildTencentLine(symbol, fields) {
  return `v_${symbol}="${fields.join('~')}";`;
}

test('queries realtime Tencent symbol for Hong Kong stocks', async () => {
  const originalHttpGet = httpClient.httpGet;
  let requestedUrl = '';
  const fields = Array.from({ length: 35 }, () => '');
  fields[1] = '腾讯控股';
  fields[2] = '00700';
  fields[3] = '438.60';
  fields[4] = '430.20';
  fields[5] = '433.00';
  fields[30] = '2026/07/03 09:34:19';
  fields[31] = '8.40';
  fields[32] = '1.95';

  httpClient.httpGet = async (url) => {
    requestedUrl = url;
    return buildTencentLine('r_hk00700', fields);
  };

  try {
    const provider = new TencentProvider();
    const quotes = await provider.fetchQuotes(['hk00700']);

    assert.equal(requestedUrl, 'https://qt.gtimg.cn/q=r_hk00700');
    assert.equal(quotes[0].price, 438.6);
    assert.equal(quotes[0].changePercent, 1.95);
  } finally {
    httpClient.httpGet = originalHttpGet;
  }
});

test('computes Hong Kong stock change percent after pre-open hold', async () => {
  const originalHttpGet = httpClient.httpGet;
  const OriginalDate = Date;
  const fields = Array.from({ length: 35 }, () => '');
  fields[1] = '腾讯控股';
  fields[2] = '00700';
  fields[3] = '450.00';
  fields[4] = '430.20';
  fields[5] = '450.00';
  fields[30] = '20260703090000';
  fields[31] = '0.40';
  fields[32] = '0.09';
  fields[33] = '450.00';
  fields[34] = '450.00';

  httpClient.httpGet = async () => buildTencentLine('hk00700', fields);
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate('2026-07-03T01:35:00.000Z');
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate('2026-07-03T01:35:00.000Z').getTime();
    }
  };

  try {
    const provider = new TencentProvider();
    const quotes = await provider.fetchQuotes(['hk00700']);

    assert.equal(quotes[0].change, 19.8);
    assert.equal(quotes[0].changePercent, 4.6);
  } finally {
    httpClient.httpGet = originalHttpGet;
    global.Date = OriginalDate;
  }
});

test('keeps Hong Kong stock at previous close before 9:15', async () => {
  const originalHttpGet = httpClient.httpGet;
  const OriginalDate = Date;
  const fields = Array.from({ length: 35 }, () => '');
  fields[1] = '腾讯控股';
  fields[2] = '00700';
  fields[3] = '430.20';
  fields[4] = '429.80';
  fields[5] = '442.60';
  fields[30] = '2026/07/02 16:08:25';
  fields[31] = '0.40';
  fields[32] = '0.09';
  fields[33] = '447.00';
  fields[34] = '429.40';

  httpClient.httpGet = async () => buildTencentLine('hk00700', fields);
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate('2026-07-03T01:08:00.000Z');
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate('2026-07-03T01:08:00.000Z').getTime();
    }
  };

  try {
    const provider = new TencentProvider();
    const quotes = await provider.fetchQuotes(['hk00700']);

    assert.equal(quotes[0].price, 430.2);
    assert.equal(quotes[0].change, 0);
    assert.equal(quotes[0].changePercent, 0);
  } finally {
    httpClient.httpGet = originalHttpGet;
    global.Date = OriginalDate;
  }
});

test('keeps stale Tencent current price as previous close for Hong Kong auction quotes', async () => {
  const originalHttpGet = httpClient.httpGet;
  const OriginalDate = Date;
  const fields = Array.from({ length: 35 }, () => '');
  fields[1] = '小米集团-W';
  fields[2] = '01810';
  fields[3] = '22.60';
  fields[4] = '21.64';
  fields[5] = '22.40';
  fields[30] = '2026/07/02 16:08:22';
  fields[31] = '0.96';
  fields[32] = '4.44';
  fields[33] = '22.88';
  fields[34] = '22.02';

  httpClient.httpGet = async () => buildTencentLine('hk01810', fields);
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate('2026-07-03T01:12:00.000Z');
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate('2026-07-03T01:12:00.000Z').getTime();
    }
  };

  try {
    const provider = new TencentProvider();
    const quotes = await provider.fetchQuotes(['hk01810']);

    assert.equal(quotes[0].price, 22.6);
    assert.equal(quotes[0].change, 0);
    assert.equal(quotes[0].changePercent, 0);
  } finally {
    httpClient.httpGet = originalHttpGet;
    global.Date = OriginalDate;
  }
});

test('keeps Hong Kong stock at previous close before continuous trading starts', async () => {
  const originalHttpGet = httpClient.httpGet;
  const OriginalDate = Date;
  const fields = Array.from({ length: 35 }, () => '');
  fields[1] = '腾讯控股';
  fields[2] = '00700';
  fields[3] = '435.00';
  fields[4] = '430.20';
  fields[5] = '0.00';
  fields[30] = '2026/07/03 09:15:01';
  fields[31] = '4.80';
  fields[32] = '1.12';

  httpClient.httpGet = async () => buildTencentLine('hk00700', fields);
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate('2026-07-03T01:29:00.000Z');
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate('2026-07-03T01:29:00.000Z').getTime();
    }
  };

  try {
    const provider = new TencentProvider();
    const quotes = await provider.fetchQuotes(['hk00700']);

    assert.equal(quotes[0].price, 430.2);
    assert.equal(quotes[0].change, 0);
    assert.equal(quotes[0].changePercent, 0);
  } finally {
    httpClient.httpGet = originalHttpGet;
    global.Date = OriginalDate;
  }
});
