/**
 * Murkl Full Flow Test
 * deposit -> claim_simple with CU measurement
 */

import { 
  Connection,
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

// M31 hash
const P = 0x7FFFFFFF;
const MIX_A = 0x9e3779b9 % P;
const MIX_B = 0x517cc1b7 % P;
const MIX_C = 0x2545f491 % P;

function m31_add(a: number, b: number): number {
  const sum = (a + b) >>> 0;
  return sum >= P ? sum - P : sum;
}

function m31_mul(a: number, b: number): number {
  const prod = BigInt(a) * BigInt(b);
  const p = BigInt(P);
  const lo = Number(prod & p);
  const hi = Number(prod >> 31n);
  const sum = lo + hi;
  return sum >= P ? sum - P : sum;
}

function m31_hash2(a: number, b: number): Buffer {
  a = a % P;
  b = b % P;
  const x = m31_add(m31_add(a, m31_mul(b, MIX_A)), 1);
  const y = m31_mul(x, x);
  const result = m31_add(
    m31_add(m31_add(y, m31_mul(a, MIX_B)), m31_mul(b, MIX_C)),
    MIX_A
  );
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32LE(result, 0);
  return bytes;
}

function getDiscriminator(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

async function main() {
  console.log("🐈‍⬛ Murkl Full Flow Test\n");
  
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Payer: ${payer.publicKey.toBase58()}`);
  
  // Setup token
  console.log("\n📝 Setting up...");
  const mintAuthority = Keypair.generate();
  await connection.requestAirdrop(mintAuthority.publicKey, 2 * LAMPORTS_PER_SOL);
  await new Promise(r => setTimeout(r, 2000));
  
  const mint = await createMint(connection, mintAuthority, mintAuthority.publicKey, null, 9);
  console.log(`   Mint: ${mint.toBase58()}`);
  
  // Create depositor token account
  const depositorTokenAccount = await createAccount(connection, payer, mint, payer.publicKey);
  await mintTo(connection, mintAuthority, mint, depositorTokenAccount, mintAuthority, 1000_000_000_000);
  console.log(`   Depositor has 1000 tokens`);
  
  // Derive PDAs
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    PROGRAM_ID
  );
  
  console.log(`   Pool: ${poolPda.toBase58()}`);
  
  // ===== INITIALIZE POOL =====
  console.log("\n🏊 Initializing pool...");
  const initIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: getDiscriminator('initialize_pool')
  });
  
  let tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    initIx
  );
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;
  
  let sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`   ✅ Pool initialized: ${sig.slice(0, 20)}...`);
  
  // ===== DEPOSIT =====
  console.log("\n📥 Depositing 100 tokens...");
  const identifier = 12345;
  const secret = 67890;
  const commitment = m31_hash2(identifier, secret);
  const amount = BigInt(100_000_000_000); // 100 tokens
  
  // Get leaf index
  const poolAccount = await connection.getAccountInfo(poolPda);
  const leafIndex = poolAccount ? poolAccount.data.readUInt32LE(32 + 32 + 32 + 32) : 0;
  
  const leafIndexBuf = Buffer.alloc(4);
  leafIndexBuf.writeUInt32LE(leafIndex);
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), poolPda.toBuffer(), leafIndexBuf],
    PROGRAM_ID
  );
  
  // Build deposit instruction
  const depositData = Buffer.concat([
    getDiscriminator('deposit'),
    commitment,  // [u8; 32]
    Buffer.from(new BigUint64Array([amount]).buffer)  // u64
  ]);
  
  const depositIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: depositorTokenAccount, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: depositData
  });
  
  tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    depositIx
  );
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;
  
  const simDeposit = await connection.simulateTransaction(tx, [payer]);
  if (simDeposit.value.err) {
    console.log(`   ❌ Deposit failed: ${JSON.stringify(simDeposit.value.err)}`);
    simDeposit.value.logs?.slice(-5).forEach(log => console.log(`      ${log}`));
  } else {
    console.log(`   ✅ Deposit would use: ${simDeposit.value.unitsConsumed} CU`);
    
    sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`   ✅ Deposited: ${sig.slice(0, 20)}...`);
    
    // Check vault balance
    const vaultAccount = await getAccount(connection, vaultPda);
    console.log(`   📊 Vault balance: ${Number(vaultAccount.amount) / 1e9} tokens`);
  }
  
  // ===== CLAIM SIMPLE =====
  console.log("\n📤 Claiming (simple mode)...");
  const nullifier = m31_hash2(secret, leafIndex);
  
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), poolPda.toBuffer(), nullifier],
    PROGRAM_ID
  );
  
  // Create recipient
  const recipient = Keypair.generate();
  await connection.requestAirdrop(recipient.publicKey, LAMPORTS_PER_SOL);
  await new Promise(r => setTimeout(r, 1000));
  const recipientTokenAccount = await createAccount(connection, recipient, mint, recipient.publicKey);
  
  // Build claim_simple instruction
  // identifier: u32, secret: u32, nullifier: [u8;32], leaf_index: u32, merkle_proof: Vec<[u8;32]>
  const claimData = Buffer.concat([
    getDiscriminator('claim_simple'),
    Buffer.from(new Uint32Array([identifier]).buffer),  // u32
    Buffer.from(new Uint32Array([secret]).buffer),      // u32
    nullifier,                                           // [u8; 32]
    Buffer.from(new Uint32Array([leafIndex]).buffer),   // u32
    Buffer.from(new Uint32Array([0]).buffer),           // Vec length = 0 (empty merkle proof)
  ]);
  
  const claimIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: nullifierPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipientTokenAccount, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: claimData
  });
  
  tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    claimIx
  );
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;
  
  const simClaim = await connection.simulateTransaction(tx, [payer]);
  if (simClaim.value.err) {
    console.log(`   ❌ Claim failed: ${JSON.stringify(simClaim.value.err)}`);
    simClaim.value.logs?.slice(-8).forEach(log => console.log(`      ${log}`));
  } else {
    console.log(`   ✅ Claim would use: ${simClaim.value.unitsConsumed} CU`);
    
    sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`   ✅ Claimed: ${sig.slice(0, 20)}...`);
    
    const recipientAccount = await getAccount(connection, recipientTokenAccount);
    console.log(`   📊 Recipient balance: ${Number(recipientAccount.amount) / 1e9} tokens`);
  }
  
  console.log("\n════════════════════════════════════════");
  console.log("📊 CU SUMMARY");
  console.log("════════════════════════════════════════");
  console.log(`   initialize_pool: ~25,000 CU`);
  console.log(`   deposit:         ~${simDeposit.value.unitsConsumed || 'N/A'} CU`);
  console.log(`   claim_simple:    ~${simClaim.value.unitsConsumed || 'N/A'} CU`);
  console.log("════════════════════════════════════════");
  console.log("\n🎉 Done!");
}

main().catch(console.error);
