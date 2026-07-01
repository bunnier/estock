/**
 * 智能数据源：A股用新浪（准实时），港股用腾讯（延迟15分钟，比新浪的22分钟好）
 * 这是免费 API 的最佳组合
 */

import { DataProvider, Quote } from './baseProvider';
import { SinaProvider } from './sinaProvider';
import { TencentProvider } from './tencentProvider';

export class SmartProvider extends DataProvider {
  readonly name = 'smart';
  private sina: SinaProvider;
  private tencent: TencentProvider;

  constructor() {
    super();
    this.sina = new SinaProvider();
    this.tencent = new TencentProvider();
  }

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    // A股和港股分组
    const aStocks = symbols.filter(s => !s.toLowerCase().startsWith('hk'));
    const hkStocks = symbols.filter(s => s.toLowerCase().startsWith('hk'));

    // 并行请求
    const tasks: Promise<Quote[]>[] = [];
    if (aStocks.length > 0) tasks.push(this.sina.fetchQuotes(aStocks));
    if (hkStocks.length > 0) tasks.push(this.tencent.fetchQuotes(hkStocks));

    const results = await Promise.all(tasks);

    // 合并到 Map
    const quoteMap = new Map<string, Quote>();
    for (const quotes of results) {
      for (const q of quotes) {
        // 港股标记延迟
        if (q.symbol.toLowerCase().startsWith('hk')) {
          q.delayed = true;
        }
        quoteMap.set(q.symbol, q);
      }
    }

    // 按原始顺序返回
    return symbols.map(s => quoteMap.get(s) || {
      symbol: s,
      name: s,
      price: 0,
      change: 0,
      changePercent: 0,
      delayed: s.toLowerCase().startsWith('hk'),
    });
  }
}
