/**
 * Test claim instruction discriminator
 */
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const STARK_VERIFIER_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');
const POOL = new PublicKey('8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ');

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));

  console.log('Payer:', payer.publicKey.toBase58());
  console.log('Program:', PROGRAM_ID.toBase58());
  console.log('Pool:', POOL.toBase58());
  
  // Print discriminators
  console.log('\n=== Discriminators ===');
  console.log('initialize_config:', getDiscriminator('initialize_config').toString('hex'));
  console.log('initialize_pool:', getDiscriminator('initialize_pool').toString('hex'));
  console.log('deposit:', getDiscriminator('deposit').toString('hex'));
  console.log('claim:', getDiscriminator('claim').toString('hex'));
  console.log('pause_pool:', getDiscriminator('pause_pool').toString('hex'));
  console.log('unpause_pool:', getDiscriminator('unpause_pool').toString('hex'));
  
  // Try to call with deposit discriminator (which we know works)
  console.log('\n=== Testing deposit discriminator (should fail with different error) ===');
  
  const depositDisc = getDiscriminator('deposit');
  const dummyData = Buffer.concat([
    depositDisc,
    Buffer.alloc(40, 0) // dummy amount + commitment
  ]);
  
  const testIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: POOL, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: dummyData,
  });
  
  const tx = new Transaction().add(testIx);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = payer.publicKey;
  
  const sim = await connection.simulateTransaction(tx, [payer]);
  console.log('Simulation result:', sim.value.err);
  console.log('Logs:', sim.value.logs?.slice(0, 5));
  
  // Now try claim discriminator
  console.log('\n=== Testing claim discriminator ===');
  
  const claimDisc = getDiscriminator('claim');
  const claimData = Buffer.concat([
    claimDisc,
    Buffer.alloc(8, 0),   // relayer_fee u64
    Buffer.alloc(32, 0),  // nullifier [u8; 32]
  ]);
  
  const claimIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: POOL, isSigner: false, isWritable: false },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: claimData,
  });
  
  const claimTx = new Transaction().add(claimIx);
  claimTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  claimTx.feePayer = payer.publicKey;
  
  const claimSim = await connection.simulateTransaction(claimTx, [payer]);
  console.log('Simulation result:', claimSim.value.err);
  console.log('Logs:', claimSim.value.logs?.slice(0, 5));
}

main().catch(console.error);
