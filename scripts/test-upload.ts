import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

const STARK_VERIFIER_ID = new PublicKey("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

const INIT_BUFFER_DISC = Buffer.from([49,27,28,88,19,99,133,194]); 
const UPLOAD_CHUNK_DISC = Buffer.from([130,219,165,153,119,149,252,162]);

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Use new test keypair
  const keypairPath = `/tmp/test-relayer.json`;
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Balance:", await connection.getBalance(wallet.publicKey) / 1e9, "SOL");
  
  // Create mock proof (small enough to fit in 900 bytes)
  const mockProof = Buffer.alloc(800);
  mockProof.fill(0x42); // Fill with test data
  console.log("Mock proof size:", mockProof.length, "bytes");
  
  // PDA
  const [proofBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proof_buffer"), wallet.publicKey.toBuffer()],
    STARK_VERIFIER_ID
  );
  console.log("Proof buffer PDA:", proofBufferPda.toBase58());
  
  // Check if buffer exists
  const existingBuffer = await connection.getAccountInfo(proofBufferPda);
  if (existingBuffer) {
    console.log("Buffer already exists, size:", existingBuffer.data.length);
    return;
  }
  
  // Step 1: Initialize proof buffer
  console.log("\n=== Step 1: Init proof buffer ===");
  const expectedSize = Buffer.alloc(4);
  expectedSize.writeUInt32LE(mockProof.length);
  
  const initIx = new TransactionInstruction({
    programId: STARK_VERIFIER_ID,
    keys: [
      { pubkey: proofBufferPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([INIT_BUFFER_DISC, expectedSize]),
  });
  
  const tx1 = new Transaction().add(initIx);
  const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet]);
  console.log("✅ Init tx:", sig1);
  
  // Step 2: Upload proof
  console.log("\n=== Step 2: Upload proof ===");
  const offsetBuf = Buffer.alloc(4);
  offsetBuf.writeUInt32LE(0);
  
  const chunkLenBuf = Buffer.alloc(4);
  chunkLenBuf.writeUInt32LE(mockProof.length);
  
  const uploadIx = new TransactionInstruction({
    programId: STARK_VERIFIER_ID,
    keys: [
      { pubkey: proofBufferPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([UPLOAD_CHUNK_DISC, offsetBuf, chunkLenBuf, mockProof]),
  });
  
  const tx2 = new Transaction().add(uploadIx);
  const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
  console.log("✅ Upload tx:", sig2);
  
  console.log("\n🎉 Proof buffer created and uploaded!");
}

main().catch(console.error);
