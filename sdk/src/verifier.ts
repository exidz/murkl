import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Signer,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { 
  STARK_VERIFIER_PROGRAM_ID, 
  VERIFIER_BUFFER_HEADER_SIZE,
  DEFAULT_CHUNK_SIZE,
  MAX_PROOF_SIZE,
} from './constants';
import { ProofBuffer } from './buffer';
import type { ProofParams, ProofBufferState } from './types';

/**
 * Client for interacting with the STARK verifier program
 */
export class StarkVerifier {
  readonly connection: Connection;
  readonly wallet: Signer;
  readonly programId: PublicKey;

  constructor(
    connection: Connection,
    wallet: Signer,
    programId: PublicKey = STARK_VERIFIER_PROGRAM_ID
  ) {
    this.connection = connection;
    this.wallet = wallet;
    this.programId = programId;
  }

  /**
   * Create and initialize a proof buffer
   */
  async createBuffer(
    proofSize: number,
    bufferKeypair?: Keypair
  ): Promise<{ address: PublicKey; keypair: Keypair }> {
    if (proofSize > MAX_PROOF_SIZE) {
      throw new Error(`Proof size ${proofSize} exceeds maximum ${MAX_PROOF_SIZE}`);
    }

    const keypair = bufferKeypair ?? Keypair.generate();
    const bufferSize = VERIFIER_BUFFER_HEADER_SIZE + proofSize;
    
    const lamports = await this.connection.getMinimumBalanceForRentExemption(bufferSize);
    
    // Create account
    const createIx = SystemProgram.createAccount({
      fromPubkey: this.wallet.publicKey,
      newAccountPubkey: keypair.publicKey,
      lamports,
      space: bufferSize,
      programId: this.programId,
    });

    // Initialize buffer
    const initIx = this.buildInitBufferIx(keypair.publicKey, proofSize);

    const tx = new Transaction().add(createIx, initIx);
    await sendAndConfirmTransaction(this.connection, tx, [this.wallet, keypair]);

    return { address: keypair.publicKey, keypair };
  }

  /**
   * Upload proof data in chunks
   */
  async uploadProof(
    bufferAddress: PublicKey,
    proofData: Uint8Array,
    chunkSize: number = DEFAULT_CHUNK_SIZE,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    let offset = 0;
    while (offset < proofData.length) {
      const chunk = proofData.slice(offset, offset + chunkSize);
      const ix = this.buildUploadChunkIx(bufferAddress, offset, chunk);
      
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
      
      offset += chunk.length;
      onProgress?.(Math.round((offset / proofData.length) * 100));
    }
  }

  /**
   * Finalize and verify the proof
   */
  async finalizeAndVerify(
    bufferAddress: PublicKey,
    commitment: Uint8Array,
    nullifier: Uint8Array,
    merkleRoot: Uint8Array
  ): Promise<void> {
    const ix = this.buildFinalizeIx(bufferAddress, commitment, nullifier, merkleRoot);
    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
  }

  /**
   * Upload and verify proof in one operation
   */
  async uploadAndVerify(
    params: ProofParams,
    chunkSize: number = DEFAULT_CHUNK_SIZE,
    onProgress?: (stage: 'creating' | 'uploading' | 'verifying', percent: number) => void
  ): Promise<{ bufferAddress: PublicKey; bufferKeypair: Keypair }> {
    onProgress?.('creating', 0);
    
    // Create buffer
    const { address, keypair } = await this.createBuffer(params.proof.length);
    onProgress?.('creating', 100);

    // Upload proof
    await this.uploadProof(address, params.proof, chunkSize, (percent) => {
      onProgress?.('uploading', percent);
    });

    // Verify
    onProgress?.('verifying', 0);
    await this.finalizeAndVerify(address, params.commitment, params.nullifier, params.merkleRoot);
    onProgress?.('verifying', 100);

    return { bufferAddress: address, bufferKeypair: keypair };
  }

  /**
   * Close a proof buffer and reclaim rent
   */
  async closeBuffer(bufferAddress: PublicKey): Promise<void> {
    const ix = this.buildCloseBufferIx(bufferAddress);
    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
  }

  /**
   * Get buffer state
   */
  async getBufferState(bufferAddress: PublicKey): Promise<ProofBufferState | null> {
    const buffer = await ProofBuffer.fetch(this.connection, bufferAddress);
    return buffer?.state ?? null;
  }

  // =========================================================================
  // Instruction builders
  // =========================================================================

  private buildInitBufferIx(buffer: PublicKey, expectedSize: number): TransactionInstruction {
    // Anchor discriminator for "init_proof_buffer"
    const discriminator = Buffer.from([0x8d, 0x96, 0xbb, 0x8e, 0x5d, 0x4b, 0x6c, 0x5f]);
    const data = Buffer.alloc(12);
    discriminator.copy(data, 0);
    data.writeUInt32LE(expectedSize, 8);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  private buildUploadChunkIx(
    buffer: PublicKey,
    offset: number,
    chunkData: Uint8Array
  ): TransactionInstruction {
    // Anchor discriminator for "upload_chunk"
    const discriminator = Buffer.from([0xd4, 0x4d, 0x99, 0x3a, 0x1c, 0x2d, 0x4e, 0x5f]);
    const data = Buffer.alloc(16 + chunkData.length);
    discriminator.copy(data, 0);
    data.writeUInt32LE(offset, 8);
    data.writeUInt32LE(chunkData.length, 12);
    Buffer.from(chunkData).copy(data, 16);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });
  }

  private buildFinalizeIx(
    buffer: PublicKey,
    commitment: Uint8Array,
    nullifier: Uint8Array,
    merkleRoot: Uint8Array
  ): TransactionInstruction {
    // Anchor discriminator for "finalize_and_verify"
    const discriminator = Buffer.from([0x5a, 0x7b, 0x8c, 0x9d, 0x0e, 0x1f, 0x2a, 0x3b]);
    const data = Buffer.alloc(8 + 96);
    discriminator.copy(data, 0);
    Buffer.from(commitment).copy(data, 8);
    Buffer.from(nullifier).copy(data, 40);
    Buffer.from(merkleRoot).copy(data, 72);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });
  }

  private buildCloseBufferIx(buffer: PublicKey): TransactionInstruction {
    // Anchor discriminator for "close_proof_buffer"
    const discriminator = Buffer.from([0x6e, 0x7f, 0x8a, 0x9b, 0xac, 0xbd, 0xce, 0xdf]);
    
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
      ],
      data: discriminator,
    });
  }
}
