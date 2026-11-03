/**
 * StockService - 核心调度逻辑
 * 管理股票池、展示列表、刷新定时器、开盘判断、切换股票
 *
 * watchList  → 股票池（所有关注的股票）
 * displayList → 状态栏展示的股票（可独立配置，可排序）
 */

import * as vscode from 'vscode';
import { calculateAmplitude, DataProvider, Quote } from './providers/baseProvider';
import { SmartProvider } from './providers/smartProvider';
import { SinaStockSearchProvider, StockSearchResult } from './providers/stockSearchProvider';
import { StatusBarManager } from './statusBarManager';
import { formatAmount, formatMarketCap, formatPrice, normalizeSymbols, resolveIndexAlias, stripPrefix, getMarketTag, nameWithMarket, toXueqiuUrl } from './utils/symbolParser';
import { formatFundNav, hasFundNav } from './utils/fundInfo';
import { HolidayCalendar } from './utils/holidayCalendar';
import { getMarketStatusForSymbol } from './utils/marketTime';

interface StockSearchProvider {
  search(keyword: string): Promise<StockSearchResult[]>;
}

interface DetailTableColumn {
  title: string;
  value: (quote: Quote) => string;
}

/** 计算文本在等宽终端中的显示宽度。 */
function displayWidth(value: string): number {
  return Array.from(value).reduce((width, character) => {
    return width + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(character) ? 2 : 1);
  }, 0);
}

/** 使用空格补齐表格单元格。 */
function padTableCell(value: string, width: number): string {
  return value + ' '.repeat(Math.max(width - displayWidth(value), 0));
}

/** 判断行情是否包含可展示的有效价格。 */
function isAvailableQuote(quote: Quote | undefined): quote is Quote {
  return quote !== undefined && Number.isFinite(quote.price) && quote.price > 0;
}

/** 判断输入是否可以直接作为代码添加（含港股指数代码与常见指数别名）。 */
function isDirectSymbolInput(value: string): boolean {
  return /^\d{5,6}$/.test(value)
    || /^(sh|sz|hk)[0-9a-z]+$/i.test(value)
    || resolveIndexAlias(value) !== undefined;
}

/** 将股票详情格式化为纯文本表格。 */
function formatDetailTable(quotes: Quote[]): string {
  const sortedQuotes = [...quotes].sort((left, right) => {
    const nameOrder = left.name.localeCompare(right.name, 'zh-CN');
    if (nameOrder !== 0) return nameOrder;
    return stripPrefix(left.symbol).localeCompare(stripPrefix(right.symbol), undefined, { numeric: true });
  });
  const optionalPrice = (quote: Quote, value: number | undefined): string => {
    return value === undefined ? '--' : formatPrice(quote.symbol, value);
  };
  const optionalNumber = (value: number | undefined, suffix = ''): string => {
    return value === undefined ? '--' : `${value.toFixed(2)}${suffix}`;
  };
  const columns: DetailTableColumn[] = [
    { title: '名称', value: quote => nameWithMarket(quote.name, quote.symbol) },
    { title: '代码', value: quote => stripPrefix(quote.symbol) },
    { title: '当前价', value: quote => formatPrice(quote.symbol, quote.price) },
    {
      title: '涨跌',
      value: quote => `${quote.change >= 0 ? '+' : ''}${formatPrice(quote.symbol, quote.change)}`,
    },
    {
      title: '涨跌幅',
      value: quote => `${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%`,
    },
  ];
  // 股票池里存在基金时，才插入净值列，避免纯股票列表出现整列的占位符。
  if (sortedQuotes.some(hasFundNav)) {
    const insertAt = columns.findIndex(column => column.title === '涨跌幅') + 1;
    columns.splice(insertAt, 0, {
      title: '基金净值',
      value: quote => formatFundNav(quote) ?? '--',
    });
  }
  columns.push(
    { title: '今开', value: quote => optionalPrice(quote, quote.open) },
    { title: '最高', value: quote => optionalPrice(quote, quote.high) },
    { title: '最低', value: quote => optionalPrice(quote, quote.low) },
    { title: '振幅', value: quote => optionalNumber(calculateAmplitude(quote), '%') },
    { title: '总市值', value: quote => formatMarketCap(quote.symbol, quote.marketCap) },
    { title: 'PE(TTM)', value: quote => optionalNumber(quote.pe) },
    { title: 'PB', value: quote => optionalNumber(quote.pb) },
    { title: '股息率', value: quote => optionalNumber(quote.dividendYield, '%') },
    { title: '成交量', value: quote => quote.volume === undefined ? '--' : quote.volume.toLocaleString() },
    { title: '成交额', value: quote => formatAmount(quote.symbol, quote.turnover) },
    {
      title: '更新时间',
      value: quote => quote.time || '--',
    },
    { title: '雪球详情', value: quote => toXueqiuUrl(quote.symbol) },
  );
  const rows = sortedQuotes.map(quote => columns.map(column => column.value(quote)));
  const widths = columns.map((column, index) => {
    return Math.max(displayWidth(column.title), ...rows.map(row => displayWidth(row[index])));
  });
  const renderRow = (values: string[]): string => {
    return values.map((value, index) => padTableCell(value, widths[index])).join(' | ');
  };
  const separator = widths.map(width => '-'.repeat(width)).join('-+-');

  return [
    renderRow(columns.map(column => column.title)),
    separator,
    ...rows.map(renderRow),
  ].join('\n');
}

