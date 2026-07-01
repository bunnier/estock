/**
 * 腾讯财经数据 Provider
 * A股 + 港股免费接口，无需 API Key
 * API: https://qt.gtimg.cn/q=sh600519,hk00700
 * 返回编码：GBK
 *
 * 返回格式（~分隔，A股/港股字段索引一致）：
 *   v_sh600519="1~贵州茅台~600519~当前~昨收~今开~成交量~外盘~内盘~买一价~...";
 *
 * 统一字段索引:
 *   0:市场代码 1:名称 2:代码 3:当前价 4:昨收 5:今开
 *   6:成交量 7:外盘 8:内盘
 *   30:时间 31:涨跌额 32:涨跌幅% 33:最高 34:最低
 */

import { DataProvider, Quote } from './baseProvider';
import { httpGet } from './httpClient';

export class TencentProvider extends DataProvider {
  readonly name = 'tencent';

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    const url = `https://qt.gtimg.cn/q=${symbols.join(',')}`;
    const results: Quote[] = [];

    try {
      const text = await httpGet(url, {
        'Referer': 'https://gu.qq.com',
      });

      const lines = text.trim().split('\n');

      for (let i = 0; i < symbols.length; i++) {
        const line = lines[i] || '';
        const quote = this.parseLine(symbols[i], line);
        results.push(quote);
      }
    } catch (e) {
      console.warn('[estock:tencent] fetchQuotes failed', e);
      return symbols.map(s => this.emptyQuote(s));
    }

    return results;
  }

  private parseLine(symbol: string, line: string): Quote {
    // 格式: v_sh600519="1~贵州茅台~600519~1685.00~...";
    const m = line.match(/="([^"]*)"/);
    if (!m) return this.emptyQuote(symbol);

    const fields = m[1].split('~');
    if (fields.length < 10) return this.emptyQuote(symbol);

    const name = fields[1] || symbol;
    const current = parseFloat(fields[3]) || 0;
    const yesterday = parseFloat(fields[4]) || current;
    const open = parseFloat(fields[5]) || 0;
    const volume = parseInt(fields[6]) || 0;

    // 腾讯接口直接提供涨跌额(31)和涨跌幅(32)
    // 但部分版本可能没有，用 current - yesterday 兜底
    const change = fields.length > 31
      ? parseFloat(fields[31]) || +(current - yesterday).toFixed(4)
      : +(current - yesterday).toFixed(4);
    const changePercent = fields.length > 32
      ? parseFloat(fields[32]) || (yesterday !== 0 ? +((change / yesterday) * 100).toFixed(2) : 0)
      : (yesterday !== 0 ? +((change / yesterday) * 100).toFixed(2) : 0);

    const high = fields.length > 33 ? parseFloat(fields[33]) || 0 : 0;
    const low = fields.length > 34 ? parseFloat(fields[34]) || 0 : 0;
    const time = fields.length > 30 ? fields[30] : '';

    return {
      symbol, name, price: current, change, changePercent,
      open: open || undefined,
      high: high || undefined,
      low: low || undefined,
      volume: volume || undefined,
      time: time || undefined,
    };
  }

  private emptyQuote(symbol: string): Quote {
    return {
      symbol,
      name: symbol,
      price: 0,
      change: 0,
      changePercent: 0,
    };
  }
}
