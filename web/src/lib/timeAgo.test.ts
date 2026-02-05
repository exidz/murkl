import { describe, it, expect } from 'vitest';
import { timeAgo, timeAgoShort } from './timeAgo';

const NOW = 1738750000000; // Fixed reference: ~Feb 5, 2026 10:26 UTC

describe('timeAgo', () => {
  it('returns "just now" for very recent timestamps', () => {
    expect(timeAgo(NOW - 1000, NOW)).toBe('just now');
    expect(timeAgo(NOW - 5000, NOW)).toBe('just now');
  });

  it('returns seconds ago', () => {
    const result = timeAgo(NOW - 30_000, NOW);
    expect(result).toMatch(/30 seconds ago/);
  });

  it('returns minutes ago', () => {
    const result = timeAgo(NOW - 5 * 60_000, NOW);
    expect(result).toMatch(/5 minutes ago/);
  });

  it('returns "1 minute ago" for ~60 seconds', () => {
    const result = timeAgo(NOW - 90_000, NOW);
    // Intl may say "1 minute ago" or "2 minutes ago" depending on rounding
    expect(result).toMatch(/minute/);
  });

  it('returns hours ago', () => {
    const result = timeAgo(NOW - 3 * 3600_000, NOW);
    expect(result).toMatch(/3 hours ago/);
  });

  it('returns "yesterday" for ~24 hours', () => {
    const result = timeAgo(NOW - 24 * 3600_000, NOW);
    expect(result).toMatch(/yesterday|1 day ago/);
  });

  it('returns days ago', () => {
    const result = timeAgo(NOW - 3 * 86400_000, NOW);
    expect(result).toMatch(/3 days ago/);
  });

  it('returns weeks ago', () => {
    const result = timeAgo(NOW - 14 * 86400_000, NOW);
    expect(result).toMatch(/2 weeks ago/);
  });

  it('returns months ago', () => {
    const result = timeAgo(NOW - 60 * 86400_000, NOW);
    expect(result).toMatch(/2 months ago/);
  });

  it('returns years ago', () => {
    const result = timeAgo(NOW - 400 * 86400_000, NOW);
    expect(result).toMatch(/1 year ago|last year/);
  });

  it('handles string dates', () => {
    const dateStr = new Date(NOW - 3600_000).toISOString();
    const result = timeAgo(dateStr, NOW);
    expect(result).toMatch(/1 hour ago|an hour ago/);
  });

  it('handles Date objects', () => {
    const date = new Date(NOW - 7200_000);
    const result = timeAgo(date, NOW);
    expect(result).toMatch(/2 hours ago/);
  });

  it('returns "just now" for future dates', () => {
    expect(timeAgo(NOW + 10000, NOW)).toBe('just now');
  });

  it('returns "just now" for invalid dates', () => {
    expect(timeAgo('not-a-date', NOW)).toBe('just now');
  });
});

describe('timeAgoShort', () => {
  it('returns "now" for very recent', () => {
    expect(timeAgoShort(NOW - 1000, NOW)).toBe('now');
  });

  it('returns seconds short', () => {
    expect(timeAgoShort(NOW - 30_000, NOW)).toBe('30s');
  });

  it('returns minutes short', () => {
    expect(timeAgoShort(NOW - 5 * 60_000, NOW)).toBe('5m');
  });

  it('returns hours short', () => {
    expect(timeAgoShort(NOW - 3 * 3600_000, NOW)).toBe('3h');
  });

  it('returns days short', () => {
    expect(timeAgoShort(NOW - 3 * 86400_000, NOW)).toBe('3d');
  });

  it('returns weeks short', () => {
    expect(timeAgoShort(NOW - 14 * 86400_000, NOW)).toBe('2w');
  });

  it('returns months short', () => {
    expect(timeAgoShort(NOW - 60 * 86400_000, NOW)).toBe('2mo');
  });
});
