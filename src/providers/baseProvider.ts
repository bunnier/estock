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
  turnover?: number;    // 成交额
  time?: string;       // 更新时间
  delayed?: boolean;    // 是否延迟数据（港股免费 API 有延迟）
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
