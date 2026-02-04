/**
 * Fresh E2E Test - Creates new accounts from scratch
 * 
 * 1. Initialize GlobalConfig (if needed)
 * 2. Create new pool
 * 3. Make deposit
 * 4. Generate & verify proof via stark-verifier
 * 5. Claim via murkl
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sha3 from 'js-sha3';
const { keccak256 } = sha3;

// Program IDs
const MURKL_PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const STARK_VERIFIER_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');

const CHUNK_SIZE = 800;  // Safe chunk size with proper serialization

// ============================================================================
// Discriminators (sha256("global:<name>")[0..8])
// ============================================================================

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ============================================================================
// Crypto
// ============================================================================

const M31_PRIME = 0x7FFFFFFF;

function hashPassword(password: string): number {
  const data = Buffer.concat([Buffer.from('murkl_password_v1'), Buffer.from(password)]);
  const hash = Buffer.from(keccak256(data), 'hex');
  return hash.readUInt32LE(0) % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = Buffer.concat([Buffer.from('murkl_identifier_v1'), Buffer.from(normalized)]);
  const hash = Buffer.from(keccak256(data), 'hex');
  return hash.readUInt32LE(0) % M31_PRIME;
}

function computeCommitment(identifierHash: number, secretHash: number): Buffer {
  // FIXED: Added domain prefix to match WASM prover
  const prefix = Buffer.from('murkl_m31_hash_v1');
  const data = Buffer.alloc(prefix.length + 8);
  prefix.copy(data, 0);
  data.writeUInt32LE(identifierHash, prefix.length);
  data.writeUInt32LE(secretHash, prefix.length + 4);
  return Buffer.from(keccak256(data), 'hex');
}

function computeNullifier(secretHash: number, leafIndex: number): Buffer {
  const prefix = Buffer.from('murkl_m31_hash_v1');
  const data = Buffer.alloc(prefix.length + 8);
  prefix.copy(data, 0);
  data.writeUInt32LE(identifierHash, prefix.length);
  data.writeUInt32LE(secretHash, prefix.length + 4);
  return Buffer.from(keccak256(data), 'hex');
}

// ============================================================================
// Mock Proof Generator
// ============================================================================

function generateMockProof(commitment: Buffer, nullifier: Buffer, merkleRoot: Buffer): Buffer {
  const proof = Buffer.alloc(3800);
  let offset = 0;

  // Trace commitment (32 bytes)
  Buffer.from(keccak256(Buffer.concat([Buffer.from('trace'), commitment])), 'hex').copy(proof, offset);
  offset += 32;

  // Composition commitment (32 bytes)
  Buffer.from(keccak256(Buffer.concat([Buffer.from('composition'), nullifier])), 'hex').copy(proof, offset);
  offset += 32;

  // OODS values (16 bytes each)
  Buffer.from(keccak256(Buffer.concat([Buffer.from('trace_oods'), commitment])), 'hex').slice(0, 16).copy(proof, offset);
  offset += 16;
  Buffer.from(keccak256(Buffer.concat([Buffer.from('comp_oods'), nullifier])), 'hex').slice(0, 16).copy(proof, offset);
  offset += 16;

  // FRI layers (3)
  proof[offset++] = 3;
  for (let i = 0; i < 3; i++) {
    Buffer.from(keccak256(Buffer.concat([Buffer.from(`fri_${i}`), merkleRoot])), 'hex').copy(proof, offset);
    offset += 32;
  }

  // Final polynomial (2 coefficients)
  proof.writeUInt16LE(2, offset);
  offset += 2;
  for (let i = 0; i < 2; i++) {
    Buffer.from(keccak256(Buffer.concat([Buffer.from(`final_${i}`), commitment])), 'hex').slice(0, 16).copy(proof, offset);
    offset += 16;
  }

  // Queries (4)
  proof[offset++] = 4;
  const traceCommitment = Buffer.from(keccak256(Buffer.concat([Buffer.from('trace'), commitment])), 'hex');
  const compositionCommitment = Buffer.from(keccak256(Buffer.concat([Buffer.from('composition'), nullifier])), 'hex');

  for (let q = 0; q < 4; q++) {
    proof.writeUInt32LE(q * 1000, offset);
    offset += 4;

    Buffer.from(keccak256(Buffer.concat([Buffer.from(`trace_q${q}`), commitment])), 'hex').copy(proof, offset);
    offset += 32;

    proof[offset++] = 8;
    for (let p = 0; p < 8; p++) {
      Buffer.from(keccak256(Buffer.concat([Buffer.from(`trace_path_${q}_${p}`), traceCommitment])), 'hex').copy(proof, offset);
      offset += 32;
    }

    Buffer.from(keccak256(Buffer.concat([Buffer.from(`comp_q${q}`), nullifier])), 'hex').copy(proof, offset);
    offset += 32;

    proof[offset++] = 8;
    for (let p = 0; p < 8; p++) {
      Buffer.from(keccak256(Buffer.concat([Buffer.from(`comp_path_${q}_${p}`), compositionCommitment])), 'hex').copy(proof, offset);
      offset += 32;
    }

    for (let l = 0; l < 3; l++) {
      for (let s = 0; s < 4; s++) {
        Buffer.from(keccak256(Buffer.concat([Buffer.from(`fri_${l}_${q}_${s}`), merkleRoot])), 'hex').slice(0, 16).copy(proof, offset);
        offset += 16;
      }
      proof[offset++] = 3;
      for (let p = 0; p < 3; p++) {
        Buffer.from(keccak256(Buffer.concat([Buffer.from(`fri_path_${l}_${q}_${p}`)])), 'hex').copy(proof, offset);
        offset += 32;
      }
    }
  }

  return proof.slice(0, offset);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('🐈‍⬛ Fresh E2E Test\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));

  console.log(`👛 Wallet: ${payer.publicKey.toBase58()}`);
  console.log(`💰 Balance: ${(await connection.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL\n`);

  // Step 1: Create test token
  console.log('📦 Step 1: Creating test token...');
  const mint = await createMint(connection, payer, payer.publicKey, null, 9);
  console.log(`   Mint: ${mint.toBase58()}`);

  // Get/create payer's token account
  const payerAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  
  // Mint some tokens
  await mintTo(connection, payer, mint, payerAta.address, payer, 1000 * 10**9);
  console.log(`   Minted 1000 tokens to ${payerAta.address.toBase58()}`);

  // Step 2: Initialize pool
  console.log('\n📦 Step 2: Creating pool...');
  
  const [poolPda, poolBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), mint.toBuffer()],
    MURKL_PROGRAM_ID
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), poolPda.toBuffer()],
    MURKL_PROGRAM_ID
  );
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    MURKL_PROGRAM_ID
  );

  console.log(`   Pool PDA: ${poolPda.toBase58()}`);
  console.log(`   Vault PDA: ${vaultPda.toBase58()}`);

  // Check if config exists
  const configInfo = await connection.getAccountInfo(configPda);
  if (!configInfo) {
    console.log('   Initializing global config...');
    const initConfigData = getDiscriminator('initialize_config');
    const initConfigIx = new TransactionInstruction({
      programId: MURKL_PROGRAM_ID,
      keys: [
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initConfigData,
    });
    const configTx = new Transaction().add(initConfigIx);
    await sendAndConfirmTransaction(connection, configTx, [payer], { skipPreflight: true });
    console.log('   ✅ Config initialized');
  }

  // Initialize pool
  const poolConfig = Buffer.alloc(12);
  poolConfig.writeBigUInt64LE(BigInt(10**9), 0); // min_deposit = 1 token
  poolConfig.writeUInt16LE(100, 8); // max_relayer_fee_bps = 1%
  poolConfig.writeUInt16LE(0, 10); // padding

  const initPoolData = Buffer.concat([
    getDiscriminator('initialize_pool'),
    poolConfig,
  ]);

  const initPoolIx = new TransactionInstruction({
    programId: MURKL_PROGRAM_ID,
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: false },      // 1. config
      { pubkey: poolPda, isSigner: false, isWritable: true },         // 2. pool
      { pubkey: mint, isSigner: false, isWritable: false },           // 3. token_mint
      { pubkey: vaultPda, isSigner: false, isWritable: true },        // 4. vault
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },  // 5. admin
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }, // 8. rent
    ],
    data: initPoolData,
  });

  try {
    const poolTx = new Transaction().add(initPoolIx);
    await sendAndConfirmTransaction(connection, poolTx, [payer], { skipPreflight: true });
    console.log('   ✅ Pool created');
  } catch (e: any) {
    console.log(`   Pool creation error: ${e.message}`);
    // Pool might already exist, continue
  }

  // Step 3: Make deposit
  console.log('\n📦 Step 3: Making deposit...');
  
  const identifier = `@fresh-test-${Date.now()}`;
  const password = 'securepass123';
  const depositAmount = BigInt(10 * 10**9); // 10 tokens

  const idHash = hashIdentifier(identifier);
  const secretHash = hashPassword(password);
  const commitment = computeCommitment(idHash, secretHash);

  console.log(`   Identifier: ${identifier}`);
  console.log(`   Commitment: 0x${commitment.slice(0, 8).toString('hex')}...`);

  // Get leaf index (current leaf_count from pool)
  const poolInfo = await connection.getAccountInfo(poolPda);
  if (!poolInfo) throw new Error('Pool not found');
  
  // Pool layout: disc(8) + admin(32) + token_mint(32) + vault(32) + merkle_root(32) + leaf_count(8) + config(12) + paused(1) + bump(1)
  const leafIndex = Number(poolInfo.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32));
  console.log(`   Leaf index: ${leafIndex}`);

  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), poolPda.toBuffer(), Buffer.from(new BigUint64Array([BigInt(leafIndex)]).buffer)],
    MURKL_PROGRAM_ID
  );

  const depositData = Buffer.concat([
    getDiscriminator('deposit'),
    Buffer.from(new BigUint64Array([depositAmount]).buffer),
    commitment,
  ]);

  const depositIx = new TransactionInstruction({
    programId: MURKL_PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: payerAta.address, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: depositData,
  });

  const depositTx = new Transaction().add(depositIx);
  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [payer], { skipPreflight: true });
  console.log(`   ✅ Deposit: ${depositSig.slice(0, 20)}...`);

  // Get updated merkle root
  const poolInfoAfter = await connection.getAccountInfo(poolPda);
  if (!poolInfoAfter) throw new Error('Pool not found after deposit');
  const merkleRoot = Buffer.from(poolInfoAfter.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32));
  console.log(`   Merkle root: 0x${merkleRoot.slice(0, 8).toString('hex')}...`);

  // Step 4: Generate and verify proof via stark-verifier
  console.log('\n🔐 Step 4: Generating and verifying proof...');
  
  const nullifier = computeNullifier(secretHash, leafIndex);
  console.log(`   Nullifier: 0x${nullifier.slice(0, 8).toString('hex')}...`);

  const proofBytes = generateMockProof(commitment, nullifier, merkleRoot);
  console.log(`   Proof size: ${proofBytes.length} bytes`);

  // Create proof buffer (raw account for stark-verifier)
  const proofBuffer = Keypair.generate();
  const bufferSize = 137 + proofBytes.length;
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);

  const createBufferIx = SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: proofBuffer.publicKey,
    lamports: bufferRent,
    space: bufferSize,
    programId: STARK_VERIFIER_ID,
  });

  const initBufferData = Buffer.concat([
    getDiscriminator('init_proof_buffer'),
    Buffer.from(new Uint32Array([proofBytes.length]).buffer),
  ]);

  const initBufferIx = new TransactionInstruction({
    programId: STARK_VERIFIER_ID,
    keys: [
      { pubkey: proofBuffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initBufferData,
  });

  const bufferTx = new Transaction().add(createBufferIx, initBufferIx);
  await sendAndConfirmTransaction(connection, bufferTx, [payer, proofBuffer], { skipPreflight: true });
  console.log(`   ✅ Buffer: ${proofBuffer.publicKey.toBase58()}`);

  // Upload chunks
  const numChunks = Math.ceil(proofBytes.length / CHUNK_SIZE);
  for (let i = 0; i < numChunks; i++) {
    const offset = i * CHUNK_SIZE;
    const chunk = proofBytes.slice(offset, offset + CHUNK_SIZE);

    // Borsh format: discriminator(8) + offset(4) + vec_len(4) + data
    const vecLen = Buffer.alloc(4);
    vecLen.writeUInt32LE(chunk.length);
    
    const uploadData = Buffer.concat([
      getDiscriminator('upload_chunk'),
      Buffer.from(new Uint32Array([offset]).buffer),
      vecLen,  // Vec length prefix (Borsh format)
      chunk,
    ]);

    const uploadIx = new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: proofBuffer.publicKey, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
      ],
      data: uploadData,
    });

    await sendAndConfirmTransaction(connection, new Transaction().add(uploadIx), [payer], { skipPreflight: true });
  }
  console.log(`   ✅ Uploaded ${numChunks} chunks`);

  // Finalize and verify
  const finalizeData = Buffer.concat([
    getDiscriminator('finalize_and_verify'),
    commitment,
    nullifier,
    merkleRoot,
  ]);

  const finalizeIx = new TransactionInstruction({
    programId: STARK_VERIFIER_ID,
    keys: [
      { pubkey: proofBuffer.publicKey, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    data: finalizeData,
  });

  const verifySig = await sendAndConfirmTransaction(connection, new Transaction().add(finalizeIx), [payer], { skipPreflight: true });
  console.log(`   ✅ Verified: ${verifySig.slice(0, 20)}...`);

  // Step 5: Claim via murkl
  console.log('\n💸 Step 5: Claiming tokens...');

  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), poolPda.toBuffer(), nullifier],
    MURKL_PROGRAM_ID
  );

  const recipientAta = await getAssociatedTokenAddress(mint, payer.publicKey);

  const relayerFee = BigInt(0);
  const claimData = Buffer.concat([
    getDiscriminator('claim'),
    Buffer.from(new BigUint64Array([relayerFee]).buffer),
    nullifier,
  ]);

  const claimIx = new TransactionInstruction({
    programId: MURKL_PROGRAM_ID,
    keys: [
      { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: proofBuffer.publicKey, isSigner: false, isWritable: false },
      { pubkey: nullifierPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true }, // relayer_token = recipient for self-claim
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: claimData,
  });

  const claimTx = new Transaction().add(claimIx);
  claimTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  claimTx.feePayer = payer.publicKey;

  console.log('   Simulating...');
  const simResult = await connection.simulateTransaction(claimTx, [payer]);
  
  if (simResult.value.err) {
    console.log(`   ❌ Claim failed: ${JSON.stringify(simResult.value.err)}`);
    console.log('   Logs:');
    simResult.value.logs?.forEach(l => console.log(`      ${l}`));
    process.exit(1);
  }

  const claimSig = await sendAndConfirmTransaction(connection, claimTx, [payer], { skipPreflight: true });
  console.log(`   ✅ Claimed: ${claimSig}`);

  console.log('\n🎉 FULL E2E SUCCESS!');
  console.log(`   Token: ${mint.toBase58()}`);
  console.log(`   Pool: ${poolPda.toBase58()}`);
  console.log(`   Deposit: ${depositPda.toBase58()}`);
  console.log(`   Verifier Buffer: ${proofBuffer.publicKey.toBase58()}`);
}

main().catch(e => {
  console.error('\n❌ Error:', e.message);
  process.exit(1);
});
