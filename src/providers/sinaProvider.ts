/**
 * 新浪财经数据 Provider
 * A股 + 港股免费接口，无需 API Key
 * API: https://hq.sinajs.cn/list=sh600519,hk00700
 * 返回编码：GBK
 *
 * A股返回格式（逗号分隔，32+ 字段）：
 *   var hq_str_sh600519="贵州茅台,今开,昨收,当前,最高,最低,买一,卖一,成交量,成交额,...,日期,时间,...";
 *
 * 港股返回格式（逗号分隔，字段不同）：
 *   var hq_str_hk00700="TENCENT,腾讯控股,今开,昨收,最高,最低,当前,涨跌额,涨跌幅%,买一,卖一,成交量,...,日期,时间";
 */

import { DataProvider, Quote } from './baseProvider';
import { httpGet } from './httpClient';

export class SinaProvider extends DataProvider {
  readonly name = 'sina';

  async fetchQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];

    const url = `https://hq.sinajs.cn/list=${symbols.join(',')}`;
    const results: Quote[] = [];

    try {
      const text = await httpGet(url, {
        'Referer': 'https://finance.sina.com.cn',
      });

      const lines = text.trim().split('\n');

      for (let i = 0; i < symbols.length; i++) {
        const line = lines[i] || '';
        const symbol = symbols[i];
        const quote = symbol.toLowerCase().startsWith('hk')
          ? this.parseHKLine(symbol, line)
          : this.parseAStockLine(symbol, line);
        results.push(quote);
      }
    } catch (e) {
      console.warn('[estock:sina] fetchQuotes failed', e);
      return symbols.map(s => this.emptyQuote(s));
    }

    return results;
  }

  /**
   * 解析 A股行情（沪深）
   * 字段索引:
   *   0:名称 1:今开 2:昨收 3:当前 4:最高 5:最低
   *   6:买一价 7:卖一价 8:成交量(手) 9:成交额
   *   30:日期 31:时间
   */
  private parseAStockLine(symbol: string, line: string): Quote {
    const m = line.match(/="([^"]*)"/);
    if (!m) return this.emptyQuote(symbol);

    const fields = m[1].split(',');
    if (fields.length < 6) return this.emptyQuote(symbol);

    const name = fields[0] || symbol;
    const open = parseFloat(fields[1]) || 0;
    const yesterday = parseFloat(fields[2]) || 0;
    const rawCurrent = parseFloat(fields[3]) || 0;
    const current = this.shouldHoldAStockPreviousClose(symbol, rawCurrent, yesterday)
      ? yesterday
      : rawCurrent;
    const high = parseFloat(fields[4]) || 0;
    const low = parseFloat(fields[5]) || 0;
    const volume = fields.length > 8 ? parseInt(fields[8]) || 0 : 0;

    const change = +(current - yesterday).toFixed(4);
    const changePercent = yesterday !== 0
      ? +((change / yesterday) * 100).toFixed(2)
      : 0;

    const dateStr = fields.length > 30 ? fields[30] : '';
    const timeStr = fields.length > 31 ? fields[31] : '';
    const time = (dateStr + ' ' + timeStr).trim();

    return {
      symbol, name, price: current, change, changePercent,
      open: open || undefined,
      high: high || undefined,
      low: low || undefined,
      volume: volume || undefined,
      time: time || undefined,
    };
  }

  private shouldHoldAStockPreviousClose(symbol: string, current: number, yesterday: number): boolean {
    if (symbol.toLowerCase().startsWith('hk')) return false;
    if (current > 0 || yesterday <= 0) return false;
    return this.isAStockOpeningAuction(new Date());
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

  /**
   * 解析港股行情
   * 字段索引（与 A股完全不同！）:
   *   0:英文名 1:中文名 2:今开 3:昨收 4:最高 5:最低
   *   6:当前 7:涨跌额 8:涨跌幅% 9:买一 10:卖一
   *   11:成交量 12:成交额 ...
   *   17:日期 18:时间
   */
  private parseHKLine(symbol: string, line: string): Quote {
    const m = line.match(/="([^"]*)"/);
    if (!m) return this.emptyQuote(symbol);

    const fields = m[1].split(',');
    if (fields.length < 7) return this.emptyQuote(symbol);

    // 港股用中文名（fields[1]），如果为空则用英文名
    const name = fields[1] || fields[0] || symbol;
    const open = parseFloat(fields[2]) || 0;
    const yesterday = parseFloat(fields[3]) || 0;
    const high = parseFloat(fields[4]) || 0;
    const low = parseFloat(fields[5]) || 0;
    const current = parseFloat(fields[6]) || 0;
    // 港股直接提供了涨跌额和涨跌幅
    const change = parseFloat(fields[7]) || 0;
    const changePercent = parseFloat(fields[8]) || 0;
    const volume = fields.length > 11 ? parseInt(fields[11]) || 0 : 0;

    const dateStr = fields.length > 17 ? fields[17] : '';
    const timeStr = fields.length > 18 ? fields[18] : '';
    const time = (dateStr + ' ' + timeStr).trim();

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
