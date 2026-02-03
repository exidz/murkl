import { IDENTIFIER_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './constants';

/**
 * Sanitize input - remove control characters and trim
 */
export function sanitizeInput(input: string): string {
  return input.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

/**
 * Validate identifier
 */
export function isValidIdentifier(identifier: string): boolean {
  const clean = sanitizeInput(identifier);
  return clean.length >= 1 && clean.length <= IDENTIFIER_MAX_LENGTH;
}

/**
 * Validate password
 */
export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

/**
 * Validate Solana address (base58, 32-44 chars)
 */
export function isValidSolanaAddress(address: string): boolean {
  const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  return base58Regex.test(address);
}

/**
 * Validate leaf index
 */
export function isValidLeafIndex(value: string): boolean {
  const num = parseInt(value, 10);
  return !isNaN(num) && num >= 0 && num < 2 ** 32;
}

/**
 * Validate amount
 */
export function isValidAmount(value: string): boolean {
  const num = parseFloat(value);
  return !isNaN(num) && num > 0;
}

/**
 * Format address for display
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (address.length <= chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format amount with decimals
 */
export function formatAmount(amount: number, decimals: number = 2): string {
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}
