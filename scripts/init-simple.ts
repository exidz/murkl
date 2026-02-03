import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const wallet = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  
  const [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], MURKL_ID);
  console.log("Config PDA:", configPda.toBase58());
  
  const configInfo = await connection.getAccountInfo(configPda);
  if (configInfo) {
    console.log("✅ Config already exists!");
    return;
  }
  
  // Anchor discriminator for initialize_config
  const discriminator = Buffer.from([208, 127, 21, 1, 194, 190, 196, 70]);
  
  // Order: config, admin, system_program (matches Anchor struct)
  const keys = [
    { pubkey: configPda, isSigner: false, isWritable: true },
    { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  
  const ix = new TransactionInstruction({ programId: MURKL_ID, keys, data: discriminator });
  
  console.log("Sending initialize_config...");
  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  
  const sig = await connection.sendRawTransaction(tx.serialize());
  console.log("Tx:", sig);
  await connection.confirmTransaction(sig);
  console.log("✅ Config initialized!");
}

main().catch(console.error);
