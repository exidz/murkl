import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const RPC_URL = 'https://api.devnet.solana.com';

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('🐈‍⬛ Setting up WSOL pool on devnet\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const secretKey = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Authority: ${authority.publicKey.toBase58()}`);
  console.log(`💰 WSOL Mint: ${WSOL_MINT.toBase58()}`);
  
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), WSOL_MINT.toBuffer()],
    PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPda.toBuffer()],
    PROGRAM_ID
  );
  
  console.log(`   Pool PDA: ${poolPda.toBase58()}`);
  console.log(`   Vault PDA: ${vaultPda.toBase58()}`);
  
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log('\n✅ WSOL Pool already exists!');
  } else {
    console.log('\n🚀 Initializing WSOL pool...');
    
    const discriminator = getDiscriminator('initialize_pool');
    const configData = Buffer.alloc(10);
    configData.writeBigUInt64LE(BigInt(1000000), 0); // min 0.001 SOL (lamports)
    configData.writeUInt16LE(100, 8); // 1% max fee
    
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
      data: Buffer.concat([discriminator, configData])
    });
    
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`   ✅ Pool created: ${sig}`);
  }
  
  const poolData = {
    programId: PROGRAM_ID.toBase58(),
    mint: WSOL_MINT.toBase58(),
    pool: poolPda.toBase58(),
    vault: vaultPda.toBase58(),
    authority: authority.publicKey.toBase58(),
    rpc: RPC_URL,
  };
  
  fs.writeFileSync('/tmp/murkl-wsol-pool.json', JSON.stringify(poolData, null, 2));
  
  console.log('\n════════════════════════════════════════');
  console.log('📊 WSOL POOL READY');
  console.log('════════════════════════════════════════');
  console.log(`Pool:  ${poolPda.toBase58()}`);
  console.log(`Vault: ${vaultPda.toBase58()}`);
  console.log('════════════════════════════════════════');
}

main().catch(console.error);
