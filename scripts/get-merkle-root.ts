import { Connection, PublicKey } from "@solana/web3.js";
const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
const TOKEN_MINT = new PublicKey("DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), TOKEN_MINT.toBuffer()], MURKL_ID);
  
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (!poolInfo) throw new Error("Pool not found");
  
  // Parse pool: discriminator(8) + admin(32) + token_mint(32) + vault(32) + merkle_root(32) + leaf_count(8)
  const merkleRoot = poolInfo.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32);
  const leafCount = poolInfo.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32);
  
  console.log("Merkle root:", merkleRoot.toString("hex"));
  console.log("Leaf count:", leafCount.toString());
  
  // Save merkle data for prover
  const fs = require("fs");
  fs.writeFileSync("/tmp/merkle.json", JSON.stringify({
    root: merkleRoot.toString("hex"),
    leaves: [], // We'd need to track all commitments
    depth: Math.ceil(Math.log2(Number(leafCount) + 1)) || 1,
  }, null, 2));
  console.log("Merkle data saved to /tmp/merkle.json");
}
main().catch(console.error);
