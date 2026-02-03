import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo } from "@solana/spl-token";
import { assert } from "chai";

describe("murkl", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const STARK_VERIFIER_ID = new PublicKey("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");
  const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

  it("Programs are deployed", async () => {
    // Check stark-verifier
    const verifierInfo = await provider.connection.getAccountInfo(STARK_VERIFIER_ID);
    console.log("stark-verifier deployed:", verifierInfo !== null);
    
    // Check murkl
    const murklInfo = await provider.connection.getAccountInfo(MURKL_ID);
    console.log("murkl deployed:", murklInfo !== null);
  });

  it("Initialize config", async () => {
    // TODO: Call initialize_config
    console.log("Config init test - placeholder");
  });

  it("Initialize pool", async () => {
    // TODO: Call initialize_pool
    console.log("Pool init test - placeholder");
  });
});
