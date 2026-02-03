import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as fs from 'fs';
import * as crypto from 'crypto';

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const relayer = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  // Old commitment (from WASM for @alice/secretpassword)
  const commitment = Buffer.from('1655bc7e2868fe16def9555d6abcc7564f5c48d83c693f26a74fe921409944c5', 'hex');
  
  const [proofBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), relayer.publicKey.toBuffer(), commitment.slice(0, 8)],
    PROGRAM_ID
  );
  
  console.log('Closing proof buffer:', proofBufferPda.toBase58());
  
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: proofBufferPda, isSigner: false, isWritable: true },
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
    ],
    data: getDiscriminator('close_proof_buffer'),
  });
  
  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = relayer.publicKey;
  
  const sig = await sendAndConfirmTransaction(connection, tx, [relayer]);
  console.log('Closed:', sig);
}

main().catch(console.error);
