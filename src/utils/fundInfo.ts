/**
 * 基金净值展示辅助。
 * ETF/LOF 的净值来自行情接口，溢价率按「当前价 / 净值 - 1」实时计算。
 */

import { calculatePremiumRate, Quote } from '../providers/baseProvider';
import { formatNavValue } from './symbolParser';

/** 行情是否包含可展示的基金净值。 */
export function hasFundNav(quote: Quote): boolean {
  return quote.nav !== undefined && Number.isFinite(quote.nav) && quote.nav > 0;
}

/**
 * 生成基金净值与溢价率文本，如 "1.1248（溢价率：-1.05%）"。
 * 非基金或缺少净值时返回 undefined。
 */
export function formatFundNav(quote: Quote): string | undefined {
  if (!hasFundNav(quote)) return undefined;

  const nav = formatNavValue(quote.nav as number);
  const premium = calculatePremiumRate(quote);
  if (premium === undefined) return nav;

  const sign = premium >= 0 ? '+' : '';
  return `${nav}（溢价率：${sign}${premium.toFixed(2)}%）`;
}
