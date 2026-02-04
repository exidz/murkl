import { PublicKey, Connection, AccountInfo } from '@solana/web3.js';
import { VERIFIER_BUFFER_LAYOUT, VERIFIER_BUFFER_HEADER_SIZE } from './constants';
import type { ProofBufferState } from './types';

/**
 * Layout for reading proof buffer data
 */
export const ProofBufferLayout = {
  /**
   * Get owner from buffer data
   */
  getOwner(data: Uint8Array): PublicKey {
    return new PublicKey(data.slice(VERIFIER_BUFFER_LAYOUT.OWNER, VERIFIER_BUFFER_LAYOUT.OWNER + 32));
  },

  /**
   * Get current size from buffer data
   */
  getSize(data: Uint8Array): number {
    const view = new DataView(data.buffer, data.byteOffset + VERIFIER_BUFFER_LAYOUT.SIZE, 4);
    return view.getUint32(0, true);
  },

  /**
   * Get expected size from buffer data
   */
  getExpectedSize(data: Uint8Array): number {
    const view = new DataView(data.buffer, data.byteOffset + VERIFIER_BUFFER_LAYOUT.EXPECTED_SIZE, 4);
    return view.getUint32(0, true);
  },

  /**
   * Check if buffer is finalized
   */
  isFinalized(data: Uint8Array): boolean {
    return data[VERIFIER_BUFFER_LAYOUT.FINALIZED] === 1;
  },

  /**
   * Get commitment (only valid if finalized)
   */
  getCommitment(data: Uint8Array): Uint8Array {
    return data.slice(VERIFIER_BUFFER_LAYOUT.COMMITMENT, VERIFIER_BUFFER_LAYOUT.COMMITMENT + 32);
  },

  /**
   * Get nullifier (only valid if finalized)
   */
  getNullifier(data: Uint8Array): Uint8Array {
    return data.slice(VERIFIER_BUFFER_LAYOUT.NULLIFIER, VERIFIER_BUFFER_LAYOUT.NULLIFIER + 32);
  },

  /**
   * Get merkle root (only valid if finalized)
   */
  getMerkleRoot(data: Uint8Array): Uint8Array {
    return data.slice(VERIFIER_BUFFER_LAYOUT.MERKLE_ROOT, VERIFIER_BUFFER_LAYOUT.MERKLE_ROOT + 32);
  },

  /**
   * Get proof data (only valid if finalized)
   */
  getProofData(data: Uint8Array): Uint8Array {
    const size = ProofBufferLayout.getSize(data);
    return data.slice(VERIFIER_BUFFER_LAYOUT.PROOF_DATA, VERIFIER_BUFFER_LAYOUT.PROOF_DATA + size);
  },
};

/**
 * Proof buffer helper class
 */
export class ProofBuffer {
  constructor(
    public readonly address: PublicKey,
    public readonly data: Uint8Array
  ) {}

  /**
   * Fetch proof buffer from chain
   */
  static async fetch(
    connection: Connection,
    address: PublicKey
  ): Promise<ProofBuffer | null> {
    const accountInfo = await connection.getAccountInfo(address);
    if (!accountInfo) return null;
    return new ProofBuffer(address, accountInfo.data);
  }

  /**
   * Get buffer state
   */
  get state(): ProofBufferState {
    const finalized = this.isFinalized;
    return {
      address: this.address,
      owner: this.owner,
      size: this.size,
      expectedSize: this.expectedSize,
      finalized,
      commitment: finalized ? this.commitment : undefined,
      nullifier: finalized ? this.nullifier : undefined,
      merkleRoot: finalized ? this.merkleRoot : undefined,
    };
  }

  get owner(): PublicKey {
    return ProofBufferLayout.getOwner(this.data);
  }

  get size(): number {
    return ProofBufferLayout.getSize(this.data);
  }

  get expectedSize(): number {
    return ProofBufferLayout.getExpectedSize(this.data);
  }

  get isFinalized(): boolean {
    return ProofBufferLayout.isFinalized(this.data);
  }

  get commitment(): Uint8Array {
    return ProofBufferLayout.getCommitment(this.data);
  }

  get nullifier(): Uint8Array {
    return ProofBufferLayout.getNullifier(this.data);
  }

  get merkleRoot(): Uint8Array {
    return ProofBufferLayout.getMerkleRoot(this.data);
  }

  get proofData(): Uint8Array {
    return ProofBufferLayout.getProofData(this.data);
  }

  /**
   * Check if buffer is complete (all data uploaded)
   */
  get isComplete(): boolean {
    return this.size === this.expectedSize;
  }

  /**
   * Get upload progress (0-100)
   */
  get progress(): number {
    if (this.expectedSize === 0) return 100;
    return Math.round((this.size / this.expectedSize) * 100);
  }

  /**
   * Verify public inputs match expected values
   */
  verifyPublicInputs(
    commitment: Uint8Array,
    nullifier: Uint8Array,
    merkleRoot: Uint8Array
  ): boolean {
    if (!this.isFinalized) return false;
    
    const commitmentMatch = this.commitment.every((b, i) => b === commitment[i]);
    const nullifierMatch = this.nullifier.every((b, i) => b === nullifier[i]);
    const merkleRootMatch = this.merkleRoot.every((b, i) => b === merkleRoot[i]);
    
    return commitmentMatch && nullifierMatch && merkleRootMatch;
  }
}
