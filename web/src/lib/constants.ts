import { PublicKey } from '@solana/web3.js';

// Program and pool addresses (vanity deployment)
export const PROGRAM_ID = new PublicKey('muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
// WSOL pool (devnet)
export const POOL_ADDRESS = new PublicKey(
  import.meta.env.VITE_POOL_ADDRESS || '8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ'
);
// WSOL mint (native SOL wrapper)
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

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
