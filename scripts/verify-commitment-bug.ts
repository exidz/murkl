/**
 * Verify the commitment bug in fresh-e2e.ts
 */
import { keccak256 } from 'js-sha3';

const M31_PRIME = 0x7FFFFFFF;

function hashPassword(password: string): number {
  const data = Buffer.concat([Buffer.from('murkl_password_v1'), Buffer.from(password)]);
  const hash = Buffer.from(keccak256(data), 'hex');
  return hash.readUInt32LE(0) % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = Buffer.concat([Buffer.from('murkl_identifier_v1'), Buffer.from(normalized)]);
  const hash = Buffer.from(keccak256(data), 'hex');
  return hash.readUInt32LE(0) % M31_PRIME;
}

// BUGGY version (from fresh-e2e.ts) - missing domain prefix
function computeCommitmentBuggy(identifierHash: number, secretHash: number): Buffer {
  const data = Buffer.alloc(8);
  data.writeUInt32LE(identifierHash, 0);
  data.writeUInt32LE(secretHash, 4);
  return Buffer.from(keccak256(data), 'hex');
}

// CORRECT version (from deposit.ts / WASM) - with domain prefix
function computeCommitmentCorrect(identifierHash: number, secretHash: number): Buffer {
  const prefix = Buffer.from('murkl_m31_hash_v1');
  const data = Buffer.alloc(prefix.length + 8);
  prefix.copy(data, 0);
  data.writeUInt32LE(identifierHash, prefix.length);
  data.writeUInt32LE(secretHash, prefix.length + 4);
  return Buffer.from(keccak256(data), 'hex');
}

// On-chain commitment from leaf 1-5
const onchainCommitment = '01537e5a9ebd0f850f42fd2dad5bd44977a28b5372c21ae65268e5bce929f6bc';

console.log('Testing commitment computation...\n');

// Test a few common identifiers
const testCases = [
  { identifier: 'e2e_test', password: 'testpass123' },
  { identifier: '@e2e_test', password: 'testpass123' },
  { identifier: 'test', password: 'testpass123' },
  { identifier: '@test', password: 'testpass123' },
  { identifier: 'e2e', password: 'password' },
  { identifier: '@alice', password: 'testpass123' },
];

for (const tc of testCases) {
  const idHash = hashIdentifier(tc.identifier);
  const secret = hashPassword(tc.password);
  
  const buggy = computeCommitmentBuggy(idHash, secret);
  const correct = computeCommitmentCorrect(idHash, secret);
  
  const buggyMatches = buggy.toString('hex') === onchainCommitment;
  const correctMatches = correct.toString('hex') === onchainCommitment;
  
  if (buggyMatches || correctMatches) {
    console.log(`🎯 MATCH FOUND!`);
    console.log(`   Identifier: "${tc.identifier}"`);
    console.log(`   Password: "${tc.password}"`);
    console.log(`   Buggy matches: ${buggyMatches}`);
    console.log(`   Correct matches: ${correctMatches}`);
    console.log();
  }
}

// Also show what the buggy vs correct outputs look like for one example
console.log('\nComparison for "@alice" + "testpass123":');
const idHash = hashIdentifier('@alice');
const secret = hashPassword('testpass123');
console.log(`  id_hash: ${idHash}`);
console.log(`  secret: ${secret}`);
console.log(`  Buggy:   ${computeCommitmentBuggy(idHash, secret).toString('hex')}`);
console.log(`  Correct: ${computeCommitmentCorrect(idHash, secret).toString('hex')}`);
console.log(`  On-chain: ${onchainCommitment}`);
