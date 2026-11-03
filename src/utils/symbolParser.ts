/**
 * 股票代码标准化工具
 * A股6位 → 补 sh/sz 前缀
 * 港股5位 → 补 hk 前缀
 * 港股指数 → 保留字母代码，如 hkHSI、hkHSTECH
 */

const A_STOCK_REGEX = /^\d{6}$/;
const HK_STOCK_REGEX = /^\d{5}$/;
const PREFIXED_SYMBOL_REGEX = /^(sh|sz|hk)([0-9a-z]+)$/i;

/**
 * 常见指数缩写 → 标准化代码。
 * 键统一使用小写并去掉空格，便于忽略大小写和空格匹配。
 * 中文指数名称仍走行情搜索，方便在指数与同名 ETF 之间选择。
 */
const INDEX_ALIASES: Record<string, string> = {
  'hsi': 'hkHSI',
  'hangseng': 'hkHSI',
  'hangsengindex': 'hkHSI',
  'hstech': 'hkHSTECH',
  'hangsengtech': 'hkHSTECH',
  'hscei': 'hkHSCEI',
};

/** 判断是否为A股代码 */
export function isAStock(symbol: string): boolean {
  return A_STOCK_REGEX.test(symbol.trim());
}

/** 判断是否为港股代码 */
export function isHKStock(symbol: string): boolean {
  return HK_STOCK_REGEX.test(symbol.trim());
}

/** 解析指数缩写（如 HSI、HSTECH），未命中返回 undefined。 */
export function resolveIndexAlias(input: string): string | undefined {
  const key = input.trim().toLowerCase().replace(/\s+/g, '');
  return INDEX_ALIASES[key];
}

/**
 * 标准化股票代码，补上市场前缀
 * "600519" → "sh600519"
 * "000001" → "sz000001"
 * "00700"  → "hk00700"
 * "hkhsi"  → "hkHSI"（港股指数保留大写字母代码）
 * "sh600519" → "sh600519" (已有前缀，原样返回)
 */
export function normalizeSymbol(symbol: string): string {
  const raw = symbol.trim();
  if (!raw) return '';

  const alias = resolveIndexAlias(raw);
  if (alias) return alias;

  const s = raw.toLowerCase();

  // 已有前缀 → 保留市场前缀，字母代码统一大写（上游接口区分大小写，如 hkHSI）
  const prefixed = s.match(PREFIXED_SYMBOL_REGEX);
  if (prefixed) {
    const [, market, code] = prefixed;
    return `${market}${/^\d+$/.test(code) ? code : code.toUpperCase()}`;
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

/** 判断是否为沪深场内基金。 */
export function isExchangeTradedFund(symbol: string): boolean {
  const normalized = normalizeSymbol(symbol);
  return /^sh5\d{5}$/.test(normalized)
    || /^sz(?:15|16|18)\d{4}$/.test(normalized);
}

/** 按证券品种格式化价格。 */
export function formatPrice(symbol: string, value: number): string {
  return value.toFixed(isExchangeTradedFund(symbol) ? 3 : 2);
}

/** 基金净值统一保留 4 位小数。 */
export function formatNavValue(value: number): string {
  return value.toFixed(4);
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

/** 返回雪球股票详情链接。 */
export function toXueqiuUrl(symbol: string): string {
  const normalized = normalizeSymbol(symbol);
  const xueqiuSymbol = normalized.startsWith('hk')
    ? stripPrefix(normalized)
    : normalized.toUpperCase();
  return `https://xueqiu.com/S/${xueqiuSymbol}`;
}

/** 按交易货币格式化总市值，缺失或无效数据使用占位符。 */
export function formatMarketCap(symbol: string, value: number | undefined): string {
  return value === 0 ? '--' : formatAmount(symbol, value);
}

/** 按交易货币格式化金额，保留有效的零成交额。 */
export function formatAmount(symbol: string, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '--';
  const currency = isHK(symbol) ? '港元' : '元';
  if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(2)}万亿${currency}`;
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿${currency}`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)}万${currency}`;
  return `${value.toFixed(2)}${currency}`;
}
