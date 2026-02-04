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

function computeCommitment(identifier: string, password: string): string {
  const idHash = hashIdentifier(identifier);
  const secret = hashPassword(password);
  
  const prefix = Buffer.from('murkl_m31_hash_v1');
  const idBuf = Buffer.alloc(4);
  const secretBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(idHash, 0);
  secretBuf.writeUInt32LE(secret, 0);
  
  const data = Buffer.concat([prefix, idBuf, secretBuf]);
  return Buffer.from(keccak256(data), 'hex').toString('hex');
}

// Test the E2E credentials
const identifier = '@e2e-1770205991230';
const password = 'e2e-test-password-123';
const onchain = '433eb88de690969948462fea8e41877fb203913bebebf1a5a47025d48734bb0d';

const computed = computeCommitment(identifier, password);
console.log('Identifier:', identifier);
console.log('Password:', password);
console.log('Computed:', computed);
console.log('On-chain:', onchain);
console.log('Match:', computed === onchain ? '✅ YES' : '❌ NO');
