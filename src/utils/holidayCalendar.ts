import { httpGet } from '../providers/httpClient';

export type MarketCode = 'cn' | 'hk';

interface NagerHoliday {
  date: string;
  name?: string;
  countryCode?: string;
  nationalHoliday?: boolean;
  holidayTypes?: string[];
}

const COUNTRY_BY_MARKET: Record<MarketCode, string> = {
  cn: 'CN',
  hk: 'HK',
};

const FALLBACK_HOLIDAYS_2026: Record<MarketCode, Set<string>> = {
  cn: new Set([
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-01-28', '2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02', '2026-02-03',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-05-31', '2026-06-01', '2026-06-02',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
  ]),
  hk: new Set([
    '2026-01-01',
    '2026-01-29', '2026-01-30',
    '2026-04-03', '2026-04-06',
    '2026-04-29',
    '2026-05-01',
    '2026-05-25',
    '2026-06-19', '2026-06-20',
    '2026-07-01',
    '2026-10-01', '2026-10-02',
    '2026-10-07',
    '2026-10-26',
    '2026-12-25', '2026-12-26',
  ]),
};

function cacheKey(market: MarketCode, year: number): string {
  return `${market}:${year}`;
}

function fallbackHolidays(market: MarketCode, year: number): Set<string> {
  if (year === 2026) {
    return new Set(FALLBACK_HOLIDAYS_2026[market]);
  }
  return new Set();
}

function isPublicHoliday(holiday: NagerHoliday): boolean {
  if (holiday.nationalHoliday) {
    return true;
  }
  return holiday.holidayTypes?.includes('Public') === true;
}

export class HolidayCalendar {
  private cache = new Map<string, Promise<Set<string>>>();

  async isHoliday(market: MarketCode, dateKey: string): Promise<boolean> {
    const year = Number(dateKey.slice(0, 4));
    const holidays = await this.getHolidays(market, year);
    return holidays.has(dateKey);
  }

  private getHolidays(market: MarketCode, year: number): Promise<Set<string>> {
    const key = cacheKey(market, year);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const loaded = this.fetchHolidays(market, year);
    this.cache.set(key, loaded);
    return loaded;
  }

  private async fetchHolidays(market: MarketCode, year: number): Promise<Set<string>> {
    const country = COUNTRY_BY_MARKET[market];
    const url = `https://date.nager.at/api/v4/Holidays/${country}/${year}`;

    try {
      const text = await httpGet(url, {}, 'utf-8');
      const holidays = JSON.parse(text) as NagerHoliday[];
      return new Set(
        holidays
          .filter(h => typeof h.date === 'string' && isPublicHoliday(h))
          .map(h => h.date),
      );
    } catch (e) {
      console.warn(`[estock] holiday api failed for ${country}/${year}`, e);
      return fallbackHolidays(market, year);
    }
  }
}
