import { 
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, SystemProgram
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, createSyncNativeInstruction, 
  getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  NATIVE_MINT
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sha3 from 'js-sha3';
const { keccak256 } = sha3;

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const WSOL_POOL = new PublicKey('HBdNYy8ChUY2KJGf5qTXETXCpeX7kt7aok4XuXk6vbCd');
const RPC_URL = 'https://api.devnet.solana.com';
const M31_PRIME = 0x7FFFFFFF;

function hashPassword(password: string): number {
  const data = Buffer.concat([Buffer.from('murkl_password_v1'), Buffer.from(password)]);
  const hash = Buffer.from(keccak256(data), 'hex');
  return hash.readUInt32LE(0) % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const data = Buffer.concat([Buffer.from('murkl_identifier_v1'), Buffer.from(id.toLowerCase())]);
  const hash = Buffer.from(keccak256(data), 'hex');
  return hash.readUInt32LE(0) % M31_PRIME;
}

function computeCommitment(idHash: number, secret: number): Buffer {
  const data = Buffer.concat([
    Buffer.from('murkl_m31_hash_v1'),
    Buffer.from(new Uint32Array([idHash]).buffer),
    Buffer.from(new Uint32Array([secret]).buffer)
  ]);
  return Buffer.from(keccak256(data), 'hex');
}

function getDiscriminator(name: string): Buffer {
  return crypto.createHash('sha256').update(`global:${name}`).digest().slice(0, 8);
}

async function main() {
  const identifier = '@soltest';
  const password = 'solpassword123';
  const amountSol = 0.05; // 0.05 SOL
  
  console.log('🐈‍⬛ Depositing WSOL\n');
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const secretKey = JSON.parse(fs.readFileSync(`${process.env.HOME}/.config/solana/id.json`, 'utf-8'));
  const depositor = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  const idHash = hashIdentifier(identifier);
  const secret = hashPassword(password);
  const commitment = computeCommitment(idHash, secret);
  
  // Get pool info for leaf index
  const poolInfo = await connection.getAccountInfo(WSOL_POOL);
  const nextLeafIndex = poolInfo!.data.readUInt32LE(8 + 32 + 32 + 32 + 32);
  
  console.log(`Identifier: ${identifier}`);
  console.log(`Password: ${password}`);
  console.log(`Leaf Index: ${nextLeafIndex}`);
  console.log(`Amount: ${amountSol} SOL`);
  
  // Get or create WSOL ATA
  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, depositor.publicKey);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from('vault'), WSOL_POOL.toBuffer()], PROGRAM_ID);
  const leafIndexBuffer = Buffer.alloc(4);
  leafIndexBuffer.writeUInt32LE(nextLeafIndex);
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), WSOL_POOL.toBuffer(), leafIndexBuffer], PROGRAM_ID
  );
  
  const tx = new Transaction();
  
  // Create WSOL ATA if needed
  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    tx.add(createAssociatedTokenAccountInstruction(depositor.publicKey, wsolAta, depositor.publicKey, NATIVE_MINT));
  }
  
  // Transfer SOL to WSOL ATA (wrap)
  const lamports = amountSol * 1e9;
  tx.add(SystemProgram.transfer({ fromPubkey: depositor.publicKey, toPubkey: wsolAta, lamports }));
  tx.add(createSyncNativeInstruction(wsolAta));
  
  // Deposit instruction
  const depositData = Buffer.concat([
    getDiscriminator('deposit'),
    commitment,
    Buffer.from(new BigUint64Array([BigInt(lamports)]).buffer)
  ]);
  
  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: WSOL_POOL, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wsolAta, isSigner: false, isWritable: true },
      { pubkey: depositor.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: depositData
  }));
  
  const sig = await sendAndConfirmTransaction(connection, tx, [depositor]);
  console.log(`\n✅ Deposited! Tx: ${sig}`);
  
  console.log('\n════════════════════════════════════════');
  console.log('📊 CLAIM CREDENTIALS');
  console.log('════════════════════════════════════════');
  console.log(`Identifier: ${identifier}`);
  console.log(`Password:   ${password}`);
  console.log(`Leaf Index: ${nextLeafIndex}`);
  console.log(`Pool:       ${WSOL_POOL.toBase58()}`);
  console.log('════════════════════════════════════════');
}

main().catch(console.error);
