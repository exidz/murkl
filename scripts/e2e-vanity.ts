/**
 * E2E test for vanity address deployment (WSOL pool)
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
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';

// NEW VANITY ADDRESS
const PROGRAM_ID = new PublicKey('muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const WSOL_POOL = new PublicKey('8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ');
const RPC_URL = 'https://api.devnet.solana.com';

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

function keccakHash(data: Buffer): Buffer {
  const { keccak256 } = require('js-sha3');
  return Buffer.from(keccak256.arrayBuffer(data));
}

const M31_PRIME = 0x7FFFFFFF;

function computeCommitment(identifier: string, password: string): Buffer {
  // Hash identifier
  const idData = Buffer.concat([Buffer.from('murkl_identifier_v1'), Buffer.from(identifier.toLowerCase())]);
  const idHash = keccakHash(idData).readUInt32LE(0) % M31_PRIME;
  
  // Hash password
  const pwData = Buffer.concat([Buffer.from('murkl_password_v1'), Buffer.from(password)]);
  const secret = keccakHash(pwData).readUInt32LE(0) % M31_PRIME;
  
  // Compute commitment
  const prefix = Buffer.from('murkl_m31_hash_v1');
  const idBuf = Buffer.alloc(4);
  const secretBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(idHash);
  secretBuf.writeUInt32LE(secret);
  
  return keccakHash(Buffer.concat([prefix, idBuf, secretBuf]));
}

async function main() {
  console.log('🐈‍⬛ E2E Test: Vanity Address WSOL Pool\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Payer: ${payer.publicKey.toBase58()}`);
  console.log(`📍 Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`📍 Pool: ${WSOL_POOL.toBase58()}`);
  
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  
  // Step 1: Fetch pool info
  console.log('📦 Step 1: Fetching pool info...');
  const poolInfo = await connection.getAccountInfo(WSOL_POOL);
  if (!poolInfo) throw new Error('Pool not found');
  
  console.log(`   Owner: ${poolInfo.owner.toBase58()}`);
  console.log(`   Size: ${poolInfo.data.length} bytes`);
  
  if (!poolInfo.owner.equals(PROGRAM_ID)) {
    throw new Error(`Pool owned by wrong program! Expected ${PROGRAM_ID.toBase58()}, got ${poolInfo.owner.toBase58()}`);
  }
  console.log('   ✅ Pool ownership verified\n');
  
  // Parse pool
  const data = poolInfo.data;
  const admin = new PublicKey(data.slice(8, 40));
  const mint = new PublicKey(data.slice(40, 72));
  const vault = new PublicKey(data.slice(72, 104));
  const leafCount = Number(data.readBigUInt64LE(136));
  
  console.log(`   Admin: ${admin.toBase58()}`);
  console.log(`   Mint: ${mint.toBase58()}`);
  console.log(`   Vault: ${vault.toBase58()}`);
  console.log(`   Leaf count: ${leafCount}`);
  
  if (!mint.equals(NATIVE_MINT)) {
    throw new Error('Pool is not WSOL!');
  }
  console.log('   ✅ WSOL pool confirmed\n');
  
  // Step 2: Prepare deposit
  console.log('💸 Step 2: Preparing deposit...');
  const identifier = `test-${Date.now()}`;
  const password = 'testpassword123';
  const amount = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL
  
  const commitment = computeCommitment(identifier, password);
  console.log(`   Identifier: ${identifier}`);
  console.log(`   Commitment: ${commitment.slice(0, 8).toString('hex')}...`);
  console.log(`   Amount: ${amount / LAMPORTS_PER_SOL} SOL`);
  
  // Get WSOL ATA
  const userAta = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey);
  console.log(`   User WSOL ATA: ${userAta.toBase58()}`);
  
  // Derive deposit PDA (leaf_count is u64 = 8 bytes)
  const leafIndexBuffer = Buffer.alloc(8);
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafCount));
  
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), WSOL_POOL.toBuffer(), leafIndexBuffer],
    PROGRAM_ID
  );
  console.log(`   Deposit PDA: ${depositPda.toBase58()}\n`);
  
  // Step 3: Build transaction
  console.log('🔧 Step 3: Building transaction...');
  const tx = new Transaction();
  
  // Create WSOL ATA if needed
  const ataInfo = await connection.getAccountInfo(userAta);
  if (!ataInfo) {
    console.log('   Adding: Create WSOL ATA');
    tx.add(createAssociatedTokenAccountInstruction(
      payer.publicKey,
      userAta,
      payer.publicKey,
      NATIVE_MINT
    ));
  }
  
  // Transfer SOL to WSOL ATA (wrap)
  console.log('   Adding: Transfer SOL to ATA');
  tx.add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: userAta,
    lamports: amount,
  }));
  
  // Sync native
  console.log('   Adding: SyncNative');
  tx.add(createSyncNativeInstruction(userAta));
  
  // Deposit instruction
  console.log('   Adding: Deposit');
  const discriminator = getDiscriminator('deposit');
  
  // Instruction data: discriminator (8) + amount (8) + commitment (32)
  const ixData = Buffer.alloc(48);
  discriminator.copy(ixData, 0);
  ixData.writeBigUInt64LE(BigInt(amount), 8);
  commitment.copy(ixData, 16);
  
  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: WSOL_POOL, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },  // depositor BEFORE depositor_token
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: ixData,
  }));
  
  console.log(`   Total instructions: ${tx.instructions.length}\n`);
  
  // Step 4: Send transaction
  console.log('🚀 Step 4: Sending transaction...');
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { 
      skipPreflight: false,
      commitment: 'confirmed'
    });
    console.log(`   ✅ Success!`);
    console.log(`   Signature: ${sig}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);
    
    // Verify deposit
    console.log('🔍 Step 5: Verifying deposit...');
    const depositInfo = await connection.getAccountInfo(depositPda);
    if (depositInfo) {
      console.log(`   ✅ Deposit PDA created (${depositInfo.data.length} bytes)`);
    }
    
    const poolAfter = await connection.getAccountInfo(WSOL_POOL);
    if (poolAfter) {
      const newLeafCount = Number(poolAfter.data.readBigUInt64LE(136));
      console.log(`   Leaf count: ${leafCount} → ${newLeafCount}`);
    }
    
    console.log('\n════════════════════════════════════════');
    console.log('🎉 E2E TEST PASSED');
    console.log('════════════════════════════════════════');
    console.log(`Identifier: ${identifier}`);
    console.log(`Password: ${password}`);
    console.log(`Leaf index: ${leafCount}`);
    console.log('════════════════════════════════════════\n');
    
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
    if (e.logs) {
      console.log('\n   Logs:');
      e.logs.forEach((log: string) => console.log(`      ${log}`));
    }
    process.exit(1);
  }
}

main().catch(console.error);
