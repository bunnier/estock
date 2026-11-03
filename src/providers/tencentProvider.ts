/**
 * 腾讯财经数据 Provider
 * A股 + 港股 + 港股指数免费接口，无需 API Key
 * API: https://qt.gtimg.cn/q=sh600519,hk00700,hkHSI
 * 返回编码：GBK
 *
 * 返回格式（~分隔，A股/港股字段索引基本一致）：
 *   v_sh600519="1~贵州茅台~600519~当前~昨收~今开~成交量~外盘~内盘~买一价~...";
 *
 * 统一字段索引:
 *   0:市场代码 1:名称 2:代码 3:当前价 4:昨收 5:今开
 *   6:成交量 7:外盘 8:内盘
 *   30:时间 31:涨跌额 32:涨跌幅% 33:最高 34:最低
 *   61:证券类型（A股） 63:证券类型（港股），ETF/LOF/GP-A/GP/GP-FUND/ZS
 *   78:基金参考净值（IOPV） 81:基金单位净值
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

    const isHK = symbol.toLowerCase().startsWith('hk');
    // 证券类型：A 股在 61 位（ETF/LOF/GP-A/ZS），港股在 63 位（GP/GP-FUND/ZS）。
    const securityType = fields[isHK ? 63 : 61] || '';
    const isIndex = securityType === 'ZS';
    const isFund = /ETF|LOF|FUND/i.test(securityType);
    const nav = this.parseFundNav(isHK, isFund, fields);

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
    // 指数的市值、成交、估值字段口径与个股不同，统一不展示，避免出现无意义数值。
    const valuation: { pe?: number; pb?: number; dividendYield?: number } = isIndex
      ? {}
      : this.parseValuationMetrics(symbol, fields);
    const turnover = this.parseOptionalNumber(fields[37]);
    const marketCapInHundredMillions = this.parseOptionalNumber(fields[45]);

    return {
      symbol, name, price: current, change, changePercent,
      previousClose: rawYesterday || undefined,
      open: open || undefined,
      high: high || undefined,
      low: low || undefined,
      volume: isIndex ? undefined : volume || undefined,
      // 腾讯 A 股成交额以万元计，港股以港元计。
      turnover: !isIndex && turnover !== undefined && turnover >= 0
        ? turnover * (isHK ? 1 : 10_000)
        : undefined,
      // 腾讯总市值字段的单位为亿，统一换算为交易货币的元。
      marketCap: !isIndex && marketCapInHundredMillions !== undefined && marketCapInHundredMillions > 0
        ? marketCapInHundredMillions * 100_000_000
        : undefined,
      pe: valuation.pe,
      pb: valuation.pb,
      dividendYield: valuation.dividendYield,
      nav,
      isFund: isFund || undefined,
      isIndex: isIndex || undefined,
      time: time || undefined,
    };
  }

  /**
   * 解析基金净值。
   * 78 位为盘中参考净值（IOPV），81 位为最新单位净值，优先使用参考净值以计算盘中溢价率。
   * 港股基金接口不提供净值字段。
   */
  private parseFundNav(isHK: boolean, isFund: boolean, fields: string[]): number | undefined {
    if (!isFund || isHK) return undefined;

    const referenceNav = this.parseOptionalNumber(fields[78]);
    if (referenceNav !== undefined && referenceNav > 0) return referenceNav;

    const publishedNav = this.parseOptionalNumber(fields[81]);
    return publishedNav !== undefined && publishedNav > 0 ? publishedNav : undefined;
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
    // 基金等品种会把估值字段填成 0，按缺失处理，避免悬浮详情出现 PE：0.00 / PB：0.00。
    const pe = this.parseOptionalNumber(fields[isHK ? 57 : 39]);
    const pb = this.parseOptionalNumber(fields[isHK ? 58 : 46]);
    return {
      pe: pe !== undefined && pe > 0 ? pe : undefined,
      pb: pb !== undefined && pb > 0 ? pb : undefined,
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
