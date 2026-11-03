/**
 * 统一行情提供器：A股平时用新浪，A股集合竞价用腾讯，港股与港股指数用腾讯接口。
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

    const isHK = (symbol: string): boolean => symbol.toLowerCase().startsWith('hk');
    const useTencentForAStocks = this.isAStockOpeningAuction(new Date());
    const chinaSymbols = symbols.filter(symbol => !isHK(symbol));
    const hkSymbols = symbols.filter(isHK);
    const sinaSymbols = useTencentForAStocks ? [] : chinaSymbols;
    const tencentSymbols = [...chinaSymbols, ...hkSymbols];

    // 并行请求
    const tasks: Promise<Quote[]>[] = [];
    if (sinaSymbols.length > 0) tasks.push(this.sina.fetchQuotes(sinaSymbols));
    if (tencentSymbols.length > 0) tasks.push(this.tencent.fetchQuotes(tencentSymbols));

    const batches = await Promise.all(tasks);

    // 合并到 Map：新浪负责 A 股盘中价格，腾讯补充市值、估值与基金净值。
    const quoteMap = new Map<string, Quote>();
    for (const quotes of batches) {
      for (const quote of quotes) {
        if (isHK(quote.symbol)) {
          quote.delayed = true;
          quoteMap.set(quote.symbol, quote);
          continue;
        }

        const existing = quoteMap.get(quote.symbol);
        if (!existing) {
          quoteMap.set(quote.symbol, quote);
          continue;
        }
        if (this.hasSupplementalMetrics(quote)) {
          quoteMap.set(quote.symbol, this.mergeSupplementalMetrics(existing, quote));
        }
      }
    }

    // 按原始顺序返回
    return symbols.map(s => {
      const quote = quoteMap.get(s);
      if (quote) return quote;
      return {
        symbol: s,
        name: s,
        price: 0,
        change: 0,
        changePercent: 0,
        delayed: isHK(s),
      };
    });
  }

  /** 判断行情是否携带可补充到主行情上的字段。 */
  private hasSupplementalMetrics(quote: Quote): boolean {
    return quote.turnover !== undefined
      || quote.marketCap !== undefined
      || quote.pe !== undefined
      || quote.pb !== undefined
      || quote.dividendYield !== undefined
      || quote.nav !== undefined
      || quote.isFund !== undefined
      || quote.isIndex !== undefined;
  }

  private mergeSupplementalMetrics(base: Quote, supplemental: Quote): Quote {
    return {
      ...base,
      turnover: base.turnover ?? supplemental.turnover,
      marketCap: supplemental.marketCap,
      pe: supplemental.pe,
      pb: supplemental.pb,
      dividendYield: supplemental.dividendYield,
      nav: supplemental.nav ?? base.nav,
      isFund: supplemental.isFund ?? base.isFund,
      isIndex: supplemental.isIndex ?? base.isIndex,
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
