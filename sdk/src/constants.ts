import { PublicKey } from '@solana/web3.js';

/**
 * Murkl program ID (anonymous transfers)
 */
export const MURKL_PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');

/**
 * Stark verifier program ID
 */
export const STARK_VERIFIER_PROGRAM_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');

/**
 * Verifier buffer layout offsets
 */
export const VERIFIER_BUFFER_LAYOUT = {
  OWNER: 0,
  SIZE: 32,
  EXPECTED_SIZE: 36,
  FINALIZED: 40,
  COMMITMENT: 41,
  NULLIFIER: 73,
  MERKLE_ROOT: 105,
  PROOF_DATA: 137,
} as const;

export const VERIFIER_BUFFER_HEADER_SIZE = 137;

/**
 * Maximum proof size in bytes
 */
export const MAX_PROOF_SIZE = 8192;

/**
 * Default chunk size for uploading proofs
 */
export const DEFAULT_CHUNK_SIZE = 900;

/**
 * PDA seeds
 */
export const SEEDS = {
  CONFIG: Buffer.from('config'),
  POOL: Buffer.from('pool'),
  VAULT: Buffer.from('vault'),
  DEPOSIT: Buffer.from('deposit'),
  NULLIFIER: Buffer.from('nullifier'),
} as const;
