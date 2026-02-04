import { describe, it, expect } from 'vitest';
import {
  sanitizeInput,
  isValidIdentifier,
  isValidPassword,
  isValidSolanaAddress,
  isValidLeafIndex,
  isValidAmount,
  formatAddress,
  formatAmount,
} from './validation';

describe('sanitizeInput', () => {
  it('removes control characters', () => {
    expect(sanitizeInput('hello\x00world')).toBe('helloworld');
    expect(sanitizeInput('test\x1F')).toBe('test');
  });

  it('trims whitespace', () => {
    expect(sanitizeInput('  hello  ')).toBe('hello');
    expect(sanitizeInput('\thello\n')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });
});

describe('isValidIdentifier', () => {
  it('accepts valid identifiers', () => {
    expect(isValidIdentifier('@alice')).toBe(true);
    expect(isValidIdentifier('alice@example.com')).toBe(true);
    expect(isValidIdentifier('a')).toBe(true);
  });

  it('rejects empty identifier', () => {
    expect(isValidIdentifier('')).toBe(false);
    expect(isValidIdentifier('   ')).toBe(false);
  });

  it('rejects too long identifier', () => {
    expect(isValidIdentifier('a'.repeat(257))).toBe(false);
  });

  it('accepts max length identifier', () => {
    expect(isValidIdentifier('a'.repeat(256))).toBe(true);
  });
});

describe('isValidPassword', () => {
  it('accepts valid passwords', () => {
    expect(isValidPassword('password123')).toBe(true);
    expect(isValidPassword('12345678')).toBe(true);
  });

  it('rejects short passwords', () => {
    expect(isValidPassword('short')).toBe(false);
    expect(isValidPassword('1234567')).toBe(false);
  });

  it('rejects too long passwords', () => {
    expect(isValidPassword('a'.repeat(129))).toBe(false);
  });

  it('accepts max length password', () => {
    expect(isValidPassword('a'.repeat(128))).toBe(true);
  });
});

describe('isValidSolanaAddress', () => {
  it('accepts valid Solana addresses', () => {
    expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(isValidSolanaAddress('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92')).toBe(true);
    expect(isValidSolanaAddress('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw')).toBe(true);
  });

  it('rejects invalid characters', () => {
    expect(isValidSolanaAddress('0OIl1111111111111111111111111111')).toBe(false); // 0, O, I, l invalid
  });

  it('rejects too short addresses', () => {
    expect(isValidSolanaAddress('abc')).toBe(false);
  });

  it('rejects too long addresses', () => {
    expect(isValidSolanaAddress('a'.repeat(45))).toBe(false);
  });
});

describe('isValidLeafIndex', () => {
  it('accepts valid leaf indices', () => {
    expect(isValidLeafIndex('0')).toBe(true);
    expect(isValidLeafIndex('1')).toBe(true);
    expect(isValidLeafIndex('1000000')).toBe(true);
  });

  it('rejects negative numbers', () => {
    expect(isValidLeafIndex('-1')).toBe(false);
  });

  it('rejects non-numbers', () => {
    expect(isValidLeafIndex('abc')).toBe(false);
    expect(isValidLeafIndex('')).toBe(false);
  });

  it('rejects too large numbers', () => {
    expect(isValidLeafIndex('4294967296')).toBe(false); // 2^32
  });
});

describe('isValidAmount', () => {
  it('accepts valid amounts', () => {
    expect(isValidAmount('1')).toBe(true);
    expect(isValidAmount('0.001')).toBe(true);
    expect(isValidAmount('1000000')).toBe(true);
  });

  it('rejects zero', () => {
    expect(isValidAmount('0')).toBe(false);
  });

  it('rejects negative amounts', () => {
    expect(isValidAmount('-1')).toBe(false);
  });

  it('rejects non-numbers', () => {
    expect(isValidAmount('abc')).toBe(false);
    expect(isValidAmount('')).toBe(false);
  });
});

describe('formatAddress', () => {
  it('shortens long addresses', () => {
    expect(formatAddress('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92', 4)).toBe('74P7...Za92');
  });

  it('handles custom char count', () => {
    expect(formatAddress('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92', 6)).toBe('74P7nT...FFZa92');
  });

  it('returns short addresses unchanged', () => {
    expect(formatAddress('abc', 4)).toBe('abc');
  });
});

describe('formatAmount', () => {
  it('formats whole numbers', () => {
    expect(formatAmount(1000)).toBe('1,000');
  });

  it('formats decimals', () => {
    expect(formatAmount(1.234, 2)).toBe('1.23');
  });

  it('handles zero decimals', () => {
    expect(formatAmount(1000.99, 0)).toBe('1,001');
  });
});
