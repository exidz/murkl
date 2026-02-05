/**
 * Relative time formatting — "2 hours ago", "yesterday", etc.
 *
 * Venmo-style: friendly, human-readable, no technical timestamps.
 * Uses Intl.RelativeTimeFormat when available, with manual fallback.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

type Unit = 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

interface TimeBreakpoint {
  max: number;
  divisor: number;
  unit: Unit;
}

const BREAKPOINTS: TimeBreakpoint[] = [
  { max: MINUTE, divisor: SECOND, unit: 'second' },
  { max: HOUR, divisor: MINUTE, unit: 'minute' },
  { max: DAY, divisor: HOUR, unit: 'hour' },
  { max: WEEK, divisor: DAY, unit: 'day' },
  { max: MONTH, divisor: WEEK, unit: 'week' },
  { max: YEAR, divisor: MONTH, unit: 'month' },
  { max: Infinity, divisor: YEAR, unit: 'year' },
];

// Cache formatter instance
let rtf: Intl.RelativeTimeFormat | null = null;

function getFormatter(): Intl.RelativeTimeFormat | null {
  if (rtf) return rtf;
  try {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });
    return rtf;
  } catch {
    return null;
  }
}

/**
 * Convert a date to a relative time string.
 *
 * @param date - Date string, timestamp, or Date object
 * @param now - Reference time (defaults to Date.now())
 * @returns Human-readable relative time string
 *
 * @example
 * timeAgo('2026-02-05T08:00:00Z') // "2 hours ago"
 * timeAgo(Date.now() - 30000)      // "30 seconds ago"
 * timeAgo(Date.now() - 86400000)   // "yesterday"
 */
export function timeAgo(date: string | number | Date, now: number = Date.now()): string {
  const timestamp = typeof date === 'string' || date instanceof Date
    ? new Date(date).getTime()
    : date;

  // Guard against invalid dates
  if (Number.isNaN(timestamp)) return 'just now';

  const diff = now - timestamp;

  // Future dates (shouldn't happen, but handle gracefully)
  if (diff < 0) return 'just now';

  // Very recent
  if (diff < 10 * SECOND) return 'just now';

  const formatter = getFormatter();

  for (const bp of BREAKPOINTS) {
    if (diff < bp.max) {
      const value = Math.round(diff / bp.divisor);

      // Use Intl.RelativeTimeFormat for natural language
      if (formatter) {
        return formatter.format(-value, bp.unit);
      }

      // Manual fallback
      if (value === 1) {
        const singles: Record<Unit, string> = {
          second: 'a second ago',
          minute: 'a minute ago',
          hour: 'an hour ago',
          day: 'yesterday',
          week: 'last week',
          month: 'last month',
          year: 'last year',
        };
        return singles[bp.unit];
      }
      return `${value} ${bp.unit}s ago`;
    }
  }

  return 'a long time ago';
}

/**
 * Short format: "2h", "3d", "1w" — for compact displays
 */
export function timeAgoShort(date: string | number | Date, now: number = Date.now()): string {
  const timestamp = typeof date === 'string' || date instanceof Date
    ? new Date(date).getTime()
    : date;

  if (Number.isNaN(timestamp)) return 'now';

  const diff = now - timestamp;
  if (diff < 0 || diff < 10 * SECOND) return 'now';

  const shortUnits: Record<Unit, string> = {
    second: 's',
    minute: 'm',
    hour: 'h',
    day: 'd',
    week: 'w',
    month: 'mo',
    year: 'y',
  };

  for (const bp of BREAKPOINTS) {
    if (diff < bp.max) {
      const value = Math.round(diff / bp.divisor);
      return `${value}${shortUnits[bp.unit]}`;
    }
  }

  return '∞';
}
