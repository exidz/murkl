import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, SYSVAR_RENT_PUBKEY, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT, createSyncNativeInstruction, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

function keccak256(...inputs: Buffer[]): Buffer {
  const hash = createHash("sha3-256");
  for (const input of inputs) hash.update(input);
  return hash.digest();
}

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Balance:", await connection.getBalance(wallet.publicKey) / 1e9, "SOL");
  
  // PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), NATIVE_MINT.toBuffer()], MURKL_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), poolPda.toBuffer()], MURKL_ID);
  
  // Get pool state to find leaf_count
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (!poolInfo) throw new Error("Pool not found");
  
  // Parse leaf_count from pool data (offset varies, let's find it)
  // Pool struct: admin(32) + token_mint(32) + vault(32) + merkle_root(32) + leaf_count(8) + config + ...
  const leafCount = poolInfo.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32); // after discriminator + admin + mint + vault + root
  console.log("Current leaf count:", leafCount.toString());
  
  // Deposit PDA for this leaf
  const leafCountBuf = Buffer.alloc(8);
  leafCountBuf.writeBigUInt64LE(leafCount);
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), poolPda.toBuffer(), leafCountBuf],
    MURKL_ID
  );
  console.log("Deposit PDA:", depositPda.toBase58());
  
  // Create WSOL token account if needed
  const wsolAta = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);
  console.log("WSOL ATA:", wsolAta.toBase58());
  
  const tx = new Transaction();
  
  // Check if ATA exists
  try {
    await getAccount(connection, wsolAta);
    console.log("WSOL ATA exists");
  } catch {
    console.log("Creating WSOL ATA...");
    tx.add(createAssociatedTokenAccountInstruction(wallet.publicKey, wsolAta, wallet.publicKey, NATIVE_MINT));
  }
  
  // Wrap 0.01 SOL
  const depositAmount = 10_000_000; // 0.01 SOL in lamports
  tx.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: wsolAta,
    lamports: depositAmount,
  }));
  tx.add(createSyncNativeInstruction(wsolAta));
  
  // Generate commitment (secret + amount hash)
  const secret = Keypair.generate().secretKey.slice(0, 32);
  const commitment = keccak256(Buffer.from(secret), leafCountBuf);
  console.log("Commitment:", commitment.toString("hex"));
  console.log("Secret (save this!):", Buffer.from(secret).toString("hex"));
  
  // Deposit instruction
  const depositDiscriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]); // anchor discriminator
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(BigInt(depositAmount));
  const depositData = Buffer.concat([depositDiscriminator, amountBuf, commitment]);
  
  // Accounts: pool, deposit, vault, depositor, depositor_token, token_program, system_program
  const depositIx = new TransactionInstruction({
    programId: MURKL_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: wsolAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: depositData,
  });
  tx.add(depositIx);
  
  console.log("\nSending deposit tx...");
  tx.feePayer = wallet.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  console.log("✅ Deposit successful!");
  console.log("Tx:", sig);
  console.log("\nDeposit info:");
  console.log("  Pool:", poolPda.toBase58());
  console.log("  Leaf index:", leafCount.toString());
  console.log("  Amount:", depositAmount / 1e9, "SOL");
  console.log("  Commitment:", commitment.toString("hex"));
  console.log("\n⚠️ Save the secret to claim later:", Buffer.from(secret).toString("hex"));
}

main().catch(console.error);
