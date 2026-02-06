import { describe, expect, it } from 'vitest';
import { normalizeAmountInput } from './AmountInput';

describe('normalizeAmountInput', () => {
  it('strips currency symbols and spaces', () => {
    expect(normalizeAmountInput('◎ 0.5', 9)).toBe('0.5');
    expect(normalizeAmountInput(' $ 12.34 ', 9)).toBe('12.34');
  });

  it('handles comma as decimal separator when no dot', () => {
    expect(normalizeAmountInput('1,5', 9)).toBe('1.5');
    expect(normalizeAmountInput('1 234,56', 9)).toBe('1234.56');
  });

  it('handles dot as decimal separator when no comma', () => {
    expect(normalizeAmountInput('1.5', 9)).toBe('1.5');
    expect(normalizeAmountInput('1 234.56', 9)).toBe('1234.56');
  });

  it('handles mixed separators using the last separator as decimal', () => {
    // EU-style: dot grouping + comma decimal
    expect(normalizeAmountInput('1.234,56', 9)).toBe('1234.56');
    // US-style: comma grouping + dot decimal
    expect(normalizeAmountInput('1,234.56', 9)).toBe('1234.56');
  });

  it('limits decimals', () => {
    expect(normalizeAmountInput('1.23456789', 2)).toBe('1.23');
    expect(normalizeAmountInput('0,999', 2)).toBe('0.99');
  });

  it('keeps 0. prefix behavior', () => {
    expect(normalizeAmountInput('.', 9)).toBe('0.');
    expect(normalizeAmountInput('00.5', 9)).toBe('0.5');
    expect(normalizeAmountInput('00012', 9)).toBe('12');
  });
});
