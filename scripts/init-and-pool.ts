/**
 * Initialize GlobalConfig and create test pool
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
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('🐈‍⬛ Murkl Full Setup\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load wallet
  const walletPath = process.env.WALLET || `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Authority: ${authority.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(authority.publicKey);
  console.log(`💰 Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  // Step 1: Initialize GlobalConfig
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID
  );
  console.log(`\n📍 Config PDA: ${configPda.toBase58()}`);
  
  const configInfo = await connection.getAccountInfo(configPda);
  if (configInfo) {
    console.log(`   ✅ GlobalConfig exists (${configInfo.data.length} bytes)`);
  } else {
    console.log(`   ⏳ Initializing GlobalConfig...`);
    
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: getDiscriminator('initialize_config')
    });
    
    try {
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority]);
      console.log(`   ✅ GlobalConfig initialized: ${sig}`);
    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`);
      if (e.logs) e.logs.forEach((l: string) => console.log(`      ${l}`));
      return;
    }
  }
  
  // Step 2: Create test token
  console.log('\n📝 Creating test token...');
  const mint = await createMint(connection, authority, authority.publicKey, null, 9);
  console.log(`   Mint: ${mint.toBase58()}`);
  
  // Step 3: Derive PDAs
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), mint.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPda.toBuffer()],
    PROGRAM_ID
  );
  console.log(`   Pool PDA: ${poolPda.toBase58()}`);
  console.log(`   Vault PDA: ${vaultPda.toBase58()}`);
  
  // Step 4: Initialize pool
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log(`\n✅ Pool already exists`);
  } else {
    console.log(`\n🚀 Initializing pool...`);
    
    // PoolConfig: min_deposit (u64) + max_relayer_fee_bps (u16)
    const configData = Buffer.alloc(10);
    configData.writeBigUInt64LE(BigInt(1), 0); // min_deposit = 1
    configData.writeUInt16LE(100, 8); // max_relayer_fee_bps = 1%
    
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([getDiscriminator('initialize_pool'), configData])
    });
    
    try {
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority], { skipPreflight: true });
      console.log(`   ✅ Pool initialized: ${sig}`);
    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`);
      if (e.logs) e.logs.forEach((l: string) => console.log(`      ${l}`));
      return;
    }
  }
  
  // Step 5: Mint test tokens
  console.log('\n📝 Minting test tokens...');
  const userAta = await getOrCreateAssociatedTokenAccount(connection, authority, mint, authority.publicKey);
  await mintTo(connection, authority, mint, userAta.address, authority, 1000_000_000_000);
  console.log(`   ✅ Minted 1000 tokens to ${userAta.address.toBase58()}`);
  
  // Save info
  const info = {
    programId: PROGRAM_ID.toBase58(),
    mint: mint.toBase58(),
    pool: poolPda.toBase58(),
    vault: vaultPda.toBase58(),
    authority: authority.publicKey.toBase58(),
    userAta: userAta.address.toBase58(),
    rpc: RPC_URL
  };
  fs.writeFileSync('/tmp/murkl-pool.json', JSON.stringify(info, null, 2));
  
  console.log('\n════════════════════════════════════════');
  console.log('🎉 SETUP COMPLETE');
  console.log('════════════════════════════════════════');
  console.log(`Mint:  ${mint.toBase58()}`);
  console.log(`Pool:  ${poolPda.toBase58()}`);
  console.log('════════════════════════════════════════');
  console.log('\n📋 Update web/src/lib/constants.ts:');
  console.log(`   POOL_ADDRESS: '${poolPda.toBase58()}'`);
}

main().catch(console.error);
