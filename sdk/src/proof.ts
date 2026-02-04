/**
 * Proof serialization matching STWO-compatible on-chain verifier format
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { M31, QM31 } from './types';

/**
 * Proof structure matching on-chain verifier
 */
export interface STWOProof {
  traceCommitment: Uint8Array;      // 32 bytes
  compositionCommitment: Uint8Array; // 32 bytes
  traceOods: Uint8Array;            // 16 bytes (QM31)
  compositionOods: Uint8Array;      // 16 bytes (QM31)
  friLayers: FriLayer[];
  finalPoly: Uint8Array;
  queries: QueryProof[];
}

export interface FriLayer {
  commitment: Uint8Array;  // 32 bytes
}

export interface QueryProof {
  index: number;
  traceValue: Uint8Array;         // 32 bytes
  tracePath: Uint8Array[];        // Array of 32-byte nodes
  compositionValue: Uint8Array;   // 32 bytes
  compositionPath: Uint8Array[];  // Array of 32-byte nodes
}

/**
 * Serialize proof to bytes for on-chain verification
 */
export function serializeProof(proof: STWOProof): Uint8Array {
  const parts: Uint8Array[] = [];

  // Trace commitment (32 bytes)
  parts.push(proof.traceCommitment);

  // Composition commitment (32 bytes)
  parts.push(proof.compositionCommitment);

  // Trace OODS (16 bytes)
  parts.push(proof.traceOods);

  // Composition OODS (16 bytes)
  parts.push(proof.compositionOods);

  // Number of FRI layers (1 byte)
  parts.push(new Uint8Array([proof.friLayers.length]));

  // FRI layer commitments
  for (const layer of proof.friLayers) {
    parts.push(layer.commitment);
  }

  // Final polynomial length (2 bytes, little-endian)
  const finalPolyLen = proof.finalPoly.length;
  parts.push(new Uint8Array([finalPolyLen & 0xff, (finalPolyLen >> 8) & 0xff]));

  // Final polynomial
  parts.push(proof.finalPoly);

  // Number of queries (1 byte)
  parts.push(new Uint8Array([proof.queries.length]));

  // Query proofs
  for (const query of proof.queries) {
    // Index (4 bytes, little-endian)
    const indexBytes = new Uint8Array(4);
    new DataView(indexBytes.buffer).setUint32(0, query.index, true);
    parts.push(indexBytes);

    // Trace value (32 bytes)
    parts.push(query.traceValue);

    // Trace path length (1 byte)
    parts.push(new Uint8Array([query.tracePath.length]));

    // Trace path nodes
    for (const node of query.tracePath) {
      parts.push(node);
    }

    // Composition value (32 bytes)
    parts.push(query.compositionValue);

    // Composition path length (1 byte)
    parts.push(new Uint8Array([query.compositionPath.length]));

    // Composition path nodes
    for (const node of query.compositionPath) {
      parts.push(node);
    }
  }

  // Concatenate all parts
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

/**
 * Parse proof from bytes
 */
export function parseProof(data: Uint8Array): STWOProof {
  let offset = 0;

  // Trace commitment (32 bytes)
  const traceCommitment = data.slice(offset, offset + 32);
  offset += 32;

  // Composition commitment (32 bytes)
  const compositionCommitment = data.slice(offset, offset + 32);
  offset += 32;

  // Trace OODS (16 bytes)
  const traceOods = data.slice(offset, offset + 16);
  offset += 16;

  // Composition OODS (16 bytes)
  const compositionOods = data.slice(offset, offset + 16);
  offset += 16;

  // Number of FRI layers
  const numFriLayers = data[offset];
  offset += 1;

  // FRI layers
  const friLayers: FriLayer[] = [];
  for (let i = 0; i < numFriLayers; i++) {
    friLayers.push({ commitment: data.slice(offset, offset + 32) });
    offset += 32;
  }

  // Final polynomial length
  const finalPolyLen = data[offset] | (data[offset + 1] << 8);
  offset += 2;

  // Final polynomial
  const finalPoly = data.slice(offset, offset + finalPolyLen);
  offset += finalPolyLen;

  // Number of queries
  const numQueries = data[offset];
  offset += 1;

  // Queries
  const queries: QueryProof[] = [];
  for (let i = 0; i < numQueries; i++) {
    // Index
    const index = new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true);
    offset += 4;

    // Trace value
    const traceValue = data.slice(offset, offset + 32);
    offset += 32;

    // Trace path
    const tracePathLen = data[offset];
    offset += 1;
    const tracePath: Uint8Array[] = [];
    for (let j = 0; j < tracePathLen; j++) {
      tracePath.push(data.slice(offset, offset + 32));
      offset += 32;
    }

    // Composition value
    const compositionValue = data.slice(offset, offset + 32);
    offset += 32;

    // Composition path
    const compPathLen = data[offset];
    offset += 1;
    const compositionPath: Uint8Array[] = [];
    for (let j = 0; j < compPathLen; j++) {
      compositionPath.push(data.slice(offset, offset + 32));
      offset += 32;
    }

    queries.push({
      index,
      traceValue,
      tracePath,
      compositionValue,
      compositionPath,
    });
  }

  return {
    traceCommitment,
    compositionCommitment,
    traceOods,
    compositionOods,
    friLayers,
    finalPoly,
    queries,
  };
}

