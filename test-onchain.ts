/**
 * Murkl On-Chain Test
 * Tests deposit + claim_simple flow
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { 
  Keypair, 
  PublicKey, 
  SystemProgram,
  LAMPORTS_PER_SOL 
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";

// M31 prime
const P = 0x7FFFFFFF;
const MIX_A = 0x9e3779b9 % P;
const MIX_B = 0x517cc1b7 % P;
const MIX_C = 0x2545f491 % P;

// M31 field ops
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

// M31 hash (matches on-chain)
function m31_hash2(a: number, b: number): Uint8Array {
  a = a % P;
  b = b % P;
  
  const x = m31_add(m31_add(a, m31_mul(b, MIX_A)), 1);
  const y = m31_mul(x, x);
  const result = m31_add(
    m31_add(m31_add(y, m31_mul(a, MIX_B)), m31_mul(b, MIX_C)),
    MIX_A
  );
  
  const bytes = new Uint8Array(32);
  bytes[0] = result & 0xff;
  bytes[1] = (result >> 8) & 0xff;
  bytes[2] = (result >> 16) & 0xff;
  bytes[3] = (result >> 24) & 0xff;
  return bytes;
}

async function main() {
  console.log("🐈‍⬛ Murkl On-Chain Test\n");
  
  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const programId = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
  const idl = await Program.fetchIdl(programId, provider);
  
  if (!idl) {
    console.log("❌ Could not fetch IDL. Running basic connection test...");
    const balance = await provider.connection.getBalance(provider.wallet.publicKey);
    console.log(`✅ Connected! Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    return;
  }
  
  const program = new Program(idl, programId, provider);
  console.log("✅ Program loaded");
  
  // Create test token
  console.log("\n📝 Creating test token...");
  const mintAuthority = Keypair.generate();
  
  // Airdrop to mint authority
  const airdropSig = await provider.connection.requestAirdrop(
    mintAuthority.publicKey,
    2 * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(airdropSig);
  
  const mint = await createMint(
    provider.connection,
    mintAuthority,
    mintAuthority.publicKey,
    null,
    9
  );
  console.log(`✅ Token mint: ${mint.toBase58()}`);
  
  // Create depositor token account
  const depositorTokenAccount = await createAccount(
    provider.connection,
    mintAuthority,
    mint,
    provider.wallet.publicKey
  );
  
  // Mint tokens to depositor
  await mintTo(
    provider.connection,
    mintAuthority,
    mint,
    depositorTokenAccount,
    mintAuthority,
    1000_000_000_000 // 1000 tokens
  );
  console.log("✅ Minted 1000 tokens to depositor");
  
  // Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), mint.toBuffer()],
    programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolPda.toBuffer()],
    programId
  );
  
  console.log(`\n🏊 Pool PDA: ${poolPda.toBase58()}`);
  console.log(`🔐 Vault PDA: ${vaultPda.toBase58()}`);
  
  // Initialize pool
  console.log("\n📝 Initializing pool...");
  try {
    const tx = await program.methods
      .initializePool()
      .accounts({
        pool: poolPda,
        tokenMint: mint,
        vault: vaultPda,
        authority: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log(`✅ Pool initialized! Tx: ${tx}`);
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("✅ Pool already exists");
    } else {
      throw e;
    }
  }
  
  // Generate commitment
  const identifier = 12345;
  const secret = 67890;
  const commitment = m31_hash2(identifier, secret);
  console.log(`\n🔐 Commitment: ${Buffer.from(commitment).toString('hex').slice(0, 16)}...`);
  
  // Get leaf index
  const poolAccount = await program.account.pool.fetch(poolPda);
  const leafIndex = poolAccount.nextLeafIndex;
  
  // Derive deposit PDA
  const leafIndexBuffer = Buffer.alloc(4);
  leafIndexBuffer.writeUInt32LE(leafIndex);
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), poolPda.toBuffer(), leafIndexBuffer],
    programId
  );
  
  // Deposit
  console.log("\n📥 Depositing 100 tokens...");
  const depositAmount = 100_000_000_000; // 100 tokens
  
  try {
    const tx = await program.methods
      .deposit(Array.from(commitment), new anchor.BN(depositAmount))
      .accounts({
        pool: poolPda,
        depositAccount: depositPda,
        vault: vaultPda,
        depositorTokenAccount: depositorTokenAccount,
        depositor: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`✅ Deposited! Tx: ${tx}`);
  } catch (e: any) {
    console.log(`❌ Deposit failed: ${e.message}`);
    throw e;
  }
  
  // Check vault balance
  const vaultAccount = await getAccount(provider.connection, vaultPda);
  console.log(`📊 Vault balance: ${Number(vaultAccount.amount) / 1e9} tokens`);
  
  // Generate nullifier
  const nullifier = m31_hash2(secret, leafIndex);
  console.log(`\n🔑 Nullifier: ${Buffer.from(nullifier).toString('hex').slice(0, 16)}...`);
  
  // Derive nullifier PDA
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), poolPda.toBuffer(), Buffer.from(nullifier)],
    programId
  );
  
  // Create recipient token account
  const recipient = Keypair.generate();
  await provider.connection.requestAirdrop(recipient.publicKey, LAMPORTS_PER_SOL);
  await new Promise(r => setTimeout(r, 1000));
  
  const recipientTokenAccount = await createAccount(
    provider.connection,
    recipient,
    mint,
    recipient.publicKey
  );
  
  // Claim (simple - no privacy, for testing)
  console.log("\n📤 Claiming with simple method (reveals values)...");
  
  // For simple claim, we need merkle proof (empty for now - simplified tree)
  const merkleProof: number[][] = [];
  
  try {
    const tx = await program.methods
      .claimSimple(
        identifier,
        secret,
        Array.from(nullifier),
        leafIndex,
        merkleProof
      )
      .accounts({
        pool: poolPda,
        depositAccount: depositPda,
        nullifierAccount: nullifierPda,
        vault: vaultPda,
        recipientTokenAccount: recipientTokenAccount,
        claimer: provider.wallet.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`✅ Claimed! Tx: ${tx}`);
    
    // Check recipient balance
    const recipientAccount = await getAccount(provider.connection, recipientTokenAccount);
    console.log(`📊 Recipient balance: ${Number(recipientAccount.amount) / 1e9} tokens`);
    
  } catch (e: any) {
    console.log(`❌ Claim failed: ${e.message}`);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach((log: string) => console.log(`  ${log}`));
    }
  }
  
  console.log("\n🎉 Test complete!");
}

main().catch(console.error);
