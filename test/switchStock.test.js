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

const { StockService } = require('../out/stockService');

function createConfig(initial) {
  const values = structuredClone(initial);
  const updates = [];

  return {
    values,
    updates,
    get(key, fallback) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    },
    async update(key, value) {
      values[key] = value;
      updates.push({ key, value });
    },
  };
}

test('switchStock without a command argument asks for the display position first', async () => {
  const config = createConfig({
    watchList: ['601318', '00700'],
    displayList: ['601318'],
    maxDisplay: 3,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowQuickPick = vscode.window.showQuickPick;

  let quickPickCalls = 0;
  const quickPickOptions = [];
  vscode.workspace.getConfiguration = () => config;
  vscode.window.showQuickPick = async (items, options) => {
    quickPickCalls += 1;
    quickPickOptions.push(options);
    const resolvedItems = Array.isArray(items) ? items : await items;
    if (quickPickCalls === 1) {
      return resolvedItems[0];
    }
    return resolvedItems.find(item => item.symbol === 'hk00700');
  };

  try {
    const service = new StockService();
    service.provider = { name: 'test', fetchQuotes: async () => [] };
    service.statusBar = {
      getLastQuote: () => undefined,
    };

    await service.switchStock();

    assert.deepEqual(config.values.displayList, ['hk00700']);
    assert.equal(quickPickCalls, 2);
    assert.equal(quickPickOptions[0].matchOnDescription, true);
    assert.equal(quickPickOptions[1].matchOnDescription, true);
    assert.equal(quickPickOptions[1].placeHolder, '输入股票代码或名称，选择要展示在位置 1 的股票（当前: 601318）');
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showQuickPick = originalShowQuickPick;
  }
});

test('addStockByInput searches Chinese keywords and adds the selected stock', async () => {
  const config = createConfig({
    watchList: [],
    displayList: [],
    maxDisplay: 3,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const originalWithProgress = vscode.window.withProgress;

  const messages = [];
  const progressOptions = [];
  vscode.workspace.getConfiguration = () => config;
  vscode.window.showQuickPick = async (items) => {
    const resolvedItems = Array.isArray(items) ? items : await items;
    return resolvedItems.find(item => item.symbol === 'sh601318');
  };
  vscode.window.showInformationMessage = (message) => {
    messages.push(message);
  };
  vscode.window.withProgress = async (options, task) => {
    progressOptions.push(options);
    return task();
  };

  try {
    const service = new StockService({
      search: async () => [
        { symbol: 'sh601318', code: '601318', name: '中国平安', market: 'A' },
      ],
    });
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'sh601318',
        name: '中国平安',
        price: 50,
        change: 1,
        changePercent: 2,
      }],
    };

    await service.addStockByInput('平安');

    assert.deepEqual(config.values.watchList, ['sh601318']);
    assert.deepEqual(messages, ['已添加 601318 到股票池']);
    assert.deepEqual(progressOptions, [{
      location: vscode.ProgressLocation.Notification,
      title: '正在搜索股票：平安',
      cancellable: false,
    }]);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.window.showInformationMessage = originalShowInformationMessage;
    vscode.window.withProgress = originalWithProgress;
  }
});

test('addStockByInput preserves the exchange prefix for ambiguous codes', async () => {
  const config = createConfig({
    watchList: ['000001'],
    displayList: [],
    maxDisplay: 3,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalShowInformationMessage = vscode.window.showInformationMessage;

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showQuickPick = async (items) => {
    const resolvedItems = Array.isArray(items) ? items : await items;
    return resolvedItems.find(item => item.symbol === 'sh000001');
  };
  vscode.window.showInformationMessage = () => undefined;

  try {
    const service = new StockService({
      search: async () => [
        { symbol: 'sh000001', code: '000001', name: '上证指数', market: 'A' },
        { symbol: 'sz000001', code: '000001', name: '平安银行', market: 'A' },
      ],
    });
    service.provider = {
      name: 'test',
      fetchQuotes: async (symbols) => symbols.map(symbol => ({
        symbol,
        name: '上证指数',
        price: 3500,
        change: 10,
        changePercent: 0.29,
      })),
    };

    await service.addStockByInput('上证指数');

    assert.deepEqual(config.values.watchList, ['000001', 'sh000001']);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.window.showInformationMessage = originalShowInformationMessage;
  }
});

test('addStockByInput adds Hong Kong indices without searching', async () => {
  const config = createConfig({
    watchList: [],
    displayList: [],
    maxDisplay: 3,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const originalWithProgress = vscode.window.withProgress;
  const messages = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showInformationMessage = (message) => {
    messages.push(message);
  };
  vscode.window.withProgress = () => assert.fail('Index codes should not trigger a search.');

  try {
    const service = new StockService({
      search: async () => assert.fail('Index codes should not trigger a search.'),
    });
    service.provider = {
      name: 'test',
      fetchQuotes: async (symbols) => symbols.map(symbol => ({
        symbol,
        name: '恒生指数',
        price: 23525.97,
        change: 132.65,
        changePercent: 0.57,
        isIndex: true,
      })),
    };

    await service.addStockByInput('hkHSI');
    await service.addStockByInput('hstech');

    assert.deepEqual(config.values.watchList, ['hkHSI', 'hkHSTECH']);
    assert.deepEqual(messages, ['已添加 HSI 到股票池', '已添加 HSTECH 到股票池']);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showInformationMessage = originalShowInformationMessage;
    vscode.window.withProgress = originalWithProgress;
  }
});

test('refreshOnce keeps closed market display after fetching fresh quotes', async () => {
  const config = createConfig({
    watchList: ['601318'],
    displayList: ['601318'],
    maxDisplay: 3,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const OriginalDate = Date;
  const calls = [];

  vscode.workspace.getConfiguration = () => config;
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate('2026-07-02T08:00:00.000Z');
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate('2026-07-02T08:00:00.000Z').getTime();
    }
  };

  try {
    const service = new StockService();
    service.holidayCalendar = { isHoliday: async () => false };
    service.provider = {
      name: 'test',
      fetchQuotes: async (symbols) => symbols.map(symbol => ({
        symbol,
        name: '中国平安',
        price: 50,
        change: 1,
        changePercent: 2,
      })),
    };
    service.statusBar = {
      updateQuotes: (quotes) => calls.push(['updateQuotes', quotes.map(q => q.symbol)]),
      showMarketClosed: (symbols) => calls.push(['showMarketClosed', symbols]),
    };

    await service.refreshOnce();

    assert.deepEqual(calls, [
      ['updateQuotes', ['sh601318']],
      ['showMarketClosed', ['sh601318']],
    ]);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    global.Date = OriginalDate;
  }
});

test('refreshOnce fetches explicitly displayed stocks even when they are outside the watch list', async () => {
  const config = createConfig({
    watchList: ['600183', '601318'],
    displayList: ['sh600183', 'sh601318', 'sz002027'],
    maxDisplay: 5,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const OriginalDate = Date;
  const calls = [];

  vscode.workspace.getConfiguration = () => config;
  global.Date = class FakeDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        return new OriginalDate('2026-07-15T02:00:00.000Z');
      }
      return new OriginalDate(...args);
    }

    static now() {
      return new OriginalDate('2026-07-15T02:00:00.000Z').getTime();
    }
  };

  try {
    const service = new StockService();
    service.holidayCalendar = { isHoliday: async () => false };
    service.provider = {
      name: 'test',
      fetchQuotes: async (symbols) => {
        calls.push(symbols);
        return symbols.map(symbol => ({
          symbol,
          name: symbol,
          price: 10,
          change: 0,
          changePercent: 0,
        }));
      },
    };
    service.statusBar = {
      updateQuotes: () => undefined,
      showMarketClosed: () => undefined,
    };

    await service.refreshOnce();

    assert.deepEqual(calls, [['sh600183', 'sh601318', 'sz002027']]);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    global.Date = OriginalDate;
  }
});

test('showDetail includes a clickable Xueqiu URL', async () => {
  const config = createConfig({
    watchList: ['00772'],
    displayList: [],
    maxDisplay: 1,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const output = [];
  const cache = new Map();

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showQuickPick = async (items) => {
    assert.match(items[0].description, /总市值：265\.00亿港元/);
    return items[0];
  };
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) {
      output.push(value);
    },
    show() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'hk00772',
        name: '阅文集团',
        price: 26.5,
        change: 0.5,
        changePercent: 1.92,
        previousClose: 26,
        high: 27,
        low: 25,
        marketCap: 26_500_000_000,
        volume: 7654321,
        turnover: 265_000_000,
        pe: 15.63,
        pb: 3.31,
        dividendYield: 1.16,
        time: '2026-07-14 15:00:00',
        delayed: true,
      }],
    };
    service.statusBar = {
      updateQuotes: (quotes) => {
        for (const quote of quotes) {
          cache.set(quote.symbol, quote);
        }
      },
      getLastQuote: (symbol) => cache.get(symbol),
    };

    await service.showDetail();

    assert.match(output[0], /雪球详情：https:\/\/xueqiu\.com\/S\/00772/);
    assert.match(output[0], /振幅：\s+7\.69%/);
    assert.match(output[0], /总市值：\s+265\.00亿港元/);
    assert.match(output[0], /成交量：\s+7,654,321\n  成交额：\s+2\.65亿港元/);
    assert.match(output[0], /PE\(TTM\)：\s+15\.63/);
    assert.match(output[0], /PB：\s+3\.31/);
    assert.match(output[0], /股息率：\s+1\.16%/);
    assert.match(output[0], /更新时间：.*\(延迟约15分钟\)/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('showDetail lets users pick stocks from the full watch list', async () => {
  const config = createConfig({
    watchList: ['601318', '00700'],
    displayList: ['601318'],
    maxDisplay: 1,
  });

  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const output = [];
  const cache = new Map();
  const quickPickSymbols = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showQuickPick = async (items) => {
    const resolvedItems = Array.isArray(items) ? items : await items;
    quickPickSymbols.push(...resolvedItems.map(item => item.symbol));
    return resolvedItems.find(item => item.symbol === 'hk00700');
  };
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) {
      output.push(value);
    },
    show() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async (symbols) => symbols.map(symbol => ({
        symbol,
        name: symbol === 'hk00700' ? '腾讯控股' : '中国平安',
        price: symbol === 'hk00700' ? 460 : 50,
        change: symbol === 'hk00700' ? 4 : 1,
        changePercent: symbol === 'hk00700' ? 0.88 : 2,
      })),
    };
    service.statusBar = {
      updateQuotes: (quotes) => {
        for (const quote of quotes) {
          cache.set(quote.symbol, quote);
        }
      },
      getLastQuote: (symbol) => cache.get(symbol),
    };

    await service.showDetail();

    assert.deepEqual(quickPickSymbols, ['sh601318', 'hk00700']);
    assert.match(output[0], /腾讯控股\(H\) \(00700\)/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('switchStock displays exchange-traded fund prices with three decimal places', async () => {
  const config = createConfig({
    watchList: ['513120', '601318'],
    displayList: ['601318'],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowQuickPick = vscode.window.showQuickPick;
  let etfItem;

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showQuickPick = async (items) => {
    etfItem = items.find(item => item.symbol === 'sh513120');
    return etfItem;
  };

  try {
    const service = new StockService();
    service.statusBar = {
      getLastQuote: (symbol) => symbol === 'sh513120' ? {
        symbol,
        name: '港股创新药ETF',
        price: 1.234,
        change: -0.002,
        changePercent: -0.16,
      } : undefined,
    };

    await service.switchStock(0);

    assert.match(etfItem.description, /1\.234/);
    assert.deepEqual(config.values.displayList, ['sh513120']);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showQuickPick = originalShowQuickPick;
  }
});

test('showDetail displays exchange-traded fund prices with three decimal places', async () => {
  const config = createConfig({ watchList: ['513120'], displayList: [], maxDisplay: 1 });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const cache = new Map();
  const output = [];
  let detailItem;

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showQuickPick = async (items) => {
    detailItem = items[0];
    return detailItem;
  };
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) { output.push(value); },
    show() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'sh513120',
        name: '港股创新药ETF',
        price: 1.234,
        change: -0.002,
        changePercent: -0.16,
        previousClose: 1.236,
        open: 1.236,
        high: 1.240,
        low: 1.230,
        nav: 1.236,
        isFund: true,
      }],
    };
    service.statusBar = {
      updateQuotes: (quotes) => {
        for (const quote of quotes) cache.set(quote.symbol, quote);
      },
      getLastQuote: (symbol) => cache.get(symbol),
    };

    await service.showDetail();

    assert.match(detailItem.description, /1\.234/);
    assert.match(output[0], /当前价：\s+1\.234/);
    assert.match(output[0], /涨跌：\s+-0\.002/);
    assert.match(output[0], /基金净值：1\.2360（溢价率：-0\.16%）/);
    assert.match(output[0], /今开：\s+1\.236/);
    assert.match(output[0], /最高：\s+1\.240/);
    assert.match(output[0], /最低：\s+1\.230/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('showWatchListDetail outputs every stock with complete detail columns', async () => {
  const config = createConfig({
    watchList: ['513120', '00772'],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const cache = new Map();
  const output = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) { output.push(value); },
    show() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'sh513120',
        name: '港股创新药ETF',
        price: 1.234,
        change: 0.002,
        changePercent: 0.16,
        previousClose: 1.232,
        open: 1.230,
        high: 1.240,
        low: 1.220,
        volume: 1234567,
        pe: 12.3,
        pb: 1.5,
        dividendYield: 2,
        time: '2026-07-30 15:00:00',
      }, {
        symbol: 'hk00772',
        name: '阅文集团',
        price: 26.5,
        change: -0.5,
        changePercent: -1.85,
        previousClose: 27,
        open: 27,
        high: 27.5,
        low: 26,
        marketCap: 26_500_000_000,
        volume: 7654321,
        turnover: 265_000_000,
        pe: 15.63,
        pb: 3.31,
        dividendYield: 1.16,
        time: '2026-07-30 15:00:00',
        delayed: true,
      }],
    };
    service.statusBar = {
      updateQuotes: (quotes) => {
        for (const quote of quotes) cache.set(quote.symbol, quote);
      },
      getLastQuote: (symbol) => cache.get(symbol),
    };

    await service.showWatchListDetail();

    assert.equal(output.length, 1);
    assert.match(output[0], /名称\s+\|\s+代码\s+\|\s+当前价\s+\|\s+涨跌\s+\|\s+涨跌幅/);
    assert.match(output[0], /今开\s+\|\s+最高\s+\|\s+最低\s+\|\s+振幅\s+\|\s+总市值\s+\|\s+PE\(TTM\)\s+\|\s+PB/);
    assert.match(output[0], /总市值/);
    assert.match(output[0], /阅文集团.*265\.00亿港元.*7,654,321.*2\.65亿港元/);
    assert.match(output[0], /港股创新药ETF.*--/);
    assert.match(output[0], /股息率\s+\|\s+成交量\s+\|\s+成交额\s+\|\s+更新时间\s+\|\s+雪球详情/);
    assert.match(output[0], /港股创新药ETF\(A\).*513120.*1\.234.*\+0\.002.*\+0\.16%.*1\.230.*1\.240.*1\.220.*1\.62%.*12\.30.*1\.50.*2\.00%.*1,234,567.*https:\/\/xueqiu\.com\/S\/SH513120/);
    assert.match(output[0], /阅文集团\(H\).*00772.*26\.50.*-0\.50.*-1\.85%.*27\.00.*27\.50.*26\.00.*5\.56%.*15\.63.*3\.31.*1\.16%.*7,654,321.*2026-07-30 15:00:00.*https:\/\/xueqiu\.com\/S\/00772/);
    assert.doesNotMatch(output[0], /延迟约15分钟/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('showWatchListDetail sorts stocks by name and then code', async () => {
  const config = createConfig({
    watchList: ['601318', '02318', '09988'],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const cache = new Map();
  const output = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) { output.push(value); },
    show() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'sh601318',
        name: '中国平安',
        price: 50,
        change: 0,
        changePercent: 0,
      }, {
        symbol: 'hk02318',
        name: '中国平安',
        price: 40,
        change: 0,
        changePercent: 0,
      }, {
        symbol: 'hk09988',
        name: '阿里巴巴',
        price: 100,
        change: 0,
        changePercent: 0,
      }],
    };
    service.statusBar = {
      updateQuotes: (quotes) => {
        for (const quote of quotes) cache.set(quote.symbol, quote);
      },
      getLastQuote: (symbol) => cache.get(symbol),
    };

    await service.showWatchListDetail();

    const alibabaIndex = output[0].indexOf('阿里巴巴(H)');
    const pingAnHongKongIndex = output[0].indexOf('中国平安(H)');
    const pingAnChinaIndex = output[0].indexOf('中国平安(A)');
    assert.ok(alibabaIndex < pingAnHongKongIndex);
    assert.ok(pingAnHongKongIndex < pingAnChinaIndex);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('showWatchListDetail keeps partial results and lists unavailable stocks', async () => {
  const config = createConfig({
    watchList: ['601318', '00772'],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const cache = new Map([['hk00772', {
    symbol: 'hk00772',
    name: '阅文集团旧行情',
    price: 25,
    change: 1,
    changePercent: 4.17,
  }]]);
  const output = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) { output.push(value); },
    show() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'sh601318',
        name: '中国平安',
        price: 50,
        change: 0,
        changePercent: 0,
      }, {
        symbol: 'hk00772',
        name: 'hk00772',
        price: 0,
        change: 0,
        changePercent: 0,
      }],
    };
    service.statusBar = {
      updateQuotes: (quotes) => {
        for (const quote of quotes) cache.set(quote.symbol, quote);
      },
      getLastQuote: (symbol) => cache.get(symbol),
    };

    await service.showWatchListDetail();

    assert.match(output[0], /中国平安.*601318.*50\.00.*\+0\.00.*\+0\.00%/);
    assert.doesNotMatch(output[0], /阅文集团旧行情/);
    assert.match(output[0], /--\s+\|\s+--\s+\|\s+--\s+\|\s+--/);
    assert.match(output[0], /未获取到行情：00772/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('showWatchListDetail waits for an active refresh before requesting complete quotes', async () => {
  const config = createConfig({
    watchList: ['601318'],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const output = [];
  let fetchCount = 0;
  let resolveFirstFetch;

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) { output.push(value); },
    show() {},
    dispose() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return new Promise(resolve => {
            resolveFirstFetch = resolve;
          });
        }
        return [{
          symbol: 'sh601318',
          name: '中国平安',
          price: 50,
          change: 0,
          changePercent: 0,
        }];
      },
    };
    service.statusBar = {
      updateQuotes() {},
      getLastQuote() { return undefined; },
    };

    const activeRefresh = service.refreshSymbols(['sh601318']);
    const detailRefresh = service.showWatchListDetail();
    resolveFirstFetch([{
      symbol: 'sh601318',
      name: '中国平安',
      price: 49,
      change: 0,
      changePercent: 0,
    }]);

    await activeRefresh;
    await detailRefresh;

    assert.equal(fetchCount, 2);
    assert.match(output[0], /中国平安.*601318.*50\.00/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('showWatchListDetail reuses its output channel', async () => {
  const config = createConfig({
    watchList: ['601318'],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  let channelCount = 0;

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createOutputChannel = () => {
    channelCount += 1;
    return {
      clear() {},
      appendLine() {},
      show() {},
      dispose() {},
    };
  };

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'sh601318',
        name: '中国平安',
        price: 50,
        change: 0,
        changePercent: 0,
      }],
    };
    service.statusBar = {
      updateQuotes() {},
      getLastQuote() { return undefined; },
    };

    await service.showWatchListDetail();
    await service.showWatchListDetail();

    assert.equal(channelCount, 1);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});

test('showWatchListDetail prompts when the watch list is empty', async () => {
  const config = createConfig({
    watchList: [],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const messages = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showInformationMessage = (message) => {
    messages.push(message);
  };

  try {
    const service = new StockService();

    await service.showWatchListDetail();

    assert.deepEqual(messages, ['暂无股票数据，请先添加关注股票']);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showInformationMessage = originalShowInformationMessage;
  }
});

test('showWatchListDetail prompts when no stock quote is available', async () => {
  const config = createConfig({
    watchList: ['601318'],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalShowInformationMessage = vscode.window.showInformationMessage;
  const messages = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.showInformationMessage = (message) => {
    messages.push(message);
  };

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [],
    };
    service.statusBar = {
      updateQuotes: () => undefined,
      getLastQuote: () => undefined,
    };

    await service.showWatchListDetail();

    assert.deepEqual(messages, ['暂无股票数据，请先刷新或检查股票池']);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.showInformationMessage = originalShowInformationMessage;
  }
});

test('showWatchListDetail adds a fund net value column only when the watch list contains funds', async () => {
  const config = createConfig({
    watchList: ['513120', '601318'],
    displayList: [],
    maxDisplay: 1,
  });
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const cache = new Map();
  const output = [];

  vscode.workspace.getConfiguration = () => config;
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) { output.push(value); },
    show() {},
  });

  try {
    const service = new StockService();
    service.provider = {
      name: 'test',
      fetchQuotes: async () => [{
        symbol: 'sh513120',
        name: '港股创新药ETF广发',
        price: 1.113,
        change: -0.042,
        changePercent: -3.64,
        nav: 1.1248,
        isFund: true,
        time: '2026-11-03 16:14:49',
      }, {
        symbol: 'sh601318',
        name: '中国平安',
        price: 50,
        change: 1,
        changePercent: 2,
      }],
    };
    service.statusBar = {
      updateQuotes: (quotes) => {
        for (const quote of quotes) cache.set(quote.symbol, quote);
      },
      getLastQuote: (symbol) => cache.get(symbol),
    };

    await service.showWatchListDetail();

    assert.match(output[0], /涨跌幅\s+\|\s+基金净值\s+\|\s+今开/);
    assert.match(output[0], /1\.1248（溢价率：-1\.05%）/);
    assert.match(output[0], /中国平安\(A\).*50\.00/);

    config.values.watchList = ['601318'];
    const previousLength = output.length;
    await service.showWatchListDetail();
    const stockOnly = output.slice(previousLength).join('\n');
    assert.doesNotMatch(stockOnly, /基金净值/);
  } finally {
    vscode.workspace.getConfiguration = originalGetConfiguration;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});
