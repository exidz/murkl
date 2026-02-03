import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
const STARK_VERIFIER_ID = new PublicKey("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");
const TOKEN_MINT = new PublicKey("DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9");

function disc(name: string): Buffer {
  const hash = crypto.createHash('sha256').update('global:' + name).digest();
  return hash.slice(0, 8);
}

const CLAIM_DISC = disc('claim');

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Main wallet (has the pool admin rights)
  const mainWallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(
    fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8")
  )));
  
  // Test relayer
  const relayer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(
    fs.readFileSync("/tmp/test-relayer.json", "utf8")
  )));
  
  console.log("Main wallet:", mainWallet.publicKey.toBase58());
  console.log("Relayer:", relayer.publicKey.toBase58());
  
  // Load verified buffer info
  const bufferInfo = JSON.parse(fs.readFileSync("/tmp/verified-buffer.json", "utf8"));
  const verifierBuffer = new PublicKey(bufferInfo.buffer);
  console.log("Verified buffer:", verifierBuffer.toBase58());
  
  // Load proof bundle for commitment/nullifier
  const proofBundle = JSON.parse(fs.readFileSync("/tmp/proof.json", "utf8"));
  const commitment = Buffer.from(proofBundle.commitment || []);
  const nullifier = Buffer.from(proofBundle.nullifier || []);
  
  console.log("Commitment:", commitment.toString("hex").slice(0, 16) + "...");
  console.log("Nullifier:", nullifier.toString("hex").slice(0, 16) + "...");
  
  // PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), TOKEN_MINT.toBuffer()], MURKL_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), poolPda.toBuffer()], MURKL_ID);
  
  // The deposit we made was at leaf index 1
  const leafIndex = 1n;
  const leafIndexBuf = Buffer.alloc(8);
  leafIndexBuf.writeBigUInt64LE(leafIndex);
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), poolPda.toBuffer(), leafIndexBuf],
    MURKL_ID
  );
  
  console.log("\nPool:", poolPda.toBase58());
  console.log("Deposit:", depositPda.toBase58());
  console.log("Vault:", vaultPda.toBase58());
  
  // Check deposit exists and get amount
  const depositInfo = await connection.getAccountInfo(depositPda);
  if (!depositInfo) {
    throw new Error("Deposit not found!");
  }
  // DepositRecord: discriminator(8) + pool(32) + commitment(32) + amount(8) + leaf_index(8) + claimed(1) + bump(1)
  const depositAmount = depositInfo.data.readBigUInt64LE(8 + 32 + 32);
  const claimed = depositInfo.data[8 + 32 + 32 + 8 + 8] === 1;
  console.log("Deposit amount:", Number(depositAmount) / 1e9, "tokens");
  console.log("Already claimed:", claimed);
  
  if (claimed) {
    console.log("⚠️ This deposit was already claimed!");
    return;
  }
  
  // Get or create recipient token account
  const recipientAta = await getAssociatedTokenAddress(TOKEN_MINT, mainWallet.publicKey);
  const relayerAta = await getAssociatedTokenAddress(TOKEN_MINT, relayer.publicKey);
  
  const tx = new Transaction();
  
  // Create ATAs if needed
  try {
    await getAccount(connection, recipientAta);
  } catch {
    console.log("Creating recipient ATA...");
    tx.add(createAssociatedTokenAccountInstruction(relayer.publicKey, recipientAta, mainWallet.publicKey, TOKEN_MINT));
  }
  
  try {
    await getAccount(connection, relayerAta);
  } catch {
    console.log("Creating relayer ATA...");
    tx.add(createAssociatedTokenAccountInstruction(relayer.publicKey, relayerAta, relayer.publicKey, TOKEN_MINT));
  }
  
  // Claim instruction
  // claim(commitment, nullifier, relayer_fee)
  const relayerFee = BigInt(500_000); // 0.0005 tokens (0.5% of 0.1)
  const feeBuf = Buffer.alloc(8);
  feeBuf.writeBigUInt64LE(relayerFee);
  
  // Pad commitment and nullifier to 32 bytes
  const commitment32 = Buffer.alloc(32);
  commitment.copy(commitment32);
  const nullifier32 = Buffer.alloc(32);
  nullifier.copy(nullifier32);
  
  const claimData = Buffer.concat([CLAIM_DISC, commitment32, nullifier32, feeBuf]);
  
  // Accounts: pool, deposit, verifier_buffer, vault, recipient_token, relayer, relayer_token, token_program
  const claimIx = new TransactionInstruction({
    programId: MURKL_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: verifierBuffer, isSigner: false, isWritable: false },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: relayerAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: claimData,
  });
  
  tx.add(claimIx);
  
  console.log("\n=== Claiming ===");
  const sig = await sendAndConfirmTransaction(connection, tx, [relayer]);
  console.log("✅ Claim successful!");
  console.log("Tx:", sig);
  
  // Check balances
  const recipientBalance = await connection.getTokenAccountBalance(recipientAta);
  const relayerBalance = await connection.getTokenAccountBalance(relayerAta);
  console.log("\nRecipient balance:", recipientBalance.value.uiAmount, "tokens");
  console.log("Relayer balance:", relayerBalance.value.uiAmount, "tokens");
}

main().catch(console.error);
