import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
const TOKEN_MINT = new PublicKey("DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9");

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
  
  // PDAs
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), TOKEN_MINT.toBuffer()], MURKL_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), poolPda.toBuffer()], MURKL_ID);
  
  // Get pool state
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (!poolInfo) throw new Error("Pool not found");
  
  // Parse leaf_count - account layout: discriminator(8) + admin(32) + token_mint(32) + vault(32) + merkle_root(32) + leaf_count(8)
  const leafCount = poolInfo.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32);
  console.log("Current leaf count:", leafCount.toString());
  
  // Deposit PDA
  const leafCountBuf = Buffer.alloc(8);
  leafCountBuf.writeBigUInt64LE(leafCount);
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("deposit"), poolPda.toBuffer(), leafCountBuf],
    MURKL_ID
  );
  console.log("Deposit PDA:", depositPda.toBase58());
  
  // Get token account
  const tokenAccount = await getAssociatedTokenAddress(TOKEN_MINT, wallet.publicKey);
  console.log("Token account:", tokenAccount.toBase58());
  
  // Generate commitment
  const secret = Keypair.generate().secretKey.slice(0, 32);
  const commitment = keccak256(Buffer.from(secret), leafCountBuf);
  
  // Deposit instruction
  const depositDiscriminator = Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]);
  const depositAmount = BigInt(100_000_000); // 0.1 tokens
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(depositAmount);
  const depositData = Buffer.concat([depositDiscriminator, amountBuf, commitment]);
  
  const depositIx = new TransactionInstruction({
    programId: MURKL_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: depositData,
  });
  
  console.log("\nDepositing 0.1 tokens...");
  const tx = new Transaction().add(depositIx);
  const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
  
  console.log("✅ Deposit successful!");
  console.log("Tx:", sig);
  console.log("\nSave for claiming:");
  console.log("  Secret:", Buffer.from(secret).toString("hex"));
  console.log("  Leaf index:", leafCount.toString());
  console.log("  Commitment:", commitment.toString("hex"));
}

main().catch(console.error);