/**
 * Generate a mock proof for testing
 */
export function generateMockProof(
  commitment: Uint8Array,
  nullifier: Uint8Array,
  merkleRoot: Uint8Array,
  options: {
    numFriLayers?: number;
    numQueries?: number;
    merkleDepth?: number;
  } = {}
): STWOProof {
  const {
    numFriLayers = 4,
    numQueries = 2,
    merkleDepth = 10,
  } = options;

  const keccak = (data: Uint8Array) => keccak_256(data);

  // Trace commitment (derived from public inputs)
  const traceCommitment = keccak(new Uint8Array([...commitment, ...nullifier]));

  // Composition commitment
  const compositionCommitment = keccak(new Uint8Array([...traceCommitment, ...merkleRoot]));

  // OODS values (QM31 = 4 M31 values = 16 bytes)
  const traceOods = keccak(new Uint8Array([...commitment, 0x01])).slice(0, 16);
  const compositionOods = keccak(new Uint8Array([...nullifier, 0x02])).slice(0, 16);

  // FRI layers
  const friLayers: FriLayer[] = [];
  for (let i = 0; i < numFriLayers; i++) {
    friLayers.push({
      commitment: keccak(new Uint8Array([...traceCommitment, i])),
    });
  }

  // Final polynomial
  const finalPoly = keccak(compositionCommitment).slice(0, 16);

  // Queries
  const queries: QueryProof[] = [];
  for (let q = 0; q < numQueries; q++) {
    const index = q * 1000;
    
    const traceValue = keccak(new Uint8Array([...traceCommitment, q, 0x10]));
    const tracePath: Uint8Array[] = [];
    for (let p = 0; p < merkleDepth; p++) {
      tracePath.push(keccak(new Uint8Array([...traceValue, p])));
    }

    const compositionValue = keccak(new Uint8Array([...compositionCommitment, q, 0x20]));
    const compositionPath: Uint8Array[] = [];
    for (let p = 0; p < merkleDepth; p++) {
      compositionPath.push(keccak(new Uint8Array([...compositionValue, p])));
    }

    queries.push({
      index,
      traceValue,
      tracePath,
      compositionValue,
      compositionPath,
    });
  }

  return {
    traceCommitment,
    compositionCommitment,
    traceOods,
    compositionOods,
    friLayers,
    finalPoly,
    queries,
  };
}

/**
 * Calculate proof size in bytes
 */
export function calculateProofSize(proof: STWOProof): number {
  let size = 0;
  size += 32; // trace commitment
  size += 32; // composition commitment
  size += 16; // trace OODS
  size += 16; // composition OODS
  size += 1;  // num FRI layers
  size += proof.friLayers.length * 32; // FRI layer commitments
  size += 2;  // final poly length
  size += proof.finalPoly.length; // final poly
  size += 1;  // num queries

  for (const query of proof.queries) {
    size += 4;  // index
    size += 32; // trace value
    size += 1;  // trace path length
    size += query.tracePath.length * 32; // trace path
    size += 32; // composition value
    size += 1;  // composition path length
    size += query.compositionPath.length * 32; // composition path
  }

  return size;
}
