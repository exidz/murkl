/**
 * Murkl SDK - TypeScript client for STARK verification on Solana
 * 
 * @example
 * ```typescript
 * import { MurklClient, StarkVerifier } from '@murkl/sdk';
 * 
 * const client = new MurklClient(connection, wallet);
 * await client.deposit(poolAddress, amount, commitment);
 * 
 * const verifier = new StarkVerifier(connection, wallet);
 * await verifier.uploadAndVerify(proof, commitment, nullifier, merkleRoot);
 * ```
 */

export { MurklClient } from './client';
export { StarkVerifier } from './verifier';
export { ProofBuffer, ProofBufferLayout } from './buffer';
export { 
  generateCommitment, 
  generateNullifier, 
  hashIdentifier,
  keccak256 
} from './crypto';
export {
  MURKL_PROGRAM_ID,
  STARK_VERIFIER_PROGRAM_ID,
  VERIFIER_BUFFER_HEADER_SIZE,
} from './constants';
export {
  serializeProof,
  parseProof,
  generateMockProof,
  calculateProofSize,
} from './proof';
export type {
  MurklConfig,
  DepositParams,
  ClaimParams,
  ProofParams,
  PoolInfo,
  DepositInfo,
} from './types';
export type {
  STWOProof,
  FriLayer,
  QueryProof,
} from './proof';
