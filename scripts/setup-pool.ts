/**
 * Setup a Murkl test pool
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
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8899';

// Anchor discriminator for initialize_pool
function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('🐈‍⬛ Setting up Murkl test pool\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load wallet
  const walletPath = process.env.WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Authority: ${authority.publicKey.toBase58()}`);
  
  // Check balance
  let balance = await connection.getBalance(authority.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < LAMPORTS_PER_SOL) {
    console.log('   Requesting airdrop...');
    const sig = await connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
    balance = await connection.getBalance(authority.publicKey);
    console.log(`💰 New balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  }
  
  // Create test token
  console.log('\n📝 Creating test token...');
  const mint = await createMint(
    connection,
    authority,
    authority.publicKey,
    null,
    9
  );
  console.log(`   Mint: ${mint.toBase58()}`);
  
  // Derive PDAs
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), mint.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPda.toBuffer()],
    PROGRAM_ID
  );
  
  console.log(`   Pool PDA: ${poolPda.toBase58()}`);
  console.log(`   Vault PDA: ${vaultPda.toBase58()}`);
  
  // Check if pool already exists
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log('\n✅ Pool already exists!');
  } else {
    // Initialize pool
    console.log('\n🚀 Initializing pool...');
    
    const discriminator = getDiscriminator('initialize_pool');
    
    // PoolConfig: min_deposit (u64) + max_relayer_fee_bps (u16)
    const configData = Buffer.alloc(10);
    configData.writeBigUInt64LE(BigInt(1), 0); // min_deposit = 1 (smallest unit)
    configData.writeUInt16LE(100, 8); // max_relayer_fee_bps = 100 (1%)
    
    const instructionData = Buffer.concat([discriminator, configData]);
    
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
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
      const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
      console.log(`   ✅ Pool initialized: ${sig}`);
    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`);
      if (e.logs) {
        console.log('\n   Logs:');
        e.logs.forEach((log: string) => console.log(`      ${log}`));
      }
    }
  }
  
  // Create user token account and mint some tokens
  console.log('\n📝 Setting up test tokens...');
  
  const userAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    authority.publicKey
  );
  console.log(`   User ATA: ${userAta.address.toBase58()}`);
  
  // Mint 1000 tokens
  await mintTo(
    connection,
    authority,
    mint,
    userAta.address,
    authority,
    1000_000_000_000 // 1000 tokens with 9 decimals
  );
  console.log(`   Minted 1000 tokens`);
  
  // Save pool info
  const poolData = {
    programId: PROGRAM_ID.toBase58(),
    mint: mint.toBase58(),
    pool: poolPda.toBase58(),
    vault: vaultPda.toBase58(),
    authority: authority.publicKey.toBase58(),
    userAta: userAta.address.toBase58(),
    rpc: RPC_URL,
  };
  
  fs.writeFileSync('/tmp/murkl-pool.json', JSON.stringify(poolData, null, 2));
  console.log('\n📄 Pool info saved to /tmp/murkl-pool.json');
  
  console.log('\n════════════════════════════════════════');
  console.log('📊 POOL SETUP COMPLETE');
  console.log('════════════════════════════════════════');
  console.log(`Mint:     ${mint.toBase58()}`);
  console.log(`Pool:     ${poolPda.toBase58()}`);
  console.log(`Vault:    ${vaultPda.toBase58()}`);
  console.log(`User ATA: ${userAta.address.toBase58()}`);
  console.log('════════════════════════════════════════');
  
  console.log('\n🎉 Ready to deposit!');
  console.log('\nNext steps:');
  console.log('1. Generate commitment: murkl commit -i "@test" -p "password123"');
  console.log('2. Deposit tokens with the commitment');
  console.log('3. Claim using the web UI or CLI');
}

main().catch(console.error);
