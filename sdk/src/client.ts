import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Signer,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { 
  MURKL_PROGRAM_ID, 
  STARK_VERIFIER_PROGRAM_ID,
  SEEDS,
} from './constants';
import { StarkVerifier } from './verifier';
import type { 
  MurklConfig, 
  DepositParams, 
  ClaimParams,
  PoolInfo,
  DepositInfo,
} from './types';

/**
 * Client for interacting with Murkl anonymous transfer pools
 */
export class MurklClient {
  readonly connection: Connection;
  readonly wallet: Signer;
  readonly programId: PublicKey;
  readonly verifier: StarkVerifier;

  constructor(config: MurklConfig) {
    this.connection = config.connection;
    this.wallet = config.wallet;
    this.programId = config.programId ?? MURKL_PROGRAM_ID;
    this.verifier = new StarkVerifier(
      config.connection,
      config.wallet,
      config.verifierProgramId ?? STARK_VERIFIER_PROGRAM_ID
    );
  }

  // =========================================================================
  // PDAs
  // =========================================================================

  /**
   * Get global config PDA
   */
  getConfigPDA(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SEEDS.CONFIG],
      this.programId
    );
    return pda;
  }

  /**
   * Get pool PDA for a token mint
   */
  getPoolPDA(tokenMint: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SEEDS.POOL, tokenMint.toBuffer()],
      this.programId
    );
    return pda;
  }

  /**
   * Get vault PDA for a pool
   */
  getVaultPDA(pool: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SEEDS.VAULT, pool.toBuffer()],
      this.programId
    );
    return pda;
  }

  /**
   * Get deposit PDA
   */
  getDepositPDA(pool: PublicKey, leafIndex: bigint): PublicKey {
    const leafIndexBuffer = Buffer.alloc(8);
    leafIndexBuffer.writeBigUInt64LE(leafIndex);
    const [pda] = PublicKey.findProgramAddressSync(
      [SEEDS.DEPOSIT, pool.toBuffer(), leafIndexBuffer],
      this.programId
    );
    return pda;
  }

  /**
   * Get nullifier PDA
   */
  getNullifierPDA(pool: PublicKey, nullifier: Uint8Array): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [SEEDS.NULLIFIER, pool.toBuffer(), Buffer.from(nullifier)],
      this.programId
    );
    return pda;
  }

  // =========================================================================
  // Read operations
  // =========================================================================

  /**
   * Get pool information
   */
  async getPool(poolOrMint: PublicKey): Promise<PoolInfo | null> {
    // Try to fetch directly first
    let poolAddress = poolOrMint;
    let accountInfo = await this.connection.getAccountInfo(poolAddress);
    
    // If not found, try as mint
    if (!accountInfo || accountInfo.owner.toString() !== this.programId.toString()) {
      poolAddress = this.getPoolPDA(poolOrMint);
      accountInfo = await this.connection.getAccountInfo(poolAddress);
    }
    
    if (!accountInfo) return null;

    const data = accountInfo.data;
    // Skip 8-byte Anchor discriminator
    let offset = 8;
    
    const admin = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const tokenMint = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const vault = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const merkleRoot = data.slice(offset, offset + 32); offset += 32;
    const leafCount = data.readBigUInt64LE(offset); offset += 8;
    const minDeposit = data.readBigUInt64LE(offset); offset += 8;
    const maxRelayerFeeBps = data.readUInt16LE(offset); offset += 2;
    const paused = data[offset] === 1;

    return {
      address: poolAddress,
      admin,
      tokenMint,
      vault,
      merkleRoot: new Uint8Array(merkleRoot),
      leafCount,
      minDeposit,
      maxRelayerFeeBps,
      paused,
    };
  }

  /**
   * Get deposit information
   */
  async getDeposit(depositAddress: PublicKey): Promise<DepositInfo | null> {
    const accountInfo = await this.connection.getAccountInfo(depositAddress);
    if (!accountInfo) return null;

    const data = accountInfo.data;
    // Skip 8-byte Anchor discriminator
    let offset = 8;
    
    const pool = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const commitment = data.slice(offset, offset + 32); offset += 32;
    const amount = data.readBigUInt64LE(offset); offset += 8;
    const leafIndex = data.readBigUInt64LE(offset); offset += 8;
    const claimed = data[offset] === 1;

    return {
      address: depositAddress,
      pool,
      commitment: new Uint8Array(commitment),
      amount,
      leafIndex,
      claimed,
    };
  }

  /**
   * Check if nullifier has been used
   */
  async isNullifierUsed(pool: PublicKey, nullifier: Uint8Array): Promise<boolean> {
    const pda = this.getNullifierPDA(pool, nullifier);
    const accountInfo = await this.connection.getAccountInfo(pda);
    return accountInfo !== null;
  }

  // =========================================================================
  // Write operations
  // =========================================================================

  /**
   * Deposit tokens to a pool
   */
  async deposit(params: DepositParams): Promise<{ signature: string; depositAddress: PublicKey }> {
    const pool = await this.getPool(params.pool);
    if (!pool) throw new Error('Pool not found');

    const depositAddress = this.getDepositPDA(params.pool, pool.leafCount);
    const vault = this.getVaultPDA(params.pool);

    const ix = this.buildDepositIx(
      params.pool,
      depositAddress,
      vault,
      params.depositorTokenAccount,
      params.amount,
      params.commitment
    );

    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);

    return { signature, depositAddress };
  }

  /**
   * Claim tokens from a deposit
   */
  async claim(params: ClaimParams): Promise<string> {
    const pool = await this.getPool(params.pool);
    if (!pool) throw new Error('Pool not found');

    const vault = this.getVaultPDA(params.pool);
    const nullifierPDA = this.getNullifierPDA(params.pool, params.nullifier);

    const ix = this.buildClaimIx(
      params.pool,
      params.deposit,
      params.verifierBuffer,
      nullifierPDA,
      vault,
      params.recipientTokenAccount,
      params.relayerFee ?? 0n,
      params.nullifier
    );

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
  }

  // =========================================================================
  // Instruction builders
  // =========================================================================

  private buildDepositIx(
    pool: PublicKey,
    deposit: PublicKey,
    vault: PublicKey,
    depositorToken: PublicKey,
    amount: bigint,
    commitment: Uint8Array
  ): TransactionInstruction {
    // Anchor discriminator for "deposit"
    const discriminator = Buffer.from([0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6]);
    const data = Buffer.alloc(8 + 8 + 32);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    Buffer.from(commitment).copy(data, 16);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: deposit, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: depositorToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  private buildClaimIx(
    pool: PublicKey,
    deposit: PublicKey,
    verifierBuffer: PublicKey,
    nullifierRecord: PublicKey,
    vault: PublicKey,
    recipientToken: PublicKey,
    relayerFee: bigint,
    nullifier: Uint8Array
  ): TransactionInstruction {
    // Anchor discriminator for "claim"
    const discriminator = Buffer.from([0x3e, 0xc6, 0xd6, 0xc1, 0xd5, 0x79, 0xda, 0xb5]);
    const data = Buffer.alloc(8 + 8 + 32);
    discriminator.copy(data, 0);
    data.writeBigUInt64LE(relayerFee, 8);
    Buffer.from(nullifier).copy(data, 16);

    // Relayer token account (same as recipient for self-claim)
    const relayerToken = recipientToken;

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: false },
        { pubkey: deposit, isSigner: false, isWritable: true },
        { pubkey: verifierBuffer, isSigner: false, isWritable: false },
        { pubkey: nullifierRecord, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: recipientToken, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: relayerToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }
}
