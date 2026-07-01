/**
 * 股票代码标准化工具
 * A股6位 → 补 sh/sz 前缀
 * 港股5位 → 补 hk 前缀
 */

const A_STOCK_REGEX = /^\d{6}$/;
const HK_STOCK_REGEX = /^\d{5}$/;

/** 判断是否为A股代码 */
export function isAStock(symbol: string): boolean {
  return A_STOCK_REGEX.test(symbol.trim());
}

/** 判断是否为港股代码 */
export function isHKStock(symbol: string): boolean {
  return HK_STOCK_REGEX.test(symbol.trim());
}

/**
 * 标准化股票代码，补上市场前缀
 * "600519" → "sh600519"
 * "000001" → "sz000001"
 * "00700"  → "hk00700"
 * "sh600519" → "sh600519" (已有前缀，原样返回)
 */
export function normalizeSymbol(symbol: string): string {
  const s = symbol.trim().toLowerCase();

  // 已有前缀 → 原样返回（小写）
  if (/^(sh|sz|hk)\d+/.test(s)) {
    return s;
  }

  if (isHKStock(s)) {
    return `hk${s}`;
  }

  if (isAStock(s)) {
    // 深交所：000/001/002/003/300/301 股票，以及 15/16/18 开头的基金/ETF → sz
    // 上交所：600/601/603/605/688 开头 → sh
    if (/^(0|3|15|16|18)/.test(s)) {
      return `sz${s}`;
    }
    return `sh${s}`;
  }

  // 无法识别，原样返回
  return s;
}

/** 批量标准化 */
export function normalizeSymbols(symbols: string[]): string[] {
  return symbols.map(normalizeSymbol);
}

/** 去除前缀，返回纯数字代码（用于显示） */
export function stripPrefix(symbol: string): string {
  return symbol.replace(/^(sh|sz|hk)/i, '');
}

/** 判断是否为港股（带前缀） */
export function isHK(symbol: string): boolean {
  return symbol.toLowerCase().startsWith('hk');
}

/** 返回市场标识：A股 → 'A'，港股 → 'H' */
export function getMarketTag(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s.startsWith('hk')) return 'H';
  if (s.startsWith('sh') || s.startsWith('sz')) return 'A';
  return '';
}

/** 返回金额货币符号：A股 → '¥'，港股 → '$' */
export function getCurrencySymbol(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s.startsWith('hk')) return '$';
  if (s.startsWith('sh') || s.startsWith('sz')) return '¥';
  return '';
}

/** 带市场标识的显示名称，如 "平安银行(A)" / "腾讯控股(H)" */
export function nameWithMarket(name: string, symbol: string): string {
  const tag = getMarketTag(symbol);
  return tag ? `${name}(${tag})` : name;
}

/** 格式化显示名称，A股加 .SS/.SZ，港股加 .HK */
export function toDisplaySymbol(symbol: string): string {
  const s = symbol.toLowerCase();
  if (s.startsWith('sh')) return symbol.substring(2) + '.SS';
  if (s.startsWith('sz')) return symbol.substring(2) + '.SZ';
  if (s.startsWith('hk')) return symbol.substring(2) + '.HK';
  return symbol;
}
