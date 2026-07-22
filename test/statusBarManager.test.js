const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const vscode = require('./vscode');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { StatusBarManager } = require('../out/statusBarManager');

function createConfig(initial) {
  return {
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(initial, key) ? initial[key] : fallback;
    },
  };
}

test('closed market display uses the configured closed color even when a quote is cached', () => {
  const config = createConfig({
    displayFormat: '${name} ${changePercent} (${price})',
    statusBarAlignment: 'center',
    colorUp: '#ff0000',
    colorDown: '#00ff00',
    colorFlat: '#cccccc',
    colorClosed: '#777777',
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateStatusBarItem = vscode.window.createStatusBarItem;
  const items = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createStatusBarItem = () => {
    const item = {
      show() {},
      dispose() {},
    };
    items.push(item);
    return item;
  };

  try {
    const manager = new StatusBarManager();
    manager.reload(['sh601318']);
    manager.updateQuotes([{
      symbol: 'sh601318',
      name: '中国平安',
      price: 50,
      change: 1,
      changePercent: 2,
    }]);

    manager.showMarketClosed(['sh601318']);

    assert.equal(items[0].text, '中国平安(A) +2.00% (50.00) 休市');
    assert.equal(items[0].color, '#777777');
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});

test('display format supports currency placeholder for China and Hong Kong stocks', () => {
  const config = createConfig({
    displayFormat: '${name} ${changePercent} (${currency}${price})',
    statusBarAlignment: 'center',
    colorUp: '#ff0000',
    colorDown: '#00ff00',
    colorFlat: '#cccccc',
    colorClosed: '#777777',
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateStatusBarItem = vscode.window.createStatusBarItem;
  const items = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createStatusBarItem = () => {
    const item = {
      show() {},
      dispose() {},
    };
    items.push(item);
    return item;
  };

  try {
    const manager = new StatusBarManager();
    manager.reload(['sh601318', 'hk00700']);
    manager.updateQuotes([
      {
        symbol: 'sh601318',
        name: '中国平安',
        price: 50,
        change: 1,
        changePercent: 2,
        previousClose: 49,
        open: 49.5,
        high: 51,
        low: 48,
        pe: 8.88,
        pb: 1.23,
        dividendYield: 4.56,
        volume: 12345,
        time: '2026-07-14 15:00:00',
      },
      {
        symbol: 'hk00700',
        name: '腾讯控股',
        price: 421,
        change: -2,
        changePercent: -0.47,
      },
    ]);

    assert.equal(items[0].text, '中国平安(A) +2.00% (¥50.00)');
    assert.equal(items[1].text, '腾讯控股(H) -0.47% ($421.00)');
    assert.match(items[0].tooltip.value, /\[雪球详情\]\(https:\/\/xueqiu\.com\/S\/SH601318\)/);
    assert.match(items[1].tooltip.value, /\[雪球详情\]\(https:\/\/xueqiu\.com\/S\/00700\)/);
    assert.match(items[0].tooltip.value, /今开：49\.50/);
    assert.match(items[0].tooltip.value, /最高：51\.00/);
    assert.match(items[0].tooltip.value, /最低：48\.00/);
    assert.match(items[0].tooltip.value, /振幅：6\.12%/);
    assert.match(items[0].tooltip.value, /PE：8\.88/);
    assert.match(items[0].tooltip.value, /PB：1\.23/);
    assert.match(items[0].tooltip.value, /股息率：4\.56%/);
    assert.match(items[0].tooltip.value, /成交量：12,345/);
    assert.match(items[0].tooltip.value, /更新时间：2026-07-14 15:00:00/);
    assert.match(items[0].tooltip.value, /  \n当前价/);
    assert.doesNotMatch(items[0].tooltip.value, /\n\n/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});

test('displays exchange-traded fund prices with three decimal places', () => {
  const config = createConfig({
    displayFormat: '${name} ${changePercent} (${currency}${price}, ${change})',
    statusBarAlignment: 'center',
    colorUp: '#ff0000',
    colorDown: '#00ff00',
    colorFlat: '#cccccc',
    colorClosed: '#777777',
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateStatusBarItem = vscode.window.createStatusBarItem;
  const items = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createStatusBarItem = () => {
    const item = { show() {}, dispose() {} };
    items.push(item);
    return item;
  };

  try {
    const manager = new StatusBarManager();
    manager.reload(['sh513120']);
    manager.updateQuotes([{
      symbol: 'sh513120',
      name: '港股创新药ETF',
      price: 1.234,
      change: -0.002,
      changePercent: -0.16,
      previousClose: 1.236,
      open: 1.236,
      high: 1.240,
      low: 1.230,
    }]);

    assert.equal(items[0].text, '港股创新药ETF(A) -0.16% (¥1.234, -0.002)');
    assert.match(items[0].tooltip.value, /当前价：1\.234/);
    assert.match(items[0].tooltip.value, /涨跌：-0\.002/);
    assert.match(items[0].tooltip.value, /今开：1\.236/);
    assert.match(items[0].tooltip.value, /最高：1\.240/);
    assert.match(items[0].tooltip.value, /最低：1\.230/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});
