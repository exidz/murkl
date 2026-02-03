/**
 * Make a test deposit
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import * as fs from 'fs';
import sha3 from 'js-sha3';
const { keccak256 } = sha3;
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const M31_PRIME = 0x7FFFFFFF;

// Hash functions using KECCAK256 (matching WASM prover!)
function hashPassword(password: string): number {
  const data = Buffer.concat([
    Buffer.from('murkl_password_v1'),
    Buffer.from(password)
  ]);
  const hash = Buffer.from(keccak256(data), 'hex');
  const val = hash.readUInt32LE(0);
  return val % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = Buffer.concat([
    Buffer.from('murkl_identifier_v1'),
    Buffer.from(normalized)
  ]);
  const hash = Buffer.from(keccak256(data), 'hex');
  const val = hash.readUInt32LE(0);
  return val % M31_PRIME;
}

function computeCommitment(idHash: number, secret: number): Buffer {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(idHash, 0);
  const secretBuf = Buffer.alloc(4);
  secretBuf.writeUInt32LE(secret, 0);
  
  const data = Buffer.concat([
    Buffer.from('murkl_m31_hash_v1'),
    idBuf,
    secretBuf
  ]);
  
  return Buffer.from(keccak256(data), 'hex');
}

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  const identifier = process.argv[2] || '@alice';
  const password = process.argv[3] || 'testpassword123';
  const amount = parseInt(process.argv[4] || '100') * 1_000_000_000; // 9 decimals
  
  console.log('🐈‍⬛ Making test deposit\n');
  
  // Load pool info
  const poolData = JSON.parse(fs.readFileSync('/tmp/murkl-pool.json', 'utf-8'));
  const connection = new Connection(poolData.rpc, 'confirmed');
  
  // Load wallet
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const depositor = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Depositor: ${depositor.publicKey.toBase58()}`);
  console.log(`📦 Pool: ${poolData.pool}`);
  
  // Compute commitment
  const idHash = hashIdentifier(identifier);
  const secret = hashPassword(password);
  const commitment = computeCommitment(idHash, secret);
  
  console.log(`\n🔐 Commitment details:`);
  console.log(`   Identifier: ${identifier}`);
  console.log(`   ID Hash: ${idHash}`);
  console.log(`   Secret: ${secret}`);
  console.log(`   Commitment: 0x${commitment.toString('hex').slice(0, 16)}...`);
  
  // Get pool to find next leaf index
  const pool = new PublicKey(poolData.pool);
  const poolInfo = await connection.getAccountInfo(pool);
  if (!poolInfo) {
    console.log('❌ Pool not found');
    return;
  }
  
  // Parse next_leaf_index (offset: 8 discriminator + 32 authority + 32 mint + 32 vault + 32 root = 136, then 4 bytes)
  const nextLeafIndex = poolInfo.data.readUInt32LE(136);
  console.log(`   Leaf Index: ${nextLeafIndex}`);
  
  // Derive deposit PDA
  const leafIndexBuffer = Buffer.alloc(4);
  leafIndexBuffer.writeUInt32LE(nextLeafIndex);
  
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), pool.toBuffer(), leafIndexBuffer],
    PROGRAM_ID
  );
  console.log(`   Deposit PDA: ${depositPda.toBase58()}`);
  
  // Build deposit instruction
  const discriminator = getDiscriminator('deposit');
  
  const instructionData = Buffer.concat([
    discriminator,
    commitment,
    Buffer.alloc(8)
  ]);
  instructionData.writeBigUInt64LE(BigInt(amount), discriminator.length + 32);
  
  const vault = new PublicKey(poolData.vault);
  const userAta = new PublicKey(poolData.userAta);
  
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: depositor.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data: instructionData
  });
  
  const tx = new Transaction().add(ix);
  
  console.log('\n🚀 Sending deposit transaction...');
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [depositor]);
    console.log(`   ✅ Deposited! Signature: ${sig}`);
    
    // Save deposit info
    const depositInfo = {
      identifier,
      password,
      commitment: commitment.toString('hex'),
      leafIndex: nextLeafIndex,
      amount: amount / 1_000_000_000,
      depositPda: depositPda.toBase58(),
      pool: poolData.pool,
      signature: sig,
    };
    
    fs.writeFileSync('/tmp/murkl-deposit.json', JSON.stringify(depositInfo, null, 2));
    console.log('\n📄 Deposit info saved to /tmp/murkl-deposit.json');
    
    console.log('\n════════════════════════════════════════');
    console.log('📊 DEPOSIT COMPLETE');
    console.log('════════════════════════════════════════');
    console.log(`Identifier: ${identifier}`);
    console.log(`Password:   ${password}`);
    console.log(`Amount:     ${amount / 1_000_000_000} tokens`);
    console.log(`Leaf Index: ${nextLeafIndex}`);
    console.log('════════════════════════════════════════');
    console.log('\n🎉 Now claim in the web UI!');
    console.log(`   Identifier: ${identifier}`);
    console.log(`   Password: ${password}`);
    console.log(`   Leaf Index: ${nextLeafIndex}`);
    
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
    if (e.logs) {
      console.log('\n   Logs:');
      e.logs.forEach((log: string) => console.log(`      ${log}`));
    }
  }
}

main().catch(console.error);
