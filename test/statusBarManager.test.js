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
    assert.match(items[0].tooltip.value, /\[雪球查看详情\]\(https:\/\/xueqiu\.com\/S\/SH601318\)/);
    assert.match(items[1].tooltip.value, /\[雪球查看详情\]\(https:\/\/xueqiu\.com\/S\/00700\)/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});
