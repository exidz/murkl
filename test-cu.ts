/**
 * Murkl CU Measurement Test
 * Calls the program and measures compute units used
 */

import { 
  Connection,
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  ComputeBudgetProgram
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as borsh from "borsh";

const PROGRAM_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

// Anchor discriminator for initialize_pool
// sha256("global:initialize_pool")[0..8]
function getInitializePoolDiscriminator(): Buffer {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update('global:initialize_pool').digest();
  return hash.slice(0, 8);
}

// Anchor discriminator for deposit
function getDepositDiscriminator(): Buffer {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update('global:deposit').digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log("🐈‍⬛ Murkl CU Measurement\n");
  
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  // Load wallet
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Payer: ${payer.publicKey.toBase58()}`);
  
  // Create token
  console.log("\n📝 Setting up token...");
  const mintAuthority = Keypair.generate();
  await connection.requestAirdrop(mintAuthority.publicKey, 2 * LAMPORTS_PER_SOL);
  await new Promise(r => setTimeout(r, 2000));
  
  const mint = await createMint(
    connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    9
  );
  console.log(`   Mint: ${mint.toBase58()}`);
  
  // Derive PDAs
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    PROGRAM_ID
  );
  
  console.log(`   Pool: ${poolPda.toBase58()} (bump: ${poolBump})`);
  console.log(`   Vault: ${vaultPda.toBase58()} (bump: ${vaultBump})`);
  
  // Build initialize_pool instruction
  console.log("\n🚀 Calling initialize_pool...");
  
  const discriminator = getInitializePoolDiscriminator();
  console.log(`   Discriminator: ${discriminator.toString('hex')}`);
  
  const initIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: discriminator
  });
  
  // Add compute budget to measure CU
  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 400_000
  });
  
  const tx = new Transaction()
    .add(computeBudgetIx)
    .add(initIx);
  
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;
  
  try {
    // Simulate first to get CU
    console.log("   Simulating...");
    const simResult = await connection.simulateTransaction(tx, [payer]);
    
    if (simResult.value.err) {
      console.log(`   ❌ Simulation failed: ${JSON.stringify(simResult.value.err)}`);
      if (simResult.value.logs) {
        console.log("\n   Logs:");
        simResult.value.logs.forEach(log => console.log(`      ${log}`));
      }
    } else {
      console.log(`   ✅ Simulation success!`);
      console.log(`   📊 Units consumed: ${simResult.value.unitsConsumed}`);
      
      if (simResult.value.logs) {
        console.log("\n   Logs:");
        simResult.value.logs.slice(-5).forEach(log => console.log(`      ${log}`));
      }
    }
    
  } catch (e: any) {
    console.log(`   ❌ Error: ${e.message}`);
  }
  
  console.log("\n🎉 Done!");
}

main().catch(console.error);
