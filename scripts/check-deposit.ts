/**
 * Check deposit commitment on-chain and compare with computed values
 */
import { Connection, PublicKey } from '@solana/web3.js';
import { keccak256 } from 'js-sha3';

const M31_PRIME = 0x7FFFFFFF;
const PROGRAM_ID = new PublicKey('muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const POOL_ADDRESS = new PublicKey('8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ');

// Get leaf index from command line or default to 0
const leafIndex = parseInt(process.argv[2] || '0', 10);

function hashPassword(password: string): number {
  const data = new TextEncoder().encode('murkl_password_v1' + password);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  return view.getUint32(0, true) % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = new TextEncoder().encode('murkl_identifier_v1' + normalized);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  return view.getUint32(0, true) % M31_PRIME;
}

function computeCommitment(identifier: string, password: string): Buffer {
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
  return Buffer.from(hashArray);
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // Derive deposit PDA
  const leafIndexBuffer = Buffer.alloc(8);
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex));
  
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), POOL_ADDRESS.toBuffer(), leafIndexBuffer],
    PROGRAM_ID
  );
  
  console.log(`Checking deposit at leaf index ${leafIndex}`);
  console.log(`Deposit PDA: ${depositPda.toBase58()}`);
  
  // Fetch deposit account
  const accountInfo = await connection.getAccountInfo(depositPda);
  
  if (!accountInfo) {
    console.log('\nDeposit not found!');
    return;
  }
  
  // Parse deposit account
  // Layout: [8 discriminator][32 pool][32 commitment][8 amount][8 leaf_index][1 claimed][1 bump]
  const data = accountInfo.data;
  const pool = new PublicKey(data.slice(8, 40));
  const commitment = data.slice(40, 72);
  const amount = data.readBigUInt64LE(72);
  const storedLeafIndex = Number(data.readBigUInt64LE(80));
  const claimed = data[88] === 1;
  const bump = data[89];
  
  console.log('\n=== On-chain deposit ===');
  console.log(`Pool: ${pool.toBase58()}`);
  console.log(`Commitment: ${commitment.toString('hex')}`);
  console.log(`Amount: ${Number(amount) / 1e9} SOL`);
  console.log(`Leaf index: ${storedLeafIndex}`);
  console.log(`Claimed: ${claimed}`);
  
  // Test different identifier/password combinations
  console.log('\n=== Testing commitment matches ===');
  
  const testCases = [
    { identifier: '@alice', password: 'testpass123' },
    { identifier: 'alice', password: 'testpass123' },
    { identifier: '@exidz', password: 'testpass123' },
    { identifier: 'exidz', password: 'testpass123' },
  ];
  
  for (const tc of testCases) {
    const computed = computeCommitment(tc.identifier, tc.password);
    const matches = computed.equals(commitment);
    console.log(`\n"${tc.identifier}" + "${tc.password}"`);
    console.log(`  Computed: ${computed.toString('hex')}`);
    console.log(`  Matches: ${matches ? '✅ YES' : '❌ NO'}`);
  }
}

main().catch(console.error);
