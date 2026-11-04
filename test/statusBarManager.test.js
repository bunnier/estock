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
        marketCap: 100_000_000_000,
        pe: 8.88,
        pb: 1.23,
        dividendYield: 4.56,
        volume: 12345,
        turnover: 1_234_500_000,
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
    assert.match(items[0].tooltip.value, /总市值：1000\.00亿元/);
    assert.match(items[1].tooltip.value, /总市值：--/);
    assert.match(items[0].tooltip.value, /今开：49\.50/);
    assert.match(items[0].tooltip.value, /最高：51\.00/);
    assert.match(items[0].tooltip.value, /最低：48\.00/);
    assert.match(items[0].tooltip.value, /振幅：6\.12%/);
    assert.match(items[0].tooltip.value, /PE\(TTM\)：8\.88/);
    assert.match(items[0].tooltip.value, /PB：1\.23/);
    assert.match(items[0].tooltip.value, /股息率：4\.56%/);
    assert.match(items[0].tooltip.value, /成交量：12,345  \n成交额：12\.35亿元/);
    assert.match(items[1].tooltip.value, /成交额：--/);
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

test('shows fund net value with premium rate in the hover detail', () => {
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
    const item = { show() {}, dispose() {} };
    items.push(item);
    return item;
  };

  try {
    const manager = new StatusBarManager();
    manager.reload(['sh513120']);
    manager.updateQuotes([{
      symbol: 'sh513120',
      name: '港股创新药ETF广发',
      price: 1.113,
      change: -0.042,
      changePercent: -3.64,
      previousClose: 1.155,
      open: 1.149,
      high: 1.152,
      low: 1.111,
      nav: 1.1248,
      isFund: true,
      time: '2026-11-03 16:14:49',
    }]);

    assert.equal(items[0].text, '港股创新药ETF广发(A) -3.64% (¥1.113)');
    assert.match(items[0].tooltip.value, /基金净值：1\.1248（溢价率：-1\.05%）/);
    assert.match(items[0].tooltip.value, /今开：1\.149/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});

test('renders index quotes without a currency symbol or stock-only metrics', () => {
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
    const item = { show() {}, dispose() {} };
    items.push(item);
    return item;
  };

  try {
    const manager = new StatusBarManager();
    manager.reload(['hkHSI']);
    manager.updateQuotes([{
      symbol: 'hkHSI',
      name: '恒生指数',
      price: 23525.97,
      change: 132.65,
      changePercent: 0.57,
      previousClose: 23393.32,
      open: 23469.64,
      high: 23549.31,
      low: 23347.03,
      isIndex: true,
      time: '2026/11/03 18:31:07',
    }]);

    assert.equal(items[0].text, '恒生指数(H) +0.57% (23525.97)');
    assert.match(items[0].tooltip.value, /今开：23469\.64/);
    assert.match(items[0].tooltip.value, /振幅：0\.86%/);
    assert.match(items[0].tooltip.value, /总市值：--/);
    assert.doesNotMatch(items[0].tooltip.value, /PE\(TTM\)/);
    assert.doesNotMatch(items[0].tooltip.value, /基金净值/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});

test('appends an upward movement alert to the stock item and restores it after thirty seconds', () => {
  const config = createConfig({
    displayFormat: '${name} ${changePercent} (${currency}${price})',
    statusBarAlignment: 'center',
    priceAlertEnabled: true,
    priceAlertWindowSeconds: 11,
    priceAlertColor: '#ffcc00',
    colorUp: '#ff0000',
    colorDown: '#00ff00',
    colorFlat: '#cccccc',
    colorClosed: '#777777',
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateStatusBarItem = vscode.window.createStatusBarItem;
  const items = [];
  let now = 0;
  let timeoutCallback;
  let timeoutDelay;

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createStatusBarItem = (_alignment, priority) => {
    const item = {
      priority,
      visible: false,
      show() { this.visible = true; },
      hide() { this.visible = false; },
      dispose() {},
    };
    items.push(item);
    return item;
  };

  try {
    const manager = new StatusBarManager({
      now: () => now,
      scheduleTimeout: (callback, delay) => {
        timeoutCallback = callback;
        timeoutDelay = delay;
        return 1;
      },
      cancelTimeout() {},
    });
    manager.reload(['sh601318']);
    manager.updateQuotes([{
      symbol: 'sh601318',
      name: '中国平安',
      price: 100,
      change: 0,
      changePercent: 0,
    }]);

    now = 11000;
    manager.updateQuotes([{
      symbol: 'sh601318',
      name: '中国平安',
      price: 101.2,
      change: 1.2,
      changePercent: 1.2,
    }]);

    assert.equal(items.length, 1);
    assert.equal(items[0].text, '中国平安(A) +1.20% (¥101.20)｜🚀');
    assert.equal(items[0].color, '#ffcc00');
    assert.match(items[0].tooltip.value, /异动提醒：11秒内股价波动 \+1\.20%。/);
    assert.equal(timeoutDelay, 30000);

    now = 130000;
    manager.updateQuotes([{
      symbol: 'sh601318',
      name: '中国平安',
      price: 101.21,
      change: 1.21,
      changePercent: 1.21,
    }]);
    assert.equal(items[0].text, '中国平安(A) +1.21% (¥101.21)｜🚀');
    assert.equal(items[0].color, '#ffcc00');

    timeoutCallback();
    assert.equal(items[0].text, '中国平安(A) +1.21% (¥101.21)');
    assert.equal(items[0].color, '#ff0000');
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});

test('appends a downward movement alert using the shared configured color', () => {
  const config = createConfig({
    displayFormat: '${name} ${changePercent} (${currency}${price})',
    statusBarAlignment: 'center',
    priceAlertEnabled: true,
    priceAlertWindowSeconds: 1.5,
    priceAlertThresholdPercent: 1,
    priceAlertColor: '#cc66ff',
    colorUp: '#ff0000',
    colorDown: '#00ff00',
    colorFlat: '#cccccc',
    colorClosed: '#777777',
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateStatusBarItem = vscode.window.createStatusBarItem;
  const items = [];
  let now = 0;

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createStatusBarItem = () => {
    const item = {
      show() {},
      hide() {},
      dispose() {},
    };
    items.push(item);
    return item;
  };

  try {
    const manager = new StatusBarManager({
      now: () => now,
      scheduleTimeout: () => 1,
      cancelTimeout() {},
    });
    manager.reload(['sh601318']);
    manager.updateQuotes([{
      symbol: 'sh601318',
      name: '中国平安',
      price: 100,
      change: 0,
      changePercent: 0,
    }]);

    now = 120000;
    manager.updateQuotes([{
      symbol: 'sh601318',
      name: '中国平安',
      price: 98.8,
      change: -1.2,
      changePercent: -1.2,
    }]);

    assert.equal(items.length, 1);
    assert.equal(items[0].text, '中国平安(A) -1.20% (¥98.80)｜💥');
    assert.equal(items[0].color, '#cc66ff');
    assert.match(items[0].tooltip.value, /异动提醒：120秒内股价波动 -1\.20%。/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  }
});
