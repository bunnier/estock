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

test('parses China stock valuation metrics from Tencent quote', async () => {
  const originalHttpGet = httpClient.httpGet;
  const fields = Array.from({ length: 88 }, () => '');
  fields[1] = '贵州茅台';
  fields[2] = '600519';
  fields[3] = '1209.60';
  fields[4] = '1214.88';
  fields[5] = '1203.66';
  fields[30] = '20260715093445';
  fields[31] = '-5.28';
  fields[32] = '-0.43';
  fields[33] = '1211.88';
  fields[34] = '1198.66';
  fields[37] = '153274';
  fields[39] = '18.28';
  fields[44] = '15000';
  fields[45] = '16470.58';
  fields[46] = '6.49';
  fields[64] = '4.30';

  httpClient.httpGet = async () => buildTencentLine('sh600519', fields);

  try {
    const provider = new TencentProvider();
    const quotes = await provider.fetchQuotes(['sh600519']);

    assert.ok(Math.abs(quotes[0].marketCap - 1647058000000) < 0.01, 'Market capitalization should match the source within one cent.');
    assert.equal(quotes[0].turnover, 1532740000);
    assert.equal(quotes[0].pe, 18.28);
    assert.equal(quotes[0].pb, 6.49);
    assert.equal(quotes[0].dividendYield, 4.3);
  } finally {
    httpClient.httpGet = originalHttpGet;
  }
});

test('parses Hong Kong stock valuation metrics from Tencent quote', async () => {
  const originalHttpGet = httpClient.httpGet;
  const fields = Array.from({ length: 78 }, () => '');
  fields[1] = '腾讯控股';
  fields[2] = '00700';
  fields[3] = '457.60';
  fields[4] = '456.20';
  fields[5] = '467.60';
  fields[30] = '2026/07/15 09:34:47';
  fields[31] = '1.40';
  fields[32] = '0.31';
  fields[33] = '467.60';
  fields[34] = '455.40';
  fields[44] = '36000';
  fields[45] = '37025.2497';
  fields[37] = '2494969123.500';
  fields[47] = '1.16';
  fields[57] = '15.63';
  fields[58] = '3.31';

  httpClient.httpGet = async () => buildTencentLine('r_hk00700', fields);

  try {
    const provider = new TencentProvider();
    const quotes = await provider.fetchQuotes(['hk00700']);

    assert.equal(quotes[0].marketCap, 3702524970000);
    assert.equal(quotes[0].turnover, 2494969123.5);
    assert.equal(quotes[0].pe, 15.63);
    assert.equal(quotes[0].pb, 3.31);
    assert.equal(quotes[0].dividendYield, 1.16);
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
    assert.equal(quotes[0].previousClose, 21.64);
    assert.equal(quotes[0].change, 0);
    assert.equal(quotes[0].changePercent, 0);
  } finally {
    httpClient.httpGet = originalHttpGet;
    global.Date = OriginalDate;
  }
});

test('uses Hong Kong current auction price after 9:15', async () => {
  const originalHttpGet = httpClient.httpGet;
  const OriginalDate = Date;
  const fields = Array.from({ length: 35 }, () => '');
  fields[1] = '腾讯控股';
  fields[2] = '00700';
  fields[3] = '467.60';
  fields[4] = '456.20';
  fields[5] = '467.60';
  fields[30] = '2026/07/15 09:20:46';
  fields[31] = '11.40';
  fields[32] = '2.50';
  fields[33] = '467.60';
  fields[34] = '467.60';

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

    assert.equal(quotes[0].price, 467.6);
    assert.equal(quotes[0].change, 11.4);
    assert.equal(quotes[0].changePercent, 2.5);
    assert.equal(quotes[0].open, 467.6);
    assert.equal(quotes[0].high, 467.6);
    assert.equal(quotes[0].low, 467.6);
  } finally {
    httpClient.httpGet = originalHttpGet;
    global.Date = OriginalDate;
  }
});

test('leaves market capitalization unavailable for missing or invalid values', () => {
  const provider = new TencentProvider();
  const fields = Array.from({ length: 46 }, () => '');
  fields[1] = 'Test';
  fields[3] = '10';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).marketCap, undefined);
  fields[45] = '0';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).marketCap, undefined);
  fields[45] = '-1';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).marketCap, undefined);
  fields[45] = 'N/A';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).marketCap, undefined);
});

