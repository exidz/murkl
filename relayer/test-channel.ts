/**
 * Test script to verify Fiat-Shamir channel matches between WASM and on-chain verifier
 */
import { keccak256 } from 'js-sha3';

const M31_PRIME = 0x7FFFFFFF;

// Channel state (matches on-chain verifier)
class Channel {
  state: Buffer;
  counter: bigint;

  constructor() {
    this.state = Buffer.alloc(32);
    this.counter = 0n;
  }

  mixDigest(digest: Buffer) {
    const data = Buffer.concat([this.state, digest]);
    this.state = Buffer.from(keccak256(data), 'hex');
    this.counter++;
  }

  mixQM31(a: number, b: number, c: number, d: number) {
    const data = Buffer.alloc(48);
    this.state.copy(data, 0);
    data.writeUInt32LE(a, 32);
    data.writeUInt32LE(b, 36);
    data.writeUInt32LE(c, 40);
    data.writeUInt32LE(d, 44);
    this.state = Buffer.from(keccak256(data), 'hex');
    this.counter++;
  }

  squeezeM31(): number {
    const data = Buffer.alloc(40);
    this.state.copy(data, 0);
    data.writeBigUInt64LE(this.counter, 32);
    const hash = Buffer.from(keccak256(data), 'hex');
    this.state = hash;
    this.counter++;
    return hash.readUInt32LE(0) % M31_PRIME;
  }

  squeezeQM31(): [number, number, number, number] {
    return [this.squeezeM31(), this.squeezeM31(), this.squeezeM31(), this.squeezeM31()];
  }
}

// Test with known values
async function main() {
  const commitment = Buffer.from('a9d8886c6d205fc9675041e3f7e4d2d50ba0f0b5b7f1b0b184b37c91731892af', 'hex');
  const nullifier = Buffer.from('d54a432ea8cc4d1d213592ec2f836534aa648954f3002abaaae8af148194e44c', 'hex');
  const merkleRoot = Buffer.from('dfcdd6fec752fe5c62c6eb4b11b71a3507344201a8f2087564b3c1b2b83879a1', 'hex');

  // Compute trace commitment (same as WASM)
  const idM31 = 186592728; // for _Exidz_
  const secretM31 = 755500028; // for 12345678
  
  const traceData = Buffer.concat([
    Buffer.from('murkl_trace_v3'),
    Buffer.alloc(4),
    Buffer.alloc(4)
  ]);
  traceData.writeUInt32LE(idM31, 14);
  traceData.writeUInt32LE(secretM31, 18);
  const traceCommitment = Buffer.from(keccak256(traceData), 'hex');
  
  console.log('=== Channel State Trace ===');
  console.log('Trace commitment:', traceCommitment.toString('hex').slice(0, 16) + '...');
  
  // Composition commitment
  const compData = Buffer.concat([
    Buffer.from('murkl_composition_v3'),
    traceCommitment
  ]);
  const compositionCommitment = Buffer.from(keccak256(compData), 'hex');
  console.log('Composition commitment:', compositionCommitment.toString('hex').slice(0, 16) + '...');

  // Now run channel
  const channel = new Channel();
  
  // Mix public inputs
  channel.mixDigest(commitment);
  console.log('After mix commitment:', channel.state.toString('hex').slice(0, 16) + '...', 'counter:', channel.counter);
  
  channel.mixDigest(nullifier);
  console.log('After mix nullifier:', channel.state.toString('hex').slice(0, 16) + '...', 'counter:', channel.counter);
  
  channel.mixDigest(merkleRoot);
  console.log('After mix merkleRoot:', channel.state.toString('hex').slice(0, 16) + '...', 'counter:', channel.counter);
  
  // Mix trace commitment
  channel.mixDigest(traceCommitment);
  console.log('After mix trace:', channel.state.toString('hex').slice(0, 16) + '...', 'counter:', channel.counter);
  
  // Squeeze alpha
  const alpha = channel.squeezeQM31();
  console.log('Alpha (QM31):', alpha);
  
  // Mix composition commitment
  channel.mixDigest(compositionCommitment);
  console.log('After mix composition:', channel.state.toString('hex').slice(0, 16) + '...', 'counter:', channel.counter);
  
  // Squeeze OODS point
  const oodsPoint = channel.squeezeQM31();
  console.log('OODS point (QM31):', oodsPoint);
}

main().catch(console.error);
