import { describe, expect, it } from 'vitest';
import { formatTokenAmount } from './format';

describe('formatTokenAmount', () => {
  it('formats integers with grouping', () => {
    expect(formatTokenAmount(0)).toBe('0');
    expect(formatTokenAmount(1)).toBe('1');
    expect(formatTokenAmount(1234)).toBe('1,234');
    expect(formatTokenAmount(1234567)).toBe('1,234,567');
  });

  it('trims trailing zeros', () => {
    expect(formatTokenAmount(1.5)).toBe('1.5');
    expect(formatTokenAmount(1.5, { maxDecimals: 4 })).toBe('1.5');
  });

  it('respects maxDecimals', () => {
    expect(formatTokenAmount(1.23456789, { maxDecimals: 4 })).toBe('1.2346');
    expect(formatTokenAmount(1.23401, { maxDecimals: 4 })).toBe('1.234');
  });

  it('handles negatives and -0', () => {
    expect(formatTokenAmount(-1234.5)).toBe('-1,234.5');
    expect(formatTokenAmount(-0)).toBe('0');
  });
});