/** 统一股票选择菜单中的名称、代码和可选行情。 */
function stockQuickPickItem(symbol: string, name?: string, quote?: Quote) {
  const code = stripPrefix(symbol);
  return {
    label: nameWithMarket(name || code, symbol),
    description: quote
      ? `${code}  ${formatPrice(symbol, quote.price)}  ${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%  总市值：${formatMarketCap(symbol, quote.marketCap)}`
      : code,
    symbol,
  };
}

export class StockService {
  private provider!: DataProvider;
  private statusBar!: StatusBarManager;
  private timer?: NodeJS.Timeout;
  private ctx!: vscode.ExtensionContext;
  private activeRefresh?: Promise<Quote[]>;
  private outputChannel?: vscode.OutputChannel;
  private holidayCalendar = new HolidayCalendar();
  private searchProvider: StockSearchProvider;

  constructor(searchProvider: StockSearchProvider = new SinaStockSearchProvider()) {
    this.searchProvider = searchProvider;
  }

  /** 股票池（所有关注的股票，已标准化） */
  private get watchList(): string[] {
    const raw = vscode.workspace.getConfiguration('estock')
      .get<string[]>('watchList', []);
    return normalizeSymbols(raw || []);
  }

  /** 状态栏展示列表（已标准化） */
  private get displayList(): string[] {
    const raw = vscode.workspace.getConfiguration('estock')
      .get<string[]>('displayList', []);
    const normalized = normalizeSymbols(raw || []);
    if (normalized.length === 0) {
      const maxDisplay = vscode.workspace.getConfiguration('estock')
        .get<number>('maxDisplay', 8);
      return this.watchList.slice(0, maxDisplay);
    }
    return normalized;
  }

  /** 需要请求行情的所有股票（watchList 与 displayList 的合集，保证缓存完整） */
  private get allSymbols(): string[] {
    return Array.from(new Set([...this.watchList, ...this.displayList]));
  }

  /** 刷新间隔（秒） */
  private get refreshIntervalSec(): number {
    const v = vscode.workspace.getConfiguration('estock')
      .get<number>('refreshInterval', 10);
    return Math.max(v || 10, 5);
  }

