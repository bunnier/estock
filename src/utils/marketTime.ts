/**
 * 开盘/收盘判断逻辑。
 * A 股：周一至周五。
 *   - 开盘集合竞价：9:15-9:25
 *   - 静默期：9:25-9:30（不刷新，但也不算休市）
 *   - 上午连续竞价：9:30-11:30
 *   - 午休：11:30-13:00
 *   - 下午连续竞价：13:00-15:00
 *   - 收盘集合竞价：14:57-15:00（已含在连续竞价内）
 *
 * 港股：周一至周五。
 *   - 开市前竞价：9:00-9:30
 *   - 上午持续交易：9:30-12:00
 *   - 午休：12:00-13:00
 *   - 下午持续交易：13:00-16:00
 *   - 收盘竞价：16:00-16:10（港股随机收市，取16:10）
 *   - 16:10-16:20 部分券商仍有延迟数据
 */

export type MarketCode = 'cn' | 'hk';

export interface HolidayChecker {
  isHoliday(market: MarketCode, dateKey: string): boolean | Promise<boolean>;
}

interface TimeRange {
  start: number; // 分钟数（从 0 点起）。
  end: number;
}

/** A 股有行情数据的时段（含集合竞价）。 */
const A_STOCK_RANGES: TimeRange[] = [
  { start: 9 * 60 + 15,  end: 11 * 60 + 30 }, // 开盘集合竞价 + 上午连续竞价。
  { start: 13 * 60,      end: 15 * 60 },       // 下午连续竞价。
];

/** 港股有行情数据的时段（含集合竞价）。 */
const HK_STOCK_RANGES: TimeRange[] = [
  { start: 9 * 60,       end: 12 * 60 },       // 开市前竞价 + 上午持续交易。
  { start: 13 * 60,      end: 16 * 60 + 10 },  // 下午持续交易 + 收盘竞价。
];

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  dateKey: string;
}

const MARKET_TIME_ZONE: Record<MarketCode, string> = {
  cn: 'Asia/Shanghai',
  hk: 'Asia/Hong_Kong',
};

function getZonedDateParts(date: Date, market: MarketCode): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TIME_ZONE[market],
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]));
  const year = Number(parts.get('year'));
  const month = Number(parts.get('month'));
  const day = Number(parts.get('day'));
  const hour = Number(parts.get('hour'));
  const minute = Number(parts.get('minute'));

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: parts.get('weekday') || '',
    dateKey: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

function isWorkday(parts: ZonedDateParts): boolean {
  return parts.weekday !== 'Sat' && parts.weekday !== 'Sun';
}

function inRanges(parts: ZonedDateParts, ranges: TimeRange[]): boolean {
  const totalMin = parts.hour * 60 + parts.minute;
  return ranges.some(r => totalMin >= r.start && totalMin <= r.end);
}

function getMarketFromSymbol(symbol: string): MarketCode {
  return symbol.toLowerCase().startsWith('hk') ? 'hk' : 'cn';
}

async function isMarketOpenForMarket(
  market: MarketCode,
  date: Date,
  ranges: TimeRange[],
  holidayChecker?: HolidayChecker,
): Promise<boolean> {
  const parts = getZonedDateParts(date, market);
  if (!isWorkday(parts)) return false;
  if (holidayChecker && await holidayChecker.isHoliday(market, parts.dateKey)) return false;
  return inRanges(parts, ranges);
}

/** 判断当前是否处于 A 股交易时段（含集合竞价）。 */
export function isAStockOpen(date: Date = new Date(), holidayChecker?: HolidayChecker): Promise<boolean> {
  return isMarketOpenForMarket('cn', date, A_STOCK_RANGES, holidayChecker);
}

/** 判断当前是否处于港股交易时段（含集合竞价）。 */
export function isHKStockOpen(date: Date = new Date(), holidayChecker?: HolidayChecker): Promise<boolean> {
  return isMarketOpenForMarket('hk', date, HK_STOCK_RANGES, holidayChecker);
}

/** 判断指定股票当前是否处于所属市场交易时段。 */
export function isMarketOpenForSymbol(
  symbol: string,
  date: Date = new Date(),
  holidayChecker?: HolidayChecker,
): Promise<boolean> {
  const market = getMarketFromSymbol(symbol);
  return market === 'hk'
    ? isHKStockOpen(date, holidayChecker)
    : isAStockOpen(date, holidayChecker);
}

/** 判断传入股票中是否至少有一个处于交易时段。 */
export async function isAnyMarketOpenForSymbols(
  symbols: string[],
  date: Date = new Date(),
  holidayChecker?: HolidayChecker,
): Promise<boolean> {
  for (const symbol of symbols) {
    if (await isMarketOpenForSymbol(symbol, date, holidayChecker)) {
      return true;
    }
  }
  return false;
}

/** 综合判断：任一市场开盘即视为开盘（用于决定是否刷新）。 */
export async function isMarketOpen(date: Date = new Date(), holidayChecker?: HolidayChecker): Promise<boolean> {
  return await isAStockOpen(date, holidayChecker) || await isHKStockOpen(date, holidayChecker);
}
