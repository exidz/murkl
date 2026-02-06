/**
 * Setup WSOL pool on devnet
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
// Prefer passing a private RPC via RPC_URL env var. Default to public Solana devnet.
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('🐈‍⬛ Setting up Murkl WSOL pool on devnet\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load wallet
  const walletPath = process.env.WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Authority: ${authority.publicKey.toBase58()}`);
  
  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 0.1 * LAMPORTS_PER_SOL) {
    console.log('❌ Insufficient SOL. Please fund your wallet.');
    return;
  }
  
  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), WSOL_MINT.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPda.toBuffer()],
    PROGRAM_ID
  );
  
  console.log(`\n📍 WSOL Mint: ${WSOL_MINT.toBase58()}`);
  console.log(`📍 Pool PDA: ${poolPda.toBase58()}`);
  console.log(`📍 Vault PDA: ${vaultPda.toBase58()}`);
  
  // Check if pool already exists
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log(`\n✅ WSOL Pool already exists (${poolInfo.data.length} bytes)`);
    if (poolInfo.data.length === 156) {
      console.log('   ✅ Size matches current program!');
    } else {
      console.log(`   ⚠️  Size mismatch: expected 156, got ${poolInfo.data.length}`);
    }
    return;
  }
  
  // Initialize pool
  console.log('\n🚀 Initializing WSOL pool...');
  
  const discriminator = getDiscriminator('initialize_pool');
  
  // PoolConfig: min_deposit (u64) + max_relayer_fee_bps (u16)
  const configData = Buffer.alloc(10);
  configData.writeBigUInt64LE(BigInt(1000000), 0); // min_deposit = 0.001 WSOL (1M lamports)
  configData.writeUInt16LE(100, 8); // max_relayer_fee_bps = 100 (1%)
  
  const instructionData = Buffer.concat([discriminator, configData]);
  
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: instructionData
  });
  
  const tx = new Transaction().add(ix);
  
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { skipPreflight: true });
    console.log(`\n✅ WSOL Pool initialized!`);
    console.log(`   Transaction: ${sig}`);
    console.log(`   Pool: ${poolPda.toBase58()}`);
    
    // Verify
    const newPoolInfo = await connection.getAccountInfo(poolPda);
    if (newPoolInfo) {
      console.log(`   Size: ${newPoolInfo.data.length} bytes`);
    }
    
    console.log(`\n📋 Update web/src/lib/constants.ts with:`);
    console.log(`   POOL_ADDRESS: '${poolPda.toBase58()}'`);
  } catch (e: any) {
    console.log(`❌ Error: ${e.message}`);
    if (e.logs) {
      console.log('\nLogs:');
      e.logs.forEach((log: string) => console.log(`   ${log}`));
    }
  }
}

main().catch(console.error);
