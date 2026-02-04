import { 
  Connection, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import { keccak256 } from 'js-sha3';
import { PROGRAM_ID, TOKEN_DECIMALS } from './constants';

const M31_PRIME = 0x7FFFFFFF;

/**
 * Hash password to M31 field element (matches WASM prover)
 */
function hashPassword(password: string): number {
  const data = new TextEncoder().encode('murkl_password_v1' + password);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  const val = view.getUint32(0, true); // little-endian
  return val % M31_PRIME;
}

/**
 * Hash identifier to M31 field element (matches WASM prover)
 */
function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = new TextEncoder().encode('murkl_identifier_v1' + normalized);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  const val = view.getUint32(0, true);
  return val % M31_PRIME;
}

/**
 * Compute commitment (matches WASM prover)
 */
export function computeCommitment(identifier: string, password: string): Uint8Array {
  const idHash = hashIdentifier(identifier);
  const secret = hashPassword(password);
  
  // Build commitment input
  const prefix = new TextEncoder().encode('murkl_m31_hash_v1');
  const idBuf = new Uint8Array(4);
  const secretBuf = new Uint8Array(4);
  
  new DataView(idBuf.buffer).setUint32(0, idHash, true);
  new DataView(secretBuf.buffer).setUint32(0, secret, true);
  
  const combined = new Uint8Array(prefix.length + 4 + 4);
  combined.set(prefix, 0);
  combined.set(idBuf, prefix.length);
  combined.set(secretBuf, prefix.length + 4);
  
  const hashArray = keccak256.arrayBuffer(combined);
  return new Uint8Array(hashArray);
}

/**
 * Get Anchor discriminator (SHA256, not keccak!)
 */
async function getDiscriminator(name: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`global:${name}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer.slice(0, 8));
}

export interface PoolInfo {
  authority: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  root: Uint8Array;
  nextLeafIndex: number;
}

/**
 * Fetch pool info from chain
 */
export async function fetchPoolInfo(connection: Connection, pool: PublicKey): Promise<PoolInfo> {
  const poolInfo = await connection.getAccountInfo(pool);
  if (!poolInfo) {
    throw new Error('Pool not found');
  }
  
  const data = poolInfo.data;
  // Skip 8-byte discriminator
  const authority = new PublicKey(data.slice(8, 40));
  const mint = new PublicKey(data.slice(40, 72));
  const vault = new PublicKey(data.slice(72, 104));
  const root = data.slice(104, 136);
  // leaf_count is u64
  const nextLeafIndex = Number(data.readBigUInt64LE(136));
  
  return {
    authority,
    mint,
    vault,
    root,
    nextLeafIndex,
  };
}

export interface DepositResult {
  transaction: Transaction;
  leafIndex: number;
  commitment: Uint8Array;
  depositPda: PublicKey;
}

export interface DepositOptions {
  /** If true, wrap native SOL to WSOL. If false, use existing WSOL in wallet */
  wrapSol?: boolean;
}

/**
 * Build deposit transaction
 * - wrapSol=true (default): Wraps native SOL to WSOL for deposit
 * - wrapSol=false: Uses existing WSOL in wallet directly
 */
export async function buildDepositTransaction(
  connection: Connection,
  pool: PublicKey,
  depositor: PublicKey,
  identifier: string,
  password: string,
  amount: number,
  options: DepositOptions = {},
): Promise<DepositResult> {
  const { wrapSol = true } = options;
  // Fetch pool info
  const poolInfo = await fetchPoolInfo(connection, pool);
  const leafIndex = poolInfo.nextLeafIndex;
  
  // Compute commitment
  const commitment = computeCommitment(identifier, password);
  
  // Check if pool uses WSOL (native SOL)
  const isWsol = poolInfo.mint.equals(NATIVE_MINT);
  
  // Get user's token account
  const userAta = await getAssociatedTokenAddress(poolInfo.mint, depositor);
  
  // Check if user ATA exists
  const userAtaInfo = await connection.getAccountInfo(userAta);
  
  // Derive deposit PDA (leaf_count is u64 = 8 bytes)
  const leafIndexBuffer = Buffer.alloc(8);
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex));
  
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), pool.toBuffer(), leafIndexBuffer],
    PROGRAM_ID
  );
  
  // Build instruction data: discriminator (8) + amount (8) + commitment (32)
  const discriminator = await getDiscriminator('deposit');
  const amountLamports = BigInt(Math.floor(amount * Math.pow(10, TOKEN_DECIMALS)));
  
  const instructionData = Buffer.alloc(48);
  instructionData.set(discriminator, 0);
  instructionData.writeBigUInt64LE(amountLamports, 8);
  instructionData.set(commitment, 16);
  
  const tx = new Transaction();
  
  // Add ATA creation instruction if needed
  if (!userAtaInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(
        depositor,
        userAta,
        depositor,
        poolInfo.mint
      )
    );
  }
  
  // If WSOL pool AND user wants to wrap native SOL
  if (isWsol && wrapSol) {
    // Transfer native SOL to the WSOL ATA
    tx.add(
      SystemProgram.transfer({
        fromPubkey: depositor,
        toPubkey: userAta,
        lamports: Number(amountLamports),
      })
    );
    
    // Sync native balance (tells the token program about the new SOL)
    tx.add(createSyncNativeInstruction(userAta));
  }
  // If wrapSol=false for WSOL pool, user is depositing existing WSOL directly
  
  // Add deposit instruction
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: poolInfo.vault, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },  // depositor BEFORE depositor_token
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data: instructionData
  });
  
  tx.add(ix);
  
  return {
    transaction: tx,
    leafIndex,
    commitment,
    depositPda,
  };
}

/**
 * Generate random password
 */
export function generatePassword(length: number = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/**
 * Create share link
 */
export function createShareLink(
  identifier: string,
  leafIndex: number,
  pool: string,
): string {
  const params = new URLSearchParams({
    id: identifier,
    leaf: leafIndex.toString(),
    pool,
  });
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://murkl.app';
  return `${base}/claim?${params.toString()}`;
}

/**
 * Parse share link
 */
export function parseShareLink(url: string): { identifier: string; leafIndex: number; pool: string } | null {
  try {
    const parsed = new URL(url);
    const identifier = parsed.searchParams.get('id');
    const leafIndex = parsed.searchParams.get('leaf');
    const pool = parsed.searchParams.get('pool');
    
    if (!identifier || !leafIndex || !pool) return null;
    
    return {
      identifier,
      leafIndex: parseInt(leafIndex, 10),
      pool,
    };
  } catch {
    return null;
  }
}
