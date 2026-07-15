/**
 * 统一行情提供器：A股平时用新浪，A股集合竞价用腾讯，港股用腾讯接口。
 * 这是免费 API 的实用组合。
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

    const useTencentForAStocks = this.isAStockOpeningAuction(new Date());
    const sinaAStocks = useTencentForAStocks
      ? []
      : symbols.filter(s => !s.toLowerCase().startsWith('hk'));
    const tencentAStocks = useTencentForAStocks
      ? symbols.filter(s => !s.toLowerCase().startsWith('hk'))
      : sinaAStocks;
    const hkStocks = symbols.filter(s => s.toLowerCase().startsWith('hk'));
    const tencentStocks = [...tencentAStocks, ...hkStocks];

    // 并行请求
    const tasks: Promise<Quote[]>[] = [];
    if (sinaAStocks.length > 0) tasks.push(this.sina.fetchQuotes(sinaAStocks));
    if (tencentStocks.length > 0) tasks.push(this.tencent.fetchQuotes(tencentStocks));

    const results = await Promise.all(tasks);

    // 合并到 Map
    const quoteMap = new Map<string, Quote>();
    const valuationMap = new Map<string, Pick<Quote, 'pe' | 'pb' | 'dividendYield'>>();
    for (const quotes of results) {
      for (const q of quotes) {
        if (q.symbol.toLowerCase().startsWith('hk')) {
          q.delayed = true;
        } else if (!useTencentForAStocks && (q.pe !== undefined || q.pb !== undefined || q.dividendYield !== undefined)) {
          valuationMap.set(q.symbol, {
            pe: q.pe,
            pb: q.pb,
            dividendYield: q.dividendYield,
          });
          const existing = quoteMap.get(q.symbol);
          if (existing) {
            quoteMap.set(q.symbol, this.mergeValuationMetrics(existing, q));
          }
          continue;
        }
        quoteMap.set(q.symbol, q);
      }
    }

    // 按原始顺序返回
    return symbols.map(s => {
      const quote = quoteMap.get(s);
      if (quote) {
        const valuation = valuationMap.get(s);
        return valuation ? { ...quote, ...valuation } : quote;
      }
      return {
        symbol: s,
        name: s,
        price: 0,
        change: 0,
        changePercent: 0,
        delayed: s.toLowerCase().startsWith('hk'),
      };
    });
  }

  private mergeValuationMetrics(base: Quote, valuation: Quote): Quote {
    return {
      ...base,
      pe: valuation.pe,
      pb: valuation.pb,
      dividendYield: valuation.dividendYield,
    };
  }

  private isAStockOpeningAuction(date: Date): boolean {
    const parts = this.getChinaTimeParts(date);
    const totalMinutes = parts.hour * 60 + parts.minute;
    return totalMinutes >= 9 * 60 + 15 && totalMinutes < 9 * 60 + 25;
  }

  private getChinaTimeParts(date: Date): { hour: number; minute: number } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return {
      hour: Number(parts.get('hour')),
      minute: Number(parts.get('minute')),
    };
  }
}
