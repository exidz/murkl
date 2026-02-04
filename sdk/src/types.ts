import { PublicKey, Connection, Signer } from '@solana/web3.js';

/**
 * Configuration for MurklClient
 */
export interface MurklConfig {
  /** Solana RPC connection */
  connection: Connection;
  /** Wallet/signer for transactions */
  wallet: Signer;
  /** Optional custom program ID */
  programId?: PublicKey;
  /** Optional custom verifier program ID */
  verifierProgramId?: PublicKey;
}

/**
 * Parameters for depositing tokens
 */
export interface DepositParams {
  /** Pool address */
  pool: PublicKey;
  /** Amount to deposit (in token units) */
  amount: bigint;
  /** Commitment hash (32 bytes) */
  commitment: Uint8Array;
  /** Depositor's token account */
  depositorTokenAccount: PublicKey;
}

/**
 * Parameters for claiming tokens
 */
export interface ClaimParams {
  /** Pool address */
  pool: PublicKey;
  /** Deposit record address */
  deposit: PublicKey;
  /** Verifier buffer containing verified proof */
  verifierBuffer: PublicKey;
  /** Nullifier from the proof */
  nullifier: Uint8Array;
  /** Recipient's token account */
  recipientTokenAccount: PublicKey;
  /** Relayer fee (in token units) */
  relayerFee?: bigint;
}

/**
 * Parameters for proof verification
 */
export interface ProofParams {
  /** STARK proof bytes */
  proof: Uint8Array;
  /** Commitment hash (32 bytes) */
  commitment: Uint8Array;
  /** Nullifier hash (32 bytes) */
  nullifier: Uint8Array;
  /** Merkle root (32 bytes) */
  merkleRoot: Uint8Array;
}

/**
 * Pool information
 */
export interface PoolInfo {
  /** Pool address */
  address: PublicKey;
  /** Admin address */
  admin: PublicKey;
  /** Token mint */
  tokenMint: PublicKey;
  /** Vault address */
  vault: PublicKey;
  /** Current merkle root */
  merkleRoot: Uint8Array;
  /** Number of deposits */
  leafCount: bigint;
  /** Minimum deposit amount */
  minDeposit: bigint;
  /** Maximum relayer fee in basis points */
  maxRelayerFeeBps: number;
  /** Whether pool is paused */
  paused: boolean;
}

/**
 * Deposit record information
 */
export interface DepositInfo {
  /** Deposit record address */
  address: PublicKey;
  /** Pool address */
  pool: PublicKey;
  /** Commitment hash */
  commitment: Uint8Array;
  /** Deposited amount */
  amount: bigint;
  /** Leaf index in merkle tree */
  leafIndex: bigint;
  /** Whether already claimed */
  claimed: boolean;
}

/**
 * Proof buffer state
 */
export interface ProofBufferState {
  /** Buffer address */
  address: PublicKey;
  /** Owner (uploader) */
  owner: PublicKey;
  /** Current uploaded size */
  size: number;
  /** Expected total size */
  expectedSize: number;
  /** Whether verified and finalized */
  finalized: boolean;
  /** Commitment (if finalized) */
  commitment?: Uint8Array;
  /** Nullifier (if finalized) */
  nullifier?: Uint8Array;
  /** Merkle root (if finalized) */
  merkleRoot?: Uint8Array;
}
