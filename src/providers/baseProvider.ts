/**
 * DataProvider 抽象接口。
 * 内部行情接口必须实现 fetchQuotes 方法。
 */

export interface Quote {
  symbol: string;       // 标准化代码，如 "sh600519"、"hk00700"
  name: string;         // 股票名称
  price: number;        // 当前价
  change: number;       // 涨跌额
  changePercent: number;// 涨跌幅(%)
  previousClose?: number;// 昨收。
  open?: number;       // 今开
  high?: number;       // 最高
  low?: number;        // 最低
  volume?: number;      // 成交量（手/股）
  turnover?: number;    // 成交额，以交易货币的元为单位。
  marketCap?: number;   // 总市值，以交易货币的元为单位，A 股为人民币，港股为港元。
  pe?: number;          // 滚动市盈率，基于最近四个季度（TTM）。
  pb?: number;          // 市净率。
  dividendYield?: number;// 股息率（%）。
  nav?: number;         // 基金净值：ETF 取盘中参考净值（IOPV），缺失时取最新单位净值。
  isFund?: boolean;     // 是否为基金（ETF/LOF）。
  isIndex?: boolean;    // 是否为指数。
  time?: string;       // 更新时间
  delayed?: boolean;    // 是否延迟数据（港股免费 API 有延迟）
}

/** 计算当前价相对基金净值的溢价率（%）。 */
export function calculatePremiumRate(quote: Pick<Quote, 'price' | 'nav'>): number | undefined {
  if (quote.nav === undefined || !Number.isFinite(quote.nav) || quote.nav <= 0) return undefined;
  if (!Number.isFinite(quote.price) || quote.price <= 0) return undefined;
  return ((quote.price - quote.nav) / quote.nav) * 100;
}

/** 计算当日振幅。 */
export function calculateAmplitude(quote: Pick<Quote, 'high' | 'low' | 'previousClose'>): number | undefined {
  if (quote.high === undefined || quote.low === undefined || quote.previousClose === undefined || quote.previousClose <= 0) {
    return undefined;
  }
  return ((quote.high - quote.low) / quote.previousClose) * 100;
}

export abstract class DataProvider {
  abstract readonly name: string;

  /**
   * 批量获取股票行情
   * @param symbols 标准化后的股票代码数组
   * @returns Quote 数组（顺序与输入一致）
   */
  abstract fetchQuotes(symbols: string[]): Promise<Quote[]>;
}
