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

    const querySymbols = symbols.map(symbol => this.toQuerySymbol(symbol));
    const url = `https://qt.gtimg.cn/q=${querySymbols.join(',')}`;
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
    const rawCurrent = parseFloat(fields[3]) || 0;
    const rawYesterday = parseFloat(fields[4]) || rawCurrent;
    const open = parseFloat(fields[5]) || 0;
    const volume = parseInt(fields[6]) || 0;
    const time = fields.length > 30 ? fields[30] : '';
    const heldHKPreOpenPrice = this.getHeldHKPreOpenPrice(symbol, rawCurrent, rawYesterday);
    const current = heldHKPreOpenPrice !== undefined
      ? heldHKPreOpenPrice
      : rawCurrent;
    const yesterday = heldHKPreOpenPrice !== undefined
      ? current
      : rawYesterday;

    const canCalculateChange = current > 0 && yesterday > 0;
    const fallbackChange = fields.length > 31 ? parseFloat(fields[31]) || 0 : 0;
    const change = canCalculateChange
      ? +(current - yesterday).toFixed(4)
      : fallbackChange;
    const fallbackChangePercent = fields.length > 32 ? parseFloat(fields[32]) || 0 : 0;
    const changePercent = canCalculateChange
      ? +((change / yesterday) * 100).toFixed(2)
      : fallbackChangePercent;

    const high = fields.length > 33 ? parseFloat(fields[33]) || 0 : 0;
    const low = fields.length > 34 ? parseFloat(fields[34]) || 0 : 0;
    const valuation = this.parseValuationMetrics(symbol, fields);

    return {
      symbol, name, price: current, change, changePercent,
      previousClose: rawYesterday || undefined,
      open: open || undefined,
      high: high || undefined,
      low: low || undefined,
      volume: volume || undefined,
      pe: valuation.pe,
      pb: valuation.pb,
      dividendYield: valuation.dividendYield,
      time: time || undefined,
    };
  }

  private toQuerySymbol(symbol: string): string {
    return symbol.toLowerCase().startsWith('hk') ? `r_${symbol}` : symbol;
  }

  private getHeldHKPreOpenPrice(symbol: string, rawCurrent: number, rawYesterday: number): number | undefined {
    if (!symbol.toLowerCase().startsWith('hk')) return undefined;
    const preOpenStage = this.getHongKongPreOpenStage(new Date());
    if (preOpenStage === 'early') return rawCurrent || rawYesterday;
    return undefined;
  }

  private getHongKongPreOpenStage(date: Date): 'early' | 'late' | undefined {
    const parts = this.getHongKongTimeParts(date);
    const totalMinutes = parts.hour * 60 + parts.minute;
    if (totalMinutes >= 9 * 60 && totalMinutes < 9 * 60 + 15) return 'early';
    return undefined;
  }

  private getHongKongTimeParts(date: Date): { hour: number; minute: number } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Hong_Kong',
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

  private parseValuationMetrics(symbol: string, fields: string[]): { pe?: number; pb?: number; dividendYield?: number } {
    const isHK = symbol.toLowerCase().startsWith('hk');
    return {
      pe: this.parseOptionalNumber(fields[isHK ? 57 : 39]),
      pb: this.parseOptionalNumber(fields[isHK ? 58 : 46]),
      dividendYield: this.parseOptionalNumber(fields[isHK ? 47 : 64]),
    };
  }

  private parseOptionalNumber(value: string | undefined): number | undefined {
    if (value === undefined || value.trim() === '') return undefined;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
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
