import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";

const STARK_VERIFIER_ID = new PublicKey("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

// Discriminators
function disc(name: string): Buffer {
  const hash = crypto.createHash('sha256').update('global:' + name).digest();
  return hash.slice(0, 8);
}

const INIT_BUFFER = disc('init_proof_buffer');
const UPLOAD_CHUNK = disc('upload_chunk');
const FINALIZE = disc('finalize_and_verify');

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Use test relayer
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync("/tmp/test-relayer.json", "utf8"))));
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Balance:", await connection.getBalance(wallet.publicKey) / 1e9, "SOL");
  
  // Load proof
  const proofData = fs.readFileSync("/tmp/proof.bin");
  console.log("Proof size:", proofData.length, "bytes");
  
  // Load proof bundle for public inputs
  const proofBundle = JSON.parse(fs.readFileSync("/tmp/proof.json", "utf8"));
  
  // Create buffer account
  const bufferKeypair = Keypair.generate();
  const HEADER_SIZE = 41;
  const bufferSize = HEADER_SIZE + proofData.length + 100; // Some padding
  
  console.log("\n=== Creating buffer account ===");
  console.log("Buffer:", bufferKeypair.publicKey.toBase58());
  console.log("Size:", bufferSize, "bytes");
  
  const rentExempt = await connection.getMinimumBalanceForRentExemption(bufferSize);
  
  const createIx = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: bufferKeypair.publicKey,
    lamports: rentExempt,
    space: bufferSize,
    programId: STARK_VERIFIER_ID,
  });
  
  // Init buffer
  const expectedSize = Buffer.alloc(4);
  expectedSize.writeUInt32LE(proofData.length);
  
  const initIx = new TransactionInstruction({
    programId: STARK_VERIFIER_ID,
    keys: [
      { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([INIT_BUFFER, expectedSize]),
  });
  
  const tx1 = new Transaction().add(createIx, initIx);
  const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet, bufferKeypair]);
  console.log("Created & initialized:", sig1.slice(0, 30) + "...");
  
  // Upload proof in chunks
  console.log("\n=== Uploading proof ===");
  const CHUNK_SIZE = 900;
  for (let offset = 0; offset < proofData.length; offset += CHUNK_SIZE) {
    const chunk = proofData.slice(offset, Math.min(offset + CHUNK_SIZE, proofData.length));
    
    const offsetBuf = Buffer.alloc(4);
    offsetBuf.writeUInt32LE(offset);
    
    // Anchor Vec<u8> encoding: length prefix (4 bytes) + data
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(chunk.length);
    
    const uploadIx = new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([UPLOAD_CHUNK, offsetBuf, lenBuf, chunk]),
    });
    
    const tx = new Transaction().add(uploadIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(`Chunk ${offset}-${offset + chunk.length}: ${sig.slice(0, 20)}...`);
  }
  
  console.log("✅ Proof uploaded!");
  
  // Finalize and verify
  console.log("\n=== Verifying proof ===");
  
  // Get commitment and nullifier from proof bundle
  const commitment = Buffer.alloc(32);
  const nullifier = Buffer.alloc(32);
  const merkleRoot = Buffer.alloc(32);
  
  if (proofBundle.commitment) {
    Buffer.from(proofBundle.commitment).copy(commitment);
  }
  if (proofBundle.nullifier) {
    Buffer.from(proofBundle.nullifier).copy(nullifier);
  }
  if (proofBundle.merkle_root) {
    Buffer.from(proofBundle.merkle_root).copy(merkleRoot);
  }
  
  const finalizeIx = new TransactionInstruction({
    programId: STARK_VERIFIER_ID,
    keys: [
      { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([FINALIZE, commitment, nullifier, merkleRoot]),
  });
  
  const tx3 = new Transaction().add(finalizeIx);
  const sig3 = await sendAndConfirmTransaction(connection, tx3, [wallet]);
  console.log("✅ Proof verified!");
  console.log("Tx:", sig3);
  
  // Save buffer address for claim
  fs.writeFileSync("/tmp/verified-buffer.json", JSON.stringify({
    buffer: bufferKeypair.publicKey.toBase58(),
    commitment: commitment.toString("hex"),
    nullifier: nullifier.toString("hex"),
  }, null, 2));
  console.log("\nBuffer info saved to /tmp/verified-buffer.json");
}

main().catch(console.error);
