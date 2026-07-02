const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
let httpGetMock;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './httpClient' || request.endsWith('/httpClient')) {
    return {
      httpGet: (...args) => httpGetMock(...args),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { SinaProvider } = require('../out/providers/sinaProvider');

test('A-share auction quote uses bid price when current price is zero', async () => {
  httpGetMock = async () => 'var hq_str_sh601318="中国平安,0.000,49.530,0.000,0.000,0.000,49.200,49.200,0,0.000,187700,49.200,19900,0.000,0,0.000,0,0.000,0,0.000,187700,49.200,0,0.000,0,0.000,0,0.000,0,0.000,2026-07-02,09:22:08,00,";\n';

  const provider = new SinaProvider();
  const quotes = await provider.fetchQuotes(['sh601318']);

  assert.equal(quotes.length, 1);
  assert.equal(quotes[0].price, 49.2);
  assert.equal(quotes[0].change, -0.33);
  assert.equal(quotes[0].changePercent, -0.67);
});
