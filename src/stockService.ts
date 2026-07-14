/**
 * StockService - 核心调度逻辑
 * 管理股票池、展示列表、刷新定时器、开盘判断、切换股票
 *
 * watchList  → 股票池（所有关注的股票）
 * displayList → 状态栏展示的股票（watchList 的子集，可排序）
 */

import * as vscode from 'vscode';
import { DataProvider, Quote } from './providers/baseProvider';
import { SmartProvider } from './providers/smartProvider';
import { SinaStockSearchProvider, StockSearchResult } from './providers/stockSearchProvider';
import { StatusBarManager } from './statusBarManager';
import { normalizeSymbols, stripPrefix, getMarketTag } from './utils/symbolParser';
import { HolidayCalendar } from './utils/holidayCalendar';
import { getMarketStatusForSymbol } from './utils/marketTime';

interface StockSearchProvider {
  search(keyword: string): Promise<StockSearchResult[]>;
}

export class StockService {
  private provider!: DataProvider;
  private statusBar!: StatusBarManager;
  private timer?: NodeJS.Timeout;
  private ctx!: vscode.ExtensionContext;
  private isRefreshing = false;
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
    const pool = this.watchList;
    // 过滤掉不在 watchList 中的
    const valid = normalized.filter(s => pool.includes(s));
    // 如果 displayList 为空或无效，默认取 watchList 前 maxDisplay 个
    if (valid.length === 0) {
      const maxDisplay = vscode.workspace.getConfiguration('estock')
        .get<number>('maxDisplay', 8);
      return pool.slice(0, maxDisplay);
    }
    return valid;
  }

  /** 需要请求行情的所有股票（watchList 全量，保证缓存完整） */
  private get allSymbols(): string[] {
    return this.watchList;
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

  private async refreshSymbols(symbols: string[]): Promise<void> {
    if (this.isRefreshing || symbols.length === 0) return;

    this.isRefreshing = true;
    try {
      const quotes = await this.provider.fetchQuotes(symbols);
      this.statusBar.updateQuotes(quotes);
    } catch (e) {
      console.warn('[estock] refreshOnce failed', e);
    } finally {
      this.isRefreshing = false;
    }
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

    if (/^\d{5,6}$/.test(keyword) || /^(sh|sz|hk)\d+$/i.test(keyword)) {
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
        label: `${result.name}(${result.market})`,
        description: result.code,
        detail: result.market === 'A' ? 'A股' : '港股',
        symbol: result.symbol,
        code: result.code,
      })),
      { placeHolder: `选择要添加的股票：${keyword}` }
    );

    if (!pick) return;
    await this.addStock(pick.symbol);
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
        currentDisplay.map((symbol, index) => ({
          label: `${index + 1}. ${stripPrefix(symbol)}`,
          description: this.statusBar.getLastQuote(symbol)?.name,
          position: index,
        })),
        { placeHolder: '选择要切换的状态栏位置' }
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
        const tag = getMarketTag(s);
        const nameWithTag = quote ? `${quote.name}(${tag})` : `${stripPrefix(s)}(${tag})`;
        return {
          label: `${isCurrent ? '● ' : '  '}${stripPrefix(s)}`,
          description: quote ? `${nameWithTag}  ${quote.price.toFixed(2)}  ${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%` : nameWithTag,
          symbol: s,
        };
      }),
      {
        placeHolder: `选择要展示在位置 ${position + 1} 的股票${currentSymbol ? `（当前: ${stripPrefix(currentSymbol)}）` : ''}`,
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
    const quotes = this.statusBar.getAllLastQuotes();

    if (quotes.length === 0) {
      vscode.window.showInformationMessage('暂无股票数据，请先添加关注股票');
      return;
    }

    const pick = await vscode.window.showQuickPick(
      quotes.map(q => {
        const tag = getMarketTag(q.symbol);
        return {
          label: `${q.name}(${tag}) (${stripPrefix(q.symbol)})`,
          description: `${q.price.toFixed(2)}  ${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`,
          symbol: q.symbol,
        };
      }),
      { placeHolder: '选择要查看详情的股票' }
    );
    if (!pick) return;

    const quote = quotes.find(q => q.symbol === pick.symbol);
    if (!quote) return;

    const tag = getMarketTag(quote.symbol);
    const channel = vscode.window.createOutputChannel('码盯·禄得金');
    const lines: string[] = [
      `╔══════════════════════════════════════╗`,
      `║  ${quote.name}(${tag}) (${stripPrefix(quote.symbol)})`,
      `╠══════════════════════════════════════╣`,
      ``,
      `  当前价：  ${quote.price.toFixed(2)}`,
      `  涨跌：    ${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}  (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`,
    ];
    if (quote.open !== undefined)  lines.push(`  今开：    ${quote.open.toFixed(2)}`);
    if (quote.high !== undefined)  lines.push(`  最高：    ${quote.high.toFixed(2)}`);
    if (quote.low !== undefined)   lines.push(`  最低：    ${quote.low.toFixed(2)}`);
    if (quote.volume !== undefined) lines.push(`  成交量：  ${quote.volume.toLocaleString()}`);
    if (quote.time)                 lines.push(`  更新时间：${quote.time}`);
    lines.push(``, `╚══════════════════════════════════════╝`);

    channel.clear();
    channel.appendLine(lines.join('\n'));
    channel.show(true);
  }

  dispose(): void {
    this.stopTimer();
    this.statusBar.dispose();
  }
}
