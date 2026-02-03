import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
const TOKEN_MINT = new PublicKey("DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Token:", TOKEN_MINT.toBase58());
  
  // Derive PDAs
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], MURKL_ID);
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), TOKEN_MINT.toBuffer()], MURKL_ID);
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), poolPda.toBuffer()], MURKL_ID);
  
  console.log("Config:", configPda.toBase58());
  console.log("Pool:", poolPda.toBase58());
  console.log("Vault:", vaultPda.toBase58());
  
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log("Pool already exists, size:", poolInfo.data.length);
    return;
  }
  
  // Anchor discriminator for initialize_pool
  const discriminator = Buffer.from([95, 180, 10, 172, 84, 174, 232, 40]);
  
  // PoolConfig: { min_deposit: u64, max_relayer_fee_bps: u16 }
  const minDeposit = Buffer.alloc(8);
  minDeposit.writeBigUInt64LE(BigInt(1000000)); // 0.001 tokens
  const relayerFeeBps = Buffer.alloc(2);
  relayerFeeBps.writeUInt16LE(50); // 0.5%
  
  const data = Buffer.concat([discriminator, minDeposit, relayerFeeBps]);
  
  const keys = [
    { pubkey: configPda, isSigner: false, isWritable: false },
    { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
    { pubkey: vaultPda, isSigner: false, isWritable: true },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];
  
  const ix = new TransactionInstruction({ programId: MURKL_ID, keys, data });
  
  console.log("\nCreating test pool...");
  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  
  const sig = await connection.sendRawTransaction(tx.serialize());
  console.log("Tx:", sig);
  await connection.confirmTransaction(sig);
  console.log("✅ Test pool created!");
}

main().catch(console.error);
