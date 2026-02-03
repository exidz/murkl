import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT, createWrappedNativeAccount, getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";

// Load IDL
const idl = JSON.parse(fs.readFileSync("./target/idl/murkl_program.json", "utf8"));

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

async function main() {
  // Connect to devnet
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Load keypair
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const wallet = Keypair.fromSecretKey(new Uint8Array(keypairData));
  
  console.log("Wallet:", wallet.publicKey.toBase58());
  console.log("Balance:", await connection.getBalance(wallet.publicKey) / 1e9, "SOL");
  
  // Create provider
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(wallet),
    { commitment: "confirmed" }
  );
  anchor.setProvider(provider);
  
  const program = new Program(idl, provider);
  
  // Derive PDAs
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    MURKL_ID
  );
  console.log("Config PDA:", configPda.toBase58());
  
  // Check if config exists
  const configInfo = await connection.getAccountInfo(configPda);
  if (configInfo) {
    console.log("Config already initialized!");
  } else {
    console.log("Initializing config...");
    try {
      const tx = await program.methods
        .initializeConfig()
        .accounts({
          admin: wallet.publicKey,
          config: configPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Config initialized! Tx:", tx);
    } catch (e) {
      console.error("Failed to init config:", e);
    }
  }
  
  // Derive pool PDA for WSOL
  const [poolPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), NATIVE_MINT.toBuffer()],
    MURKL_ID
  );
  console.log("WSOL Pool PDA:", poolPda.toBase58());
  
  // Check if pool exists
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (poolInfo) {
    console.log("WSOL Pool already initialized!");
  } else {
    console.log("Creating WSOL pool...");
    
    // Derive vault PDA
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), NATIVE_MINT.toBuffer()],
      MURKL_ID
    );
    console.log("Vault PDA:", vaultPda.toBase58());
    
    try {
      const tx = await program.methods
        .initializePool({
          minDeposit: new anchor.BN(1000000), // 0.001 SOL
          relayerFeeBps: 50, // 0.5%
        })
        .accounts({
          admin: wallet.publicKey,
          config: configPda,
          pool: poolPda,
          tokenMint: NATIVE_MINT,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log("Pool created! Tx:", tx);
    } catch (e) {
      console.error("Failed to create pool:", e);
    }
  }
  
  console.log("\n=== Summary ===");
  console.log("Config:", configPda.toBase58());
  console.log("WSOL Pool:", poolPda.toBase58());
}

main().catch(console.error);
