const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const originalLoad = Module._load;
const sinaCalls = [];
const tencentCalls = [];
let auctionOpen = false;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './sinaProvider' || request.endsWith('/sinaProvider')) {
    return {
      SinaProvider: class {
        async fetchQuotes(symbols) {
          sinaCalls.push([...symbols]);
          return symbols.map(symbol => ({
            symbol,
            name: `sina-${symbol}`,
            price: 1,
            change: 0,
            changePercent: 0,
          }));
        }
      },
    };
  }
  if (request === './tencentProvider' || request.endsWith('/tencentProvider')) {
    return {
      TencentProvider: class {
        async fetchQuotes(symbols) {
          tencentCalls.push([...symbols]);
          return symbols.map(symbol => ({
            symbol,
            name: `tencent-${symbol}`,
            price: 2,
            change: 0,
            changePercent: 0,
          }));
        }
      },
    };
  }
  if (request === '../utils/marketTime' || request.endsWith('/utils/marketTime')) {
    return {
      isAStockOpeningAuction: () => auctionOpen,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { SmartProvider } = require('../out/providers/smartProvider');

function resetCalls() {
  sinaCalls.length = 0;
  tencentCalls.length = 0;
}

test('smart provider uses Tencent for A shares during opening auction', async () => {
  resetCalls();
  auctionOpen = true;

  const provider = new SmartProvider();
  const quotes = await provider.fetchQuotes(['sh601318', 'hk00700']);

  assert.deepEqual(sinaCalls, []);
  assert.deepEqual(tencentCalls, [['sh601318', 'hk00700']]);
  assert.equal(quotes[0].name, 'tencent-sh601318');
  assert.equal(quotes[1].name, 'tencent-hk00700');
  assert.equal(quotes[0].delayed, undefined);
  assert.equal(quotes[1].delayed, true);
});

test('smart provider keeps using Sina for A shares outside opening auction', async () => {
  resetCalls();
  auctionOpen = false;

  const provider = new SmartProvider();
  const quotes = await provider.fetchQuotes(['sh601318', 'hk00700']);

  assert.deepEqual(sinaCalls, [['sh601318']]);
  assert.deepEqual(tencentCalls, [['hk00700']]);
  assert.equal(quotes[0].name, 'sina-sh601318');
  assert.equal(quotes[1].name, 'tencent-hk00700');
});
