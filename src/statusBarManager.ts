/**
 * StatusBarManager - 管理多只股票的状态栏显示
 * 每只股票对应一个独立的 StatusBarItem
 * 点击状态栏某个位置 → 弹出股票池选择 → 替换该位置的股票
 */

import * as vscode from 'vscode';
import { calculateAmplitude, Quote } from './providers/baseProvider';
import {
  stripPrefix,
  getMarketTag,
  getCurrencySymbol,
  toXueqiuUrl,
  formatPrice,
  formatMarketCap,
  formatAmount,
} from './utils/symbolParser';
import { PriceMovementAlert, PriceMovementTracker } from './priceMovementTracker';
import { formatFundNav } from './utils/fundInfo';

const DEFAULT_PRICE_ALERT_WINDOW_SECONDS = 120;

interface StatusBarManagerDependencies {
  now?: () => number;
  scheduleTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class StatusBarManager {
  private items: vscode.StatusBarItem[] = [];
  private lastQuotes: Map<string, Quote> = new Map();
  private displayList: string[] = [];
  private movementTracker = new PriceMovementTracker({
    thresholdPercent: 1,
    windowMs: DEFAULT_PRICE_ALERT_WINDOW_SECONDS * 1000,
  });
  private alertTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private activeAlerts = new Map<string, PriceMovementAlert>();
  private priceAlertEnabled = true;
  private priceAlertWindowSeconds = DEFAULT_PRICE_ALERT_WINDOW_SECONDS;
  private priceAlertColor = '#FFD700';
  private readonly now: () => number;
  private readonly scheduleTimeout: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly cancelTimeout: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(dependencies: StatusBarManagerDependencies = {}) {
    this.now = dependencies.now ?? Date.now;
    this.scheduleTimeout = dependencies.scheduleTimeout ?? setTimeout;
    this.cancelTimeout = dependencies.cancelTimeout ?? clearTimeout;
  }

  /** 从配置中读取颜色 */
  private getColors() {
    const cfg = vscode.workspace.getConfiguration('estock');
    return {
      up:     cfg.get<string>('colorUp',     '#FAAFA0'),
      down:   cfg.get<string>('colorDown',   '#4EC9B0'),
      flat:   cfg.get<string>('colorFlat',   '#CCCCCC'),
      closed: cfg.get<string>('colorClosed', '#AAAAAA'),
    };
  }

  /** 从配置中读取对齐方式和优先级 */
  private getAlignmentConfig(): { alignment: vscode.StatusBarAlignment; basePriority: number } {
    const cfg = vscode.workspace.getConfiguration('estock');
    const align = cfg.get<string>('statusBarAlignment', 'center');
    if (align === 'right') {
      return { alignment: vscode.StatusBarAlignment.Right, basePriority: 100 };
    }
    if (align === 'left') {
      return { alignment: vscode.StatusBarAlignment.Left, basePriority: 100 };
    }
    // center: 用 Left 对齐 + 极低优先级，让 item 被推到左侧组的最右端（视觉上接近中间）
    return { alignment: vscode.StatusBarAlignment.Left, basePriority: 0 };
  }

  /** 根据 displayList 重新创建所有 StatusBarItem */
  reload(displayList: string[]): void {
    this.dispose();
    this.displayList = displayList;
    const { alignment, basePriority } = this.getAlignmentConfig();
    const colors = this.getColors();
    const cfg = vscode.workspace.getConfiguration('estock');
    this.priceAlertEnabled = cfg.get<boolean>('priceAlertEnabled', true);
    this.priceAlertColor = cfg.get<string>('priceAlertColor', '#FFD700');
    const configuredWindowSeconds = cfg.get<number>(
      'priceAlertWindowSeconds',
      DEFAULT_PRICE_ALERT_WINDOW_SECONDS,
    );
    this.priceAlertWindowSeconds = Number.isFinite(configuredWindowSeconds)
      && Number.isInteger(configuredWindowSeconds)
      && configuredWindowSeconds >= 1
      ? configuredWindowSeconds
      : DEFAULT_PRICE_ALERT_WINDOW_SECONDS;
    const configuredThreshold = cfg.get<number>('priceAlertThresholdPercent', 1);
    const thresholdPercent = Number.isFinite(configuredThreshold)
      ? Math.max(configuredThreshold, 0.1)
      : 1;
    this.movementTracker = new PriceMovementTracker({
      thresholdPercent,
      windowMs: this.priceAlertWindowSeconds * 1000,
    });

    displayList.forEach((symbol, index) => {
      const item = vscode.window.createStatusBarItem(
        alignment,
        basePriority - index,
      );
      // 用命令+参数形式，点击时带上位置索引
      item.command = {
        title: '切换股票',
        command: 'estock.switchStock',
        arguments: [index],
      };
      item.text = `${stripPrefix(symbol)} ...`;
      item.color = colors.flat;
      item.tooltip = this.buildLinkedTooltip(symbol, [`${stripPrefix(symbol)} - 点击切换股票`]);
      item.show();
      this.items.push(item);
    });
  }

  /** 用最新行情更新状态栏（盘中调用） */
  updateQuotes(quotes: Quote[]): void {
    const colors = this.getColors();
    const now = this.now();
    // 先把所有 quotes 存入缓存
    for (const q of quotes) {
      this.lastQuotes.set(q.symbol, q);
    }
    // 然后按 displayList 顺序更新状态栏
    this.displayList.forEach((symbol, i) => {
      if (i >= this.items.length) return;
      const quote = this.lastQuotes.get(symbol);
      if (!quote) return;
      const item = this.items[i];
      item.text = this.formatText(quote, false);
      item.color = this.getColor(quote, colors);
      item.tooltip = this.buildTooltip(quote);
      if (this.priceAlertEnabled) {
        const alert = this.movementTracker.record(symbol, quote.price, now);
        if (alert) {
          this.showMovementAlert(i, quote, alert);
        } else {
          const activeAlert = this.activeAlerts.get(symbol);
          if (activeAlert) this.renderMovementAlert(item, quote, activeAlert);
        }
      }
    });
  }

  /** 收盘后调用：保留收盘价，使用休市颜色，显示"休市"。 */
  showMarketClosed(symbols?: string[]): void {
    const closedSymbols = symbols ? new Set(symbols) : undefined;
    const colors = this.getColors();
    this.items.forEach((item, i) => {
      if (i >= this.displayList.length) return;
      const symbol = this.displayList[i];
      if (closedSymbols && !closedSymbols.has(symbol)) return;
      this.clearMovementAlert(symbol, true);
      const quote = this.lastQuotes.get(symbol);
      if (quote) {
        item.text = this.formatText(quote, true);
        item.color = colors.closed;
        item.tooltip = this.buildTooltip(quote, true);
      } else {
        item.text = `${stripPrefix(symbol)} 休市`;
        item.color = colors.closed;
        item.tooltip = this.buildLinkedTooltip(symbol, ['当前休市']);
      }
    });
  }

  /** 格式化股票名称：港股加(H)标识，A股加(A)标识 */
  private formatName(quote: Quote): string {
    const tag = getMarketTag(quote.symbol);
    return tag ? `${quote.name}(${tag})` : quote.name;
  }

  /** 格式化状态栏文字 */
  private formatText(quote: Quote, isClosed: boolean): string {
    const cfg = vscode.workspace.getConfiguration('estock');
    const format = cfg.get<string>('displayFormat', '${name} ${changePercent} (${currency}${price})');

    const percentChangeStr = quote.changePercent >= 0
      ? `+${quote.changePercent.toFixed(2)}%`
      : `${quote.changePercent.toFixed(2)}%`;

    const priceStr = quote.price > 0 ? formatPrice(quote.symbol, quote.price) : '---';
    const changeStr = formatPrice(quote.symbol, quote.change);
    // 指数以点数报价，不带货币符号。
    const currencyStr = quote.isIndex ? '' : getCurrencySymbol(quote.symbol);

    let text = format
      .replace(/\$\{name\}/g, this.formatName(quote))
      .replace(/\$\{price\}/g, priceStr)
      .replace(/\$\{change\}/g, quote.change >= 0 ? `+${changeStr}` : changeStr)
      .replace(/\$\{changePercent\}/g, percentChangeStr)
      .replace(/\$\{currency\}/g, currencyStr)
      .replace(/\$\{volume\}/g, quote.volume ? String(quote.volume) : '---');

    if (isClosed) {
      text += ' 休市';
    }

    return text;
  }

  /** 根据涨跌返回颜色 */
  private getColor(quote: Quote, colors: { up: string; down: string; flat: string }): string {
    if (quote.changePercent > 0) return colors.up;
    if (quote.changePercent < 0) return colors.down;
    return colors.flat;
  }

  /** 构建 hover tooltip 详情 */
  private buildTooltip(quote: Quote, isClosed = false): vscode.MarkdownString {
    const price = (value: number): string => formatPrice(quote.symbol, value);
    const lines: string[] = [
      `${this.formatName(quote)} (${stripPrefix(quote.symbol)})`,
      `当前价：${price(quote.price)}`,
      `涨跌：${quote.change >= 0 ? '+' : ''}${price(quote.change)}  (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`,
    ];

    if (quote.open !== undefined) lines.push(`今开：${price(quote.open)}`);
    if (quote.high !== undefined) lines.push(`最高：${price(quote.high)}`);
    if (quote.low !== undefined)  lines.push(`最低：${price(quote.low)}`);
    const amplitude = calculateAmplitude(quote);
    if (amplitude !== undefined) lines.push(`振幅：${amplitude.toFixed(2)}%`);
    const fundNav = formatFundNav(quote);
    if (fundNav !== undefined) lines.push(`基金净值：${fundNav}`);
    lines.push(`总市值：${formatMarketCap(quote.symbol, quote.marketCap)}`);
    if (quote.pe !== undefined) lines.push(`PE(TTM)：${quote.pe.toFixed(2)}`);
    if (quote.pb !== undefined) lines.push(`PB：${quote.pb.toFixed(2)}`);
    if (quote.dividendYield !== undefined) lines.push(`股息率：${quote.dividendYield.toFixed(2)}%`);
    if (quote.volume !== undefined) lines.push(`成交量：${quote.volume.toLocaleString()}`);
    lines.push(`成交额：${formatAmount(quote.symbol, quote.turnover)}`);
    if (quote.time) {
      const delayTag = quote.delayed ? ' (延迟约15分钟)' : '';
      lines.push(`更新时间：${quote.time}${delayTag}`);
    }
    if (isClosed) {
      lines.push('当前休市');
    }

    return this.buildLinkedTooltip(quote.symbol, lines);
  }

  /** 构建带雪球入口的悬浮提示。 */
  private buildLinkedTooltip(symbol: string, lines: string[]): vscode.MarkdownString {
    const tooltip = new vscode.MarkdownString();
    for (const line of lines) {
      tooltip.appendText(line);
      tooltip.appendMarkdown('  \n');
    }
    tooltip.appendMarkdown(`[雪球详情](${toXueqiuUrl(symbol)})`);
    return tooltip;
  }

  /** 获取某只股票的最新缓存行情 */
  getLastQuote(symbol: string): Quote | undefined {
    return this.lastQuotes.get(symbol);
  }

  /** 获取所有缓存的 quotes（按 displayList 顺序） */
  getAllLastQuotes(): Quote[] {
    return this.displayList
      .map(s => this.lastQuotes.get(s))
      .filter((q): q is Quote => q !== undefined);
  }

  /** 获取当前 displayList */
  getDisplayList(): string[] {
    return [...this.displayList];
  }

  dispose(): void {
    for (const timer of this.alertTimers.values()) {
      this.cancelTimeout(timer);
    }
    this.alertTimers.clear();
    this.activeAlerts.clear();
    this.movementTracker.clear();
    this.items.forEach(item => item.dispose());
    this.items = [];
  }

  /** 显示或延续某只股票的短时异动提醒。 */
  private showMovementAlert(index: number, quote: Quote, alert: PriceMovementAlert): void {
    const item = this.items[index];
    if (!item) return;

    this.activeAlerts.set(quote.symbol, alert);
    this.renderMovementAlert(item, quote, alert);

    const existingTimer = this.alertTimers.get(quote.symbol);
    if (existingTimer !== undefined) {
      this.cancelTimeout(existingTimer);
    }
    const timer = this.scheduleTimeout(() => {
      if (this.alertTimers.get(quote.symbol) !== timer) return;
      this.hideMovementAlert(quote.symbol);
      this.alertTimers.delete(quote.symbol);
    }, 30_000);
    this.alertTimers.set(quote.symbol, timer);
  }

  /** 隐藏提醒，并按需清理对应股票的价格历史。 */
  private clearMovementAlert(symbol: string, clearHistory: boolean): void {
    const timer = this.alertTimers.get(symbol);
    if (timer !== undefined) {
      this.cancelTimeout(timer);
      this.alertTimers.delete(symbol);
    }
    this.hideMovementAlert(symbol);
    if (clearHistory) {
      this.movementTracker.clear(symbol);
    }
  }

  private hideMovementAlert(symbol: string): void {
    if (!this.activeAlerts.delete(symbol)) return;
    const colors = this.getColors();
    this.displayList.forEach((displaySymbol, index) => {
      if (displaySymbol !== symbol) return;
      const item = this.items[index];
      const quote = this.lastQuotes.get(symbol);
      if (!item || !quote) return;
      item.text = this.formatText(quote, false);
      item.color = this.getColor(quote, colors);
      item.tooltip = this.buildTooltip(quote);
    });
  }

  /** 在股票自身的状态栏项中展示异动信息。 */
  private renderMovementAlert(item: vscode.StatusBarItem, quote: Quote, alert: PriceMovementAlert): void {
    const icon = alert.direction === 'up' ? '🚀' : '💥';
    const sign = alert.direction === 'up' ? '+' : '-';
    const signedPercent = `${sign}${alert.percent.toFixed(2)}%`;
    item.text = `${this.formatText(quote, false)}｜${icon}`;
    item.color = this.priceAlertColor;
    const tooltip = this.buildTooltip(quote);
    tooltip.appendMarkdown('  \n');
    tooltip.appendText(`异动提醒：${this.priceAlertWindowSeconds}秒内股价波动 ${signedPercent}。`);
    item.tooltip = tooltip;
  }
}
