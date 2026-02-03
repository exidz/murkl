import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
const STARK_VERIFIER_ID = new PublicKey("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");
const TOKEN_MINT = new PublicKey("DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9");

// Anchor discriminators
const INIT_BUFFER_DISC = Buffer.from([49,27,28,88,19,99,133,194]); 
const UPLOAD_CHUNK_DISC = Buffer.from([130,219,165,153,119,149,252,162]);
const FINALIZE_DISC = Buffer.from([130,34,68,173,21,213,183,236]);
const CLAIM_DISC = Buffer.from([62, 198, 214, 193, 213, 159, 108, 210]); // sha256("global:claim")[:8]

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Use test relayer keypair
  const keypairPath = `/tmp/test-relayer.json`;
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  
  // Load proof
  const proofData = fs.readFileSync("/tmp/proof.bin");
  console.log("Proof size:", proofData.length, "bytes");
  
  // Load proof bundle for public inputs
  const proofBundle = JSON.parse(fs.readFileSync("/tmp/proof.json", "utf8"));
  const commitment = Buffer.from(proofBundle.commitment || proofBundle.public_inputs?.commitment || []);
  const nullifier = Buffer.from(proofBundle.nullifier || proofBundle.public_inputs?.nullifier || []);
  
  // PDAs
  const [proofBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proof_buffer"), wallet.publicKey.toBuffer()],
    STARK_VERIFIER_ID
  );
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), TOKEN_MINT.toBuffer()], MURKL_ID);
  
  console.log("Proof buffer PDA:", proofBufferPda.toBase58());
  
  // Step 1: Initialize proof buffer
  console.log("\n=== Step 1: Init proof buffer ===");
  const expectedSize = Buffer.alloc(4);
  expectedSize.writeUInt32LE(proofData.length);
  
  const initIx = new TransactionInstruction({
    programId: STARK_VERIFIER_ID,
    keys: [
      { pubkey: proofBufferPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([INIT_BUFFER_DISC, expectedSize]),
  });
  
  try {
    const tx1 = new Transaction().add(initIx);
    const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet]);
    console.log("Init tx:", sig1);
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("Buffer already exists, continuing...");
    } else {
      throw e;
    }
  }
  
  // Step 2: Upload proof in chunks
  console.log("\n=== Step 2: Upload proof ===");
  const CHUNK_SIZE = 800; // Leave room for instruction data
  for (let offset = 0; offset < proofData.length; offset += CHUNK_SIZE) {
    const chunk = proofData.slice(offset, Math.min(offset + CHUNK_SIZE, proofData.length));
    
    const offsetBuf = Buffer.alloc(4);
    offsetBuf.writeUInt32LE(offset);
    
    const chunkLenBuf = Buffer.alloc(4);
    chunkLenBuf.writeUInt32LE(chunk.length);
    
    const uploadIx = new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: proofBufferPda, isSigner: false, isWritable: true },
        { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([UPLOAD_CHUNK_DISC, offsetBuf, chunkLenBuf, chunk]),
    });
    
    const tx2 = new Transaction().add(uploadIx);
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [wallet]);
    console.log(`Uploaded ${offset}-${offset + chunk.length}:`, sig2.slice(0, 20) + "...");
  }
  
  console.log("✅ Proof uploaded!");
}

main().catch(console.error);
