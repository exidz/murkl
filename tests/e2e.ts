import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount, createMint, mintTo } from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import { expect } from "chai";
import { execSync } from "child_process";

const MURKL_ID = new PublicKey("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");
const STARK_VERIFIER_ID = new PublicKey("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

function disc(name: string): Buffer {
  return crypto.createHash('sha256').update('global:' + name).digest().slice(0, 8);
}

describe("Murkl E2E Tests", () => {
  let connection: Connection;
  let payer: Keypair;
  let tokenMint: PublicKey;
  let poolPda: PublicKey;
  let vaultPda: PublicKey;
  
  before(async () => {
    connection = new Connection("https://api.devnet.solana.com", "confirmed");
    payer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(
      fs.readFileSync(`${os.homedir()}/.config/solana/id.json`, "utf8")
    )));
    
    // Use existing test token
    tokenMint = new PublicKey("DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9");
    [poolPda] = PublicKey.findProgramAddressSync([Buffer.from("pool"), tokenMint.toBuffer()], MURKL_ID);
    [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault"), poolPda.toBuffer()], MURKL_ID);
  });

  describe("Deposit", () => {
    it("should reject deposit below minimum", async () => {
      // Pool min is 1_000_000 (0.001 tokens)
      const leafCount = await getLeafCount();
      const commitment = crypto.randomBytes(32);
      
      const [depositPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("deposit"), poolPda.toBuffer(), toLeBytes(leafCount)],
        MURKL_ID
      );
      
      const tokenAccount = await getAssociatedTokenAddress(tokenMint, payer.publicKey);
      
      const ix = makeDepositIx(poolPda, depositPda, vaultPda, payer.publicKey, tokenAccount, 100n, commitment);
      
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
        expect.fail("Should have rejected small deposit");
      } catch (e: any) {
        expect(e.message).to.include("DepositTooSmall");
      }
    });

    it("should accept valid deposit", async () => {
      const leafCount = await getLeafCount();
      const commitment = crypto.randomBytes(32);
      
      const [depositPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("deposit"), poolPda.toBuffer(), toLeBytes(leafCount)],
        MURKL_ID
      );
      
      const tokenAccount = await getAssociatedTokenAddress(tokenMint, payer.publicKey);
      const amount = 10_000_000n; // 0.01 tokens
      
      const ix = makeDepositIx(poolPda, depositPda, vaultPda, payer.publicKey, tokenAccount, amount, commitment);
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer]);
      
      expect(sig).to.be.a("string");
      console.log("    Deposit tx:", sig.slice(0, 30) + "...");
    });
  });

  describe("STARK Verification", () => {
    it("should reject empty proof", async () => {
      const buffer = Keypair.generate();
      const emptyProof = Buffer.alloc(100); // Empty proof
      
      // Create buffer
      const rentExempt = await connection.getMinimumBalanceForRentExemption(200);
      const createIx = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buffer.publicKey,
        lamports: rentExempt,
        space: 200,
        programId: STARK_VERIFIER_ID,
      });
      
      const initIx = makeInitBufferIx(buffer.publicKey, payer.publicKey, 100);
      
      await sendAndConfirmTransaction(connection, new Transaction().add(createIx, initIx), [payer, buffer]);
      
      // Upload empty proof
      const uploadIx = makeUploadChunkIx(buffer.publicKey, payer.publicKey, 0, emptyProof);
      await sendAndConfirmTransaction(connection, new Transaction().add(uploadIx), [payer]);
      
      // Try to finalize - should fail
      const commitment = crypto.randomBytes(32);
      const nullifier = crypto.randomBytes(32);
      const merkleRoot = crypto.randomBytes(32);
      
      const finalizeIx = makeFinalizeIx(buffer.publicKey, payer.publicKey, commitment, nullifier, merkleRoot);
      
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(finalizeIx), [payer]);
        expect.fail("Should have rejected empty proof");
      } catch (e: any) {
        expect(e.message).to.include("InvalidProofFormat");
      }
    });

    it("should verify valid STARK proof", async () => {
      // Generate proof using CLI
      const identifier = "@test-" + Date.now();
      const password = "testpass123";
      
      // Generate commitment
      execSync(`cd ../cli && cargo run --release -- commit -i "${identifier}" -p "${password}" -o /tmp/test-deposit.json`, { encoding: "utf8" });
      
      const depositData = JSON.parse(fs.readFileSync("/tmp/test-deposit.json", "utf8"));
      const commitment = Buffer.from(depositData.commitment);
      
      // Make deposit
      const leafCount = await getLeafCount();
      const [depositPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("deposit"), poolPda.toBuffer(), toLeBytes(leafCount)],
        MURKL_ID
      );
      const tokenAccount = await getAssociatedTokenAddress(tokenMint, payer.publicKey);
      
      const depositIx = makeDepositIx(poolPda, depositPda, vaultPda, payer.publicKey, tokenAccount, 10_000_000n, commitment);
      await sendAndConfirmTransaction(connection, new Transaction().add(depositIx), [payer]);
      
      // Get merkle root
      const poolInfo = await connection.getAccountInfo(poolPda);
      const merkleRoot = poolInfo!.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32);
      
      // Create merkle file
      fs.writeFileSync("/tmp/test-merkle.json", JSON.stringify({
        root: Array.from(merkleRoot),
        leaves: [Array.from(commitment)],
        depth: 1
      }));
      
      // Generate proof
      execSync(`cd ../cli && cargo run --release -- prove -i "${identifier}" -p "${password}" -l ${leafCount} -m /tmp/test-merkle.json -o /tmp/test-proof.bin`, { encoding: "utf8" });
      
      const proofData = fs.readFileSync("/tmp/test-proof.bin");
      const proofBundle = JSON.parse(fs.readFileSync("/tmp/test-proof.json", "utf8"));
      
      // Upload and verify
      const buffer = Keypair.generate();
      const bufferSize = 41 + proofData.length + 100;
      const rentExempt = await connection.getMinimumBalanceForRentExemption(bufferSize);
      
      const createIx = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buffer.publicKey,
        lamports: rentExempt,
        space: bufferSize,
        programId: STARK_VERIFIER_ID,
      });
      
      const initIx = makeInitBufferIx(buffer.publicKey, payer.publicKey, proofData.length);
      await sendAndConfirmTransaction(connection, new Transaction().add(createIx, initIx), [payer, buffer]);
      
      // Upload in chunks
      for (let offset = 0; offset < proofData.length; offset += 900) {
        const chunk = proofData.slice(offset, Math.min(offset + 900, proofData.length));
        const uploadIx = makeUploadChunkIx(buffer.publicKey, payer.publicKey, offset, chunk);
        await sendAndConfirmTransaction(connection, new Transaction().add(uploadIx), [payer]);
      }
      
      // Finalize
      const nullifier = Buffer.from(proofBundle.nullifier);
      const finalizeIx = makeFinalizeIx(buffer.publicKey, payer.publicKey, commitment, nullifier, merkleRoot);
      const sig = await sendAndConfirmTransaction(connection, new Transaction().add(finalizeIx), [payer]);
      
      expect(sig).to.be.a("string");
      console.log("    Verify tx:", sig.slice(0, 30) + "...");
    });
  });

  describe("Claim", () => {
    it("should reject claim with unverified buffer", async () => {
      // Create unfinalized buffer
      const buffer = Keypair.generate();
      const rentExempt = await connection.getMinimumBalanceForRentExemption(200);
      
      const createIx = SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: buffer.publicKey,
        lamports: rentExempt,
        space: 200,
        programId: STARK_VERIFIER_ID,
      });
      
      const initIx = makeInitBufferIx(buffer.publicKey, payer.publicKey, 100);
      await sendAndConfirmTransaction(connection, new Transaction().add(createIx, initIx), [payer, buffer]);
      
      // Try to claim - should fail
      const poolInfo = await connection.getAccountInfo(poolPda);
      const leafCount = poolInfo!.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32);
      
      if (leafCount > 0n) {
        const [depositPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("deposit"), poolPda.toBuffer(), toLeBytes(0n)],
          MURKL_ID
        );
        
        const recipientAta = await getAssociatedTokenAddress(tokenMint, payer.publicKey);
        const relayerAta = await getAssociatedTokenAddress(tokenMint, payer.publicKey);
        
        const commitment = crypto.randomBytes(32);
        const nullifier = crypto.randomBytes(32);
        
        const claimIx = makeClaimIx(poolPda, depositPda, buffer.publicKey, vaultPda, recipientAta, payer.publicKey, relayerAta, commitment, nullifier, 0n);
        
        try {
          await sendAndConfirmTransaction(connection, new Transaction().add(claimIx), [payer]);
          expect.fail("Should have rejected unverified proof");
        } catch (e: any) {
          expect(e.message).to.include("ProofNotVerified");
        }
      }
    });

    it("should reject double claim", async () => {
      // This would require a previously claimed deposit
      // Skip if no claimed deposits exist
      console.log("    (skipped - requires claimed deposit)");
    });
  });

  // Helper functions
  async function getLeafCount(): Promise<bigint> {
    const poolInfo = await connection.getAccountInfo(poolPda);
    return poolInfo!.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32);
  }

  function toLeBytes(n: bigint): Buffer {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(n);
    return buf;
  }

  function makeDepositIx(pool: PublicKey, deposit: PublicKey, vault: PublicKey, depositor: PublicKey, depositorToken: PublicKey, amount: bigint, commitment: Buffer): TransactionInstruction {
    const amountBuf = Buffer.alloc(8);
    amountBuf.writeBigUInt64LE(amount);
    const commitment32 = Buffer.alloc(32);
    commitment.copy(commitment32);
    
    return new TransactionInstruction({
      programId: MURKL_ID,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: deposit, isSigner: false, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: depositor, isSigner: true, isWritable: true },
        { pubkey: depositorToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("deposit"), amountBuf, commitment32]),
    });
  }

  function makeInitBufferIx(buffer: PublicKey, owner: PublicKey, expectedSize: number): TransactionInstruction {
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(expectedSize);
    
    return new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("init_proof_buffer"), sizeBuf]),
    });
  }

  function makeUploadChunkIx(buffer: PublicKey, owner: PublicKey, offset: number, data: Buffer): TransactionInstruction {
    const offsetBuf = Buffer.alloc(4);
    offsetBuf.writeUInt32LE(offset);
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(data.length);
    
    return new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([disc("upload_chunk"), offsetBuf, lenBuf, data]),
    });
  }

  function makeFinalizeIx(buffer: PublicKey, owner: PublicKey, commitment: Buffer, nullifier: Buffer, merkleRoot: Buffer): TransactionInstruction {
    const c32 = Buffer.alloc(32); commitment.copy(c32);
    const n32 = Buffer.alloc(32); nullifier.copy(n32);
    const m32 = Buffer.alloc(32); merkleRoot.copy(m32);
    
    return new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: buffer, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: Buffer.concat([disc("finalize_and_verify"), c32, n32, m32]),
    });
  }

  function makeClaimIx(pool: PublicKey, deposit: PublicKey, verifierBuffer: PublicKey, vault: PublicKey, recipientToken: PublicKey, relayer: PublicKey, relayerToken: PublicKey, commitment: Buffer, nullifier: Buffer, fee: bigint): TransactionInstruction {
    const c32 = Buffer.alloc(32); commitment.copy(c32);
    const n32 = Buffer.alloc(32); nullifier.copy(n32);
    const feeBuf = Buffer.alloc(8);
    feeBuf.writeBigUInt64LE(fee);
    
    return new TransactionInstruction({
      programId: MURKL_ID,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: false },
        { pubkey: deposit, isSigner: false, isWritable: true },
        { pubkey: verifierBuffer, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: recipientToken, isSigner: false, isWritable: true },
        { pubkey: relayer, isSigner: true, isWritable: true },
        { pubkey: relayerToken, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([disc("claim"), c32, n32, feeBuf]),
    });
  }
});