test('preserves zero turnover and rejects unavailable Tencent turnover', () => {
  const provider = new TencentProvider();
  const fields = Array.from({ length: 46 }, () => '');
  fields[1] = 'Test';
  fields[3] = '10';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).turnover, undefined);
  fields[37] = '0';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).turnover, 0);
  fields[37] = 'N/A';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).turnover, undefined);
  fields[37] = '-1';
  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).turnover, undefined);
});

test('parses the reference net value of exchange traded funds', () => {
  const provider = new TencentProvider();
  const fields = Array.from({ length: 88 }, () => '');
  fields[1] = '港股创新药ETF广发';
  fields[2] = '513120';
  fields[3] = '1.113';
  fields[4] = '1.155';
  fields[61] = 'ETF';
  fields[78] = '1.1248';
  fields[81] = '1.1333';

  const quote = provider.parseLine('sh513120', buildTencentLine('sh513120', fields));

  assert.equal(quote.nav, 1.1248);
  assert.equal(quote.isFund, true);
  assert.equal(quote.isIndex, undefined);
});

test('falls back to the latest unit net value when the reference net value is missing', () => {
  const provider = new TencentProvider();
  const fields = Array.from({ length: 88 }, () => '');
  fields[1] = '白酒基金LOF';
  fields[3] = '0.591';
  fields[4] = '0.582';
  fields[61] = 'LOF';
  fields[78] = '';
  fields[81] = '0.5964';

  assert.equal(provider.parseLine('sz161725', buildTencentLine('sz161725', fields)).nav, 0.5964);
});

test('keeps net value empty for stocks', () => {
  const provider = new TencentProvider();
  const fields = Array.from({ length: 88 }, () => '');
  fields[1] = '贵州茅台';
  fields[3] = '1480.00';
  fields[4] = '1439.10';
  fields[61] = 'GP-A';
  fields[78] = '1.1248';
  fields[81] = '1.1333';

  assert.equal(provider.parseLine('sh600519', buildTencentLine('sh600519', fields)).nav, undefined);
});

test('marks index quotes and omits stock-only metrics', () => {
  const provider = new TencentProvider();
  const hkFields = Array.from({ length: 78 }, () => '');
  hkFields[1] = '恒生指数';
  hkFields[2] = 'HSI';
  hkFields[3] = '23525.970';
  hkFields[4] = '23393.320';
  hkFields[5] = '23469.640';
  hkFields[6] = '23640437.4447';
  hkFields[30] = '2026/11/03 18:31:07';
  hkFields[31] = '132.650';
  hkFields[32] = '0.57';
  hkFields[33] = '23549.310';
  hkFields[34] = '23347.030';
  hkFields[37] = '23640437.445';
  hkFields[45] = '0';
  hkFields[57] = '0.00';
  hkFields[58] = '0.00';
  hkFields[63] = 'ZS';

  const hkIndex = provider.parseLine('hkHSI', buildTencentLine('hkHSI', hkFields));
  assert.equal(hkIndex.name, '恒生指数');
  assert.equal(hkIndex.price, 23525.97);
  assert.equal(hkIndex.isIndex, true);
  assert.equal(hkIndex.isFund, undefined);
  assert.equal(hkIndex.volume, undefined);
  assert.equal(hkIndex.turnover, undefined);
  assert.equal(hkIndex.marketCap, undefined);
  assert.equal(hkIndex.pe, undefined);

  const chinaFields = Array.from({ length: 88 }, () => '');
  chinaFields[1] = '上证指数';
  chinaFields[3] = '3608.10';
  chinaFields[4] = '3638.03';
  chinaFields[61] = 'ZS';
  chinaFields[39] = '16.41';
  chinaFields[45] = '630601.17';
  const chinaIndex = provider.parseLine('sh000001', buildTencentLine('sh000001', chinaFields));
  assert.equal(chinaIndex.isIndex, true);
  assert.equal(chinaIndex.pe, undefined);
  assert.equal(chinaIndex.marketCap, undefined);
});
