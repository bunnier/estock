import { httpGet } from './httpClient';

export interface StockSearchResult {
  symbol: string;
  code: string;
  name: string;
  market: 'A' | 'H';
}

const SINA_QUERY_TYPES = '11,12,13,14,15,31,32,33,41,42';

export function parseSinaSuggestResponse(text: string): StockSearchResult[] {
  const match = text.match(/="([^"]*)"/);
  if (!match || !match[1]) return [];

  const seen = new Set<string>();
  const results: StockSearchResult[] = [];
  const rows = match[1].split(';').filter(Boolean);

  for (const row of rows) {
    const fields = row.split(',');
    const name = fields[0] || fields[4] || '';
    const type = fields[1] || '';
    const code = fields[2] || '';
    const rawSymbol = fields[3] || '';

    let result: StockSearchResult | undefined;
    if (type === '11' && /^(sh|sz)\d{6}$/i.test(rawSymbol)) {
      result = {
        symbol: rawSymbol.toLowerCase(),
        code,
        name,
        market: 'A',
      };
    } else if (type === '31' && /^\d{5}$/.test(code)) {
      result = {
        symbol: `hk${code}`,
        code,
        name,
        market: 'H',
      };
    }

    if (result && result.name && !seen.has(result.symbol)) {
      seen.add(result.symbol);
      results.push(result);
    }
  }

  return results;
}

export class SinaStockSearchProvider {
  async search(keyword: string): Promise<StockSearchResult[]> {
    const key = keyword.trim();
    if (!key) return [];

    const url = `https://suggest3.sinajs.cn/suggest/type=${SINA_QUERY_TYPES}&key=${encodeURIComponent(key)}&name=suggestdata`;
    const text = await httpGet(url, {
      Referer: 'https://finance.sina.com.cn',
    });

    return parseSinaSuggestResponse(text);
  }
}
