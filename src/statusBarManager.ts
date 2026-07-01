/**
 * StatusBarManager - 管理多只股票的状态栏显示
 * 每只股票对应一个独立的 StatusBarItem
 * 点击状态栏某个位置 → 弹出股票池选择 → 替换该位置的股票
 */

import * as vscode from 'vscode';
import { Quote } from './providers/baseProvider';
import { stripPrefix, getMarketTag } from './utils/symbolParser';

export class StatusBarManager {
  private items: vscode.StatusBarItem[] = [];
  private lastQuotes: Map<string, Quote> = new Map();
  private displayList: string[] = [];

  /** 从配置中读取颜色 */
  private getColors() {
    const cfg = vscode.workspace.getConfiguration('estock');
    return {
      up:     cfg.get<string>('colorUp',     '#FAAFA0'),
      down:   cfg.get<string>('colorDown',   '#4EC9B0'),
      flat:   cfg.get<string>('colorFlat',   '#CCCCCC'),
      closed: cfg.get<string>('colorClosed', '#AAAAAA'),  // 休市占位色（无数据时）
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
      item.tooltip = `${stripPrefix(symbol)} - 点击切换股票`;
      item.show();
      this.items.push(item);
    });
  }

  /** 用最新行情更新状态栏（盘中调用） */
  updateQuotes(quotes: Quote[]): void {
    const colors = this.getColors();
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
    });
  }

  /** 收盘后调用：保留收盘价及涨跌颜色，显示"休市"。 */
  showMarketClosed(symbols?: string[]): void {
    const closedSymbols = symbols ? new Set(symbols) : undefined;
    const colors = this.getColors();
    this.items.forEach((item, i) => {
      if (i >= this.displayList.length) return;
      const symbol = this.displayList[i];
      if (closedSymbols && !closedSymbols.has(symbol)) return;
      const quote = this.lastQuotes.get(symbol);
      if (quote) {
        // 有行情：保留涨跌颜色，仅追加“休市”文字。
        item.text = this.formatText(quote, true);
        item.color = this.getColor(quote, colors);
        item.tooltip = this.buildTooltip(quote) + '\n\n当前休市';
      } else {
        // 无行情：用休市色占位。
        item.text = `${stripPrefix(symbol)} 休市`;
        item.color = colors.closed;
        item.tooltip = '当前休市';
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
    const format = cfg.get<string>('displayFormat', '${name} ${changePercent} ${price}');

    const changeStr = quote.changePercent >= 0
      ? `+${quote.changePercent.toFixed(2)}%`
      : `${quote.changePercent.toFixed(2)}%`;

    const priceStr = quote.price > 0 ? quote.price.toFixed(2) : '---';

    let text = format
      .replace(/\$\{name\}/g, this.formatName(quote))
      .replace(/\$\{price\}/g, priceStr)
      .replace(/\$\{change\}/g, quote.change >= 0 ? `+${quote.change.toFixed(2)}` : `${quote.change.toFixed(2)}`)
      .replace(/\$\{changePercent\}/g, changeStr)
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
  private buildTooltip(quote: Quote): string {
    const lines: string[] = [
      `${this.formatName(quote)} (${stripPrefix(quote.symbol)})`,
      '',
      `当前价：${quote.price.toFixed(2)}`,
      `涨跌：${quote.change >= 0 ? '+' : ''}${quote.change.toFixed(2)}  (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`,
    ];

    if (quote.open !== undefined) lines.push(`今开：${quote.open.toFixed(2)}`);
    if (quote.high !== undefined) lines.push(`最高：${quote.high.toFixed(2)}`);
    if (quote.low !== undefined)  lines.push(`最低：${quote.low.toFixed(2)}`);

    const cfg = vscode.workspace.getConfiguration('estock');
    if (cfg.get<boolean>('showVolume', false) && quote.volume !== undefined) {
      lines.push(`成交量：${quote.volume}`);
    }
    if (quote.time) {
      const delayTag = quote.delayed ? ' (延迟约15分钟)' : '';
      lines.push(`更新：${quote.time}${delayTag}`);
    }

    return lines.join('\n');
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
    this.items.forEach(item => item.dispose());
    this.items = [];
  }
}
