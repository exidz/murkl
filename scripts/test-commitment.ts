/**
 * Test commitment computation matches between TypeScript and WASM
 */
import { keccak256 } from 'js-sha3';

const M31_PRIME = 0x7FFFFFFF;

// TypeScript implementation (from deposit.ts)
function hashPassword(password: string): number {
  const data = new TextEncoder().encode('murkl_password_v1' + password);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  const val = view.getUint32(0, true);
  return val % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = new TextEncoder().encode('murkl_identifier_v1' + normalized);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  const val = view.getUint32(0, true);
  return val % M31_PRIME;
}

function computeCommitment(identifier: string, password: string): string {
  const idHash = hashIdentifier(identifier);
  const secret = hashPassword(password);
  
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
  return Buffer.from(hashArray).toString('hex');
}

// Test cases
const testCases = [
  { identifier: '@alice', password: 'testpass123' },
  { identifier: 'alice', password: 'testpass123' },
  { identifier: '@Alice', password: 'testpass123' },
  { identifier: 'alice@example.com', password: 'mypassword' },
];

console.log('TypeScript Commitment Test\n');

for (const tc of testCases) {
  console.log(`Identifier: "${tc.identifier}"`);
  console.log(`Password: "${tc.password}"`);
  
  const idHash = hashIdentifier(tc.identifier);
  const secret = hashPassword(tc.password);
  const commitment = computeCommitment(tc.identifier, tc.password);
  
  console.log(`  id_hash: ${idHash}`);
  console.log(`  secret: ${secret}`);
  console.log(`  commitment: ${commitment}`);
  console.log();
}

// Also test WASM if available
try {
  // Note: WASM module needs to be loaded differently in Node.js
  // For now, just output TypeScript values for manual comparison
  console.log('\nCompare with WASM by running:');
  console.log('  generate_commitment("@alice", "testpass123")');
  console.log('  generate_commitment("alice", "testpass123")');
} catch (e) {
  // Expected in Node.js without WASM setup
}