  activate(ctx: vscode.ExtensionContext, statusBar: StatusBarManager): void {
    this.ctx = ctx;
    this.statusBar = statusBar;
    this.initProvider();

    ctx.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('estock')) {
          this.onConfigChanged();
        }
      })
    );

    this.statusBar.reload(this.displayList);
    this.startTimer();
    this.refreshOnce();
  }

  private initProvider(): void {
    this.provider = new SmartProvider();
    console.log(`[estock] using provider: ${this.provider.name}`);
  }

  private onConfigChanged(): void {
    this.initProvider();
    this.statusBar.reload(this.displayList);
    this.restartTimer();
    this.refreshOnce();
  }

  private startTimer(): void {
    this.stopTimer();
    const ms = this.refreshIntervalSec * 1000;
    this.timer = setInterval(() => {
      void this.refreshMarketAware();
    }, ms);
  }

  private restartTimer(): void {
    this.startTimer();
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** 手动刷新（命令触发，不受开盘判断限制） */
  async refreshOnce(): Promise<void> {
    await this.refreshByMarketStatus(true);
  }

  private async refreshMarketAware(): Promise<void> {
    await this.refreshByMarketStatus(false);
  }

  private async refreshByMarketStatus(includeClosedRefresh: boolean): Promise<void> {
    const symbols = this.allSymbols;
    if (symbols.length === 0) return;

    const refreshSymbols: string[] = [];
    const settlingSymbols: string[] = [];
    const closedSymbols: string[] = [];
    const now = new Date();
    for (const symbol of symbols) {
      const status = await getMarketStatusForSymbol(symbol, now, this.holidayCalendar);
      if (status === 'open') {
        refreshSymbols.push(symbol);
      } else if (status === 'settling') {
        refreshSymbols.push(symbol);
        settlingSymbols.push(symbol);
      } else {
        if (includeClosedRefresh) {
          refreshSymbols.push(symbol);
        }
        closedSymbols.push(symbol);
      }
    }

    if (refreshSymbols.length > 0) {
      await this.refreshSymbols(refreshSymbols);
    }
    const closedDisplaySymbols = [...settlingSymbols, ...closedSymbols];
    if (closedDisplaySymbols.length > 0) {
      this.statusBar.showMarketClosed(closedDisplaySymbols);
    }
  }

  private async refreshSymbols(symbols: string[]): Promise<Quote[]> {
    if (this.activeRefresh || symbols.length === 0) return [];

    const refresh = (async (): Promise<Quote[]> => {
      try {
        const quotes = await this.provider.fetchQuotes(symbols);
        this.statusBar.updateQuotes(quotes);
        return quotes;
      } catch (e) {
        console.warn('[estock] refreshOnce failed', e);
        return [];
      }
    })();
    const trackedRefresh = refresh.finally(() => {
      if (this.activeRefresh === trackedRefresh) {
        this.activeRefresh = undefined;
      }
    });
    this.activeRefresh = trackedRefresh;
    return trackedRefresh;
  }

  /** 等待当前刷新结束，避免详情命令把“正在刷新”误判为无行情。 */
  private async waitForActiveRefresh(): Promise<void> {
    while (this.activeRefresh) {
      await this.activeRefresh;
    }
  }

  /** 获取详情页面共用的输出通道。 */
  private getOutputChannel(): vscode.OutputChannel {
    if (!this.outputChannel) {
      this.outputChannel = vscode.window.createOutputChannel('码盯·撸得金');
    }
    return this.outputChannel;
  }

  /** 添加股票到股票池 */
  async addStock(symbol: string): Promise<void> {
    const raw = vscode.workspace.getConfiguration('estock')
      .get<string[]>('watchList', []);
    const normalized = normalizeSymbols([symbol])[0];

    const existing = normalizeSymbols(raw || []);
    if (existing.includes(normalized)) {
      vscode.window.showWarningMessage(`股票 ${stripPrefix(normalized)} 已在股票池中`);
      return;
    }

    // 校验：尝试请求一次
    try {
      const testQuotes = await this.provider.fetchQuotes([normalized]);
      if (!testQuotes[0] || testQuotes[0].price === 0) {
        vscode.window.showErrorMessage(`无法获取股票数据，请检查代码: ${symbol}`);
        return;
      }
    } catch {
      vscode.window.showErrorMessage(`无法获取股票数据，请检查代码: ${symbol}`);
      return;
    }

    const newList = [...(raw || []), normalized];
    await vscode.workspace.getConfiguration('estock')
      .update('watchList', newList, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`已添加 ${stripPrefix(normalized)} 到股票池`);
  }

  /** 根据代码或中文关键词添加股票 */
  async addStockByInput(input: string): Promise<void> {
    const keyword = input.trim();
    if (!keyword) return;

    if (isDirectSymbolInput(keyword)) {
      await this.addStock(keyword);
      return;
    }

    let results: StockSearchResult[];
    try {
      results = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `正在搜索股票：${keyword}`,
          cancellable: false,
        },
        () => this.searchProvider.search(keyword),
      );
    } catch (e) {
      console.warn('[estock] stock search failed', e);
      vscode.window.showErrorMessage(`搜索股票失败，请稍后重试: ${keyword}`);
      return;
    }

    if (results.length === 0) {
      vscode.window.showWarningMessage(`未找到匹配股票: ${keyword}`);
      return;
    }

    const pick = await vscode.window.showQuickPick(
      results.map(result => ({
        ...stockQuickPickItem(result.symbol, result.name),
        detail: result.isIndex ? '港股指数' : (result.market === 'A' ? 'A股' : '港股'),
        symbol: result.symbol,
        code: result.code,
      })),
      { placeHolder: `选择要添加的股票：${keyword}`, matchOnDescription: true }
    );

    if (!pick) return;
    await this.addStock(pick.symbol);
  }

  /** 选择要移除的股票，优先使用缓存中的名称。 */
  async showRemoveStock(): Promise<void> {
    const symbols = this.watchList;
    if (symbols.length === 0) {
      vscode.window.showInformationMessage('股票池为空');
      return;
    }

    if (symbols.some(symbol => !this.statusBar.getLastQuote(symbol)?.name)) {
      await this.waitForActiveRefresh();
      const missingSymbols = symbols.filter(symbol => !this.statusBar.getLastQuote(symbol)?.name);
      await this.refreshSymbols(missingSymbols);
    }

    const pick = await vscode.window.showQuickPick(
      symbols.map(symbol => {
        const name = this.statusBar.getLastQuote(symbol)?.name;
        return stockQuickPickItem(symbol, name);
      }),
      {
        placeHolder: '输入股票代码或名称，选择要从股票池移除的股票',
        matchOnDescription: true,
      },
    );
    if (pick) {
      await this.removeStock(pick.symbol);
    }
  }

  /** 从股票池移除 */
  async removeStock(symbol: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('estock');
    const raw = cfg.get<string[]>('watchList', []);
    if (!raw || raw.length === 0) return;

    const target = normalizeSymbols([symbol])[0];
    const newWatchList = raw.filter(s => normalizeSymbols([s])[0] !== target);

    // 同时从 displayList 中移除
    const rawDisplay = cfg.get<string[]>('displayList', []);
    const newDisplayList = (rawDisplay || []).filter(s =>
      normalizeSymbols([s])[0] !== target
    );

    await cfg.update('watchList', newWatchList, vscode.ConfigurationTarget.Global);
    await cfg.update('displayList', newDisplayList, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`已从股票池移除 ${stripPrefix(target)}`);
  }

  /**
   * 切换状态栏某个位置的股票
   * @param position 状态栏位置索引
   */
  async switchStock(position?: number): Promise<void> {
    const pool = this.watchList;
    if (pool.length === 0) {
      vscode.window.showInformationMessage('股票池为空，请先添加股票');
      return;
    }

    const currentDisplay = this.displayList;
    if (position === undefined || !Number.isInteger(position)) {
      const positionPick = await vscode.window.showQuickPick(
        currentDisplay.map((symbol, index) => {
          const item = stockQuickPickItem(symbol, this.statusBar.getLastQuote(symbol)?.name);
          return { ...item, label: `${index + 1}. ${item.label}`, position: index };
        }),
        {
          placeHolder: '输入股票代码或名称，选择要切换的状态栏位置',
          matchOnDescription: true,
        }
      );
      if (!positionPick) return;
      position = positionPick.position;
    }

    const currentSymbol = currentDisplay[position];

    // 弹出股票池 QuickPick
    const pick = await vscode.window.showQuickPick(
      pool.map(s => {
        const quote = this.statusBar.getLastQuote(s);
        const isCurrent = currentDisplay[position] === s;
        const item = stockQuickPickItem(s, quote?.name, quote);
        return { ...item, label: `${isCurrent ? '● ' : '  '}${item.label}` };
      }),
      {
        placeHolder: `输入股票代码或名称，选择要展示在位置 ${position + 1} 的股票${currentSymbol ? `（当前: ${stripPrefix(currentSymbol)}）` : ''}`,
        matchOnDescription: true,
      }
    );
    if (!pick) return;

    // 更新 displayList
    const cfg = vscode.workspace.getConfiguration('estock');
    const rawDisplay = cfg.get<string[]>('displayList', []);
    let newDisplay: string[];

    if (position < (rawDisplay || []).length) {
      // 替换已有位置
      newDisplay = [...(rawDisplay || [])];
      newDisplay[position] = pick.symbol;
    } else {
      // 追加到末尾
      newDisplay = [...(rawDisplay || []), pick.symbol];
    }

    await cfg.update('displayList', newDisplay, vscode.ConfigurationTarget.Global);
    // 配置变化会自动触发 onConfigChanged → reload + refresh
  }

  /** 显示股票详情（QuickPick 选择 → OutputChannel 展示） */
  async showDetail(): Promise<void> {
    const symbols = this.watchList;

    if (symbols.length === 0) {
      vscode.window.showInformationMessage('暂无股票数据，请先添加关注股票');
      return;
    }

    await this.refreshSymbols(symbols);
    const quotes = symbols
      .map(symbol => this.statusBar.getLastQuote(symbol))
      .filter((quote): quote is Quote => quote !== undefined);

    if (quotes.length === 0) {
      vscode.window.showInformationMessage('暂无股票数据，请先刷新或检查股票池');
      return;
    }

    const pick = await vscode.window.showQuickPick(
      quotes.map(q => stockQuickPickItem(q.symbol, q.name, q)),
      { placeHolder: '选择要查看详情的股票', matchOnDescription: true }
    );
    if (!pick) return;

    const quote = quotes.find(q => q.symbol === pick.symbol);
    if (!quote) return;

    const tag = getMarketTag(quote.symbol);
    const price = (value: number): string => formatPrice(quote.symbol, value);
    const channel = this.getOutputChannel();
    const lines: string[] = [
      `╔══════════════════════════════════════╗`,
      `║  ${quote.name}(${tag}) (${stripPrefix(quote.symbol)})`,
      `╠══════════════════════════════════════╣`,
      ``,
      `  当前价：  ${price(quote.price)}`,
      `  涨跌：    ${quote.change >= 0 ? '+' : ''}${price(quote.change)}  (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`,
    ];
    const fundNav = formatFundNav(quote);
    if (fundNav !== undefined) lines.push(`  基金净值：${fundNav}`);
    if (quote.open !== undefined) lines.push(`  今开：    ${price(quote.open)}`);
    if (quote.high !== undefined) lines.push(`  最高：    ${price(quote.high)}`);
    if (quote.low !== undefined) lines.push(`  最低：    ${price(quote.low)}`);
    const amplitude = calculateAmplitude(quote);
    if (amplitude !== undefined) lines.push(`  振幅：    ${amplitude.toFixed(2)}%`);
    lines.push(`  总市值：  ${formatMarketCap(quote.symbol, quote.marketCap)}`);
    if (quote.pe !== undefined) lines.push(`  PE(TTM)： ${quote.pe.toFixed(2)}`);
    if (quote.pb !== undefined) lines.push(`  PB：      ${quote.pb.toFixed(2)}`);
    if (quote.dividendYield !== undefined) lines.push(`  股息率：  ${quote.dividendYield.toFixed(2)}%`);
    if (quote.volume !== undefined) lines.push(`  成交量：  ${quote.volume.toLocaleString()}`);
    lines.push(`  成交额：  ${formatAmount(quote.symbol, quote.turnover)}`);
    if (quote.time) {
      const delayTag = quote.delayed ? ' (延迟约15分钟)' : '';
      lines.push(`  更新时间：${quote.time}${delayTag}`);
    }
    lines.push(`  雪球详情：${toXueqiuUrl(quote.symbol)}`);
    lines.push(``, `╚══════════════════════════════════════╝`);

    channel.clear();
    channel.appendLine(lines.join('\n'));
    channel.show(true);
  }

  /** 以表格展示股票池中全部股票的详情。 */
  async showWatchListDetail(): Promise<void> {
    const symbols = this.watchList;

    if (symbols.length === 0) {
      vscode.window.showInformationMessage('暂无股票数据，请先添加关注股票');
      return;
    }

    await this.waitForActiveRefresh();
    const refreshedQuotes = await this.refreshSymbols(symbols);
    const quoteBySymbol = new Map(
      refreshedQuotes
        .filter(isAvailableQuote)
        .map(quote => [quote.symbol, quote]),
    );
    const quotes = symbols
      .map(symbol => quoteBySymbol.get(symbol))
      .filter((quote): quote is Quote => quote !== undefined);

    if (quotes.length === 0) {
      vscode.window.showInformationMessage('暂无股票数据，请先刷新或检查股票池');
      return;
    }

    const channel = this.getOutputChannel();
    const availableSymbols = new Set(quotes.map(quote => quote.symbol));
    const missingSymbols = symbols.filter(symbol => !availableSymbols.has(symbol));
    const lines = [formatDetailTable(quotes)];
    if (missingSymbols.length > 0) {
      lines.push('', `未获取到行情：${missingSymbols.map(stripPrefix).join('、')}`);
    }

    channel.clear();
    channel.appendLine(lines.join('\n'));
    channel.show(true);
  }

  dispose(): void {
    this.stopTimer();
    this.outputChannel?.dispose();
    this.outputChannel = undefined;
    this.statusBar.dispose();
  }
}
