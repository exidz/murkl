import { Connection, PublicKey } from "@solana/web3.js";
const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
const TOKEN_MINT = new PublicKey("DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), TOKEN_MINT.toBuffer()], MURKL_ID);
  
  const leaves: string[] = [];
  for (let i = 0; i < 2; i++) {
    const leafBuf = Buffer.alloc(8);
    leafBuf.writeBigUInt64LE(BigInt(i));
    const [depositPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("deposit"), poolPda.toBuffer(), leafBuf],
      MURKL_ID
    );
    
    const depositInfo = await connection.getAccountInfo(depositPda);
    if (depositInfo) {
      // DepositRecord: discriminator(8) + pool(32) + commitment(32) + amount(8) + leaf_index(8) + claimed(1) + bump(1)
      const commitment = depositInfo.data.slice(8 + 32, 8 + 32 + 32);
      console.log(`Leaf ${i}:`, commitment.toString("hex"));
      leaves.push(commitment.toString("hex"));
    }
  }
  
  const fs = require("fs");
  fs.writeFileSync("/tmp/merkle-full.json", JSON.stringify({
    leaves,
  }, null, 2));
  console.log("\nSaved to /tmp/merkle-full.json");
}
main().catch(console.error);
