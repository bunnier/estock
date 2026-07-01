/**
 * StockService - 核心调度逻辑
 * 管理股票池、展示列表、刷新定时器、开盘判断、切换股票
 *
 * watchList  → 股票池（所有关注的股票）
 * displayList → 状态栏展示的股票（watchList 的子集，可排序）
 */

import * as vscode from 'vscode';
import { DataProvider, Quote } from './providers/baseProvider';
import { SinaProvider } from './providers/sinaProvider';
import { TencentProvider } from './providers/tencentProvider';
import { SmartProvider } from './providers/smartProvider';
import { StatusBarManager } from './statusBarManager';
import { normalizeSymbols, stripPrefix, getMarketTag } from './utils/symbolParser';
import { HolidayCalendar } from './utils/holidayCalendar';
import { isMarketOpenForSymbol } from './utils/marketTime';

export class StockService {
  private provider!: DataProvider;
  private statusBar!: StatusBarManager;
  private timer?: NodeJS.Timeout;
  private ctx!: vscode.ExtensionContext;
  private isRefreshing = false;
  private holidayCalendar = new HolidayCalendar();

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

  /** 当前数据源 */
  private get dataSourceName(): string {
    return vscode.workspace.getConfiguration('estock')
      .get<string>('dataSource', 'smart');
  }

  activate(ctx: vscode.ExtensionContext, statusBar: StatusBarManager): void {
    this.ctx = ctx;
    this.statusBar = statusBar;
    this.switchProvider();

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

  private switchProvider(): void {
    const name = this.dataSourceName;
    if (name === 'tencent') {
      this.provider = new TencentProvider();
    } else if (name === 'sina') {
      this.provider = new SinaProvider();
    } else {
      // smart: A股用新浪，港股用腾讯
      this.provider = new SmartProvider();
    }
    console.log(`[estock] using provider: ${this.provider.name}`);
  }

  private onConfigChanged(): void {
    this.switchProvider();
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
    await this.refreshSymbols(this.allSymbols);
  }

  private async refreshMarketAware(): Promise<void> {
    const symbols = this.allSymbols;
    if (symbols.length === 0) return;

    const openSymbols: string[] = [];
    const closedSymbols: string[] = [];
    const now = new Date();
    for (const symbol of symbols) {
      if (await isMarketOpenForSymbol(symbol, now, this.holidayCalendar)) {
        openSymbols.push(symbol);
      } else {
        closedSymbols.push(symbol);
      }
    }

    if (openSymbols.length > 0) {
      await this.refreshSymbols(openSymbols);
    }
    if (closedSymbols.length > 0) {
      this.statusBar.showMarketClosed(closedSymbols);
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

    const newList = [...(raw || []), symbol.trim()];
    await vscode.workspace.getConfiguration('estock')
      .update('watchList', newList, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`已添加 ${stripPrefix(normalized)} 到股票池`);
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
      // 存原始代码（未标准化），用原始格式
      const rawPool = cfg.get<string[]>('watchList', []) || [];
      const rawSymbol = rawPool.find(s => normalizeSymbols([s])[0] === pick.symbol) || stripPrefix(pick.symbol);
      newDisplay[position] = rawSymbol;
    } else {
      // 追加到末尾
      const rawPool = cfg.get<string[]>('watchList', []) || [];
      const rawSymbol = rawPool.find(s => normalizeSymbols([s])[0] === pick.symbol) || stripPrefix(pick.symbol);
      newDisplay = [...(rawDisplay || []), rawSymbol];
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
    const channel = vscode.window.createOutputChannel('码盯');
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
