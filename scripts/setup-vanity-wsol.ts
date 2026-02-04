/**
 * Setup WSOL pool on the vanity address program
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

// NEW VANITY ADDRESS
const PROGRAM_ID = new PublicKey('muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const RPC_URL = 'https://api.devnet.solana.com';

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('🐈‍⬛ Setting up Murkl WSOL pool (vanity address)\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Authority: ${authority.publicKey.toBase58()}`);
  console.log(`📍 Program: ${PROGRAM_ID.toBase58()}`);
  
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
    console.log(`   ✅ GlobalConfig exists`);
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
    
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority]);
    console.log(`   ✅ GlobalConfig initialized: ${sig}`);
  }
  
  // Step 2: Create WSOL pool
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
  
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log(`\n✅ WSOL Pool already exists (${poolInfo.data.length} bytes)`);
  } else {
    console.log(`\n🚀 Initializing WSOL pool...`);
    
    // PoolConfig: min_deposit (u64) + max_relayer_fee_bps (u16)
    const configData = Buffer.alloc(10);
    configData.writeBigUInt64LE(BigInt(1000000), 0); // 0.001 SOL min
    configData.writeUInt16LE(100, 8); // 1% max fee
    
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: false },
        { pubkey: poolPda, isSigner: false, isWritable: true },
        { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([getDiscriminator('initialize_pool'), configData])
    });
    
    const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority], { skipPreflight: true });
    console.log(`   ✅ WSOL Pool initialized: ${sig}`);
  }
  
  console.log('\n════════════════════════════════════════');
  console.log('🎉 WSOL POOL READY');
  console.log('════════════════════════════════════════');
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Pool:    ${poolPda.toBase58()}`);
  console.log(`Vault:   ${vaultPda.toBase58()}`);
  console.log('════════════════════════════════════════');
}

main().catch(console.error);
