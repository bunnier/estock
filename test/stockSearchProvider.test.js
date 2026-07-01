const assert = require('node:assert/strict');
const test = require('node:test');

const { parseSinaSuggestResponse } = require('../out/providers/stockSearchProvider');

test('parses supported A-share and Hong Kong stock suggestions', () => {
  const text = 'var suggestdata="中国平安,11,601318,sh601318,中国平安,,中国平安,99,1,ESG,,;腾讯控股,31,00700,00700,腾讯控股,,腾讯控股,99,1,ESG,,";';

  assert.deepEqual(parseSinaSuggestResponse(text), [
    {
      symbol: 'sh601318',
      code: '601318',
      name: '中国平安',
      market: 'A',
    },
    {
      symbol: 'hk00700',
      code: '00700',
      name: '腾讯控股',
      market: 'H',
    },
  ]);
});

test('filters unsupported suggestion categories', () => {
  const text = 'var suggestdata="腾讯,41,tctzf,tctzf,腾讯,,腾讯,99,1,,,;腾讯瑞银五七沽A,32,22355,22355,腾讯瑞银五七沽A,,腾讯瑞银五七沽A,99,1,,,;平安银行,11,000001,sz000001,平安银行,,平安银行,99,1,ESG,,";';

  assert.deepEqual(parseSinaSuggestResponse(text), [
    {
      symbol: 'sz000001',
      code: '000001',
      name: '平安银行',
      market: 'A',
    },
  ]);
});
