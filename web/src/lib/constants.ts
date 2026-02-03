import { PublicKey } from '@solana/web3.js';

// Program and pool addresses
export const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
// Test token pool (working on devnet)
export const POOL_ADDRESS = new PublicKey(
  import.meta.env.VITE_POOL_ADDRESS || '6ujDMwXXwEBwxmmKG6TD6cMhfw8g9XU33AHrJmEAEYzn'
);

// STARK Verifier program
export const STARK_VERIFIER_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');

// RPC endpoint
export const RPC_ENDPOINT = import.meta.env.VITE_RPC_URL || 'https://api.devnet.solana.com';

// Relayer URL
export const RELAYER_URL = import.meta.env.DEV ? 'http://localhost:3001' : '';

// Token decimals
export const TOKEN_DECIMALS = 9;

// Fee configuration
export const FEE_BPS = 50; // 0.5%

// Validation constants
export const IDENTIFIER_MAX_LENGTH = 256;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// Explorer URLs
export const EXPLORER_BASE_URL = 'https://explorer.solana.com';
export const EXPLORER_CLUSTER = 'devnet';

export function getExplorerUrl(signature: string): string {
  return `${EXPLORER_BASE_URL}/tx/${signature}?cluster=${EXPLORER_CLUSTER}`;
}

export function getAddressExplorerUrl(address: string): string {
  return `${EXPLORER_BASE_URL}/address/${address}?cluster=${EXPLORER_CLUSTER}`;
}
