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

test('showDetail includes a clickable Xueqiu URL', async () => {
  const originalShowQuickPick = vscode.window.showQuickPick;
  const originalCreateOutputChannel = vscode.window.createOutputChannel;
  const output = [];

  vscode.window.showQuickPick = async (items) => items[0];
  vscode.window.createOutputChannel = () => ({
    clear() {},
    appendLine(value) {
      output.push(value);
    },
    show() {},
  });

  try {
    const service = new StockService();
    service.statusBar = {
      getAllLastQuotes: () => [{
        symbol: 'hk00772',
        name: '阅文集团',
        price: 26.5,
        change: 0.5,
        changePercent: 1.92,
        previousClose: 26,
        high: 27,
        low: 25,
        time: '2026-07-14 15:00:00',
        delayed: true,
      }],
    };

    await service.showDetail();

    assert.match(output[0], /雪球详情：https:\/\/xueqiu\.com\/S\/00772/);
    assert.match(output[0], /振幅：\s+7\.69%/);
    assert.match(output[0], /更新时间：.*\(延迟约15分钟\)/);
  } finally {
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.window.createOutputChannel = originalCreateOutputChannel;
  }
});
