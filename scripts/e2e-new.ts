/**
 * Murkl E2E Test - New Two-Program Architecture
 * 
 * Flow:
 * 1. stark-verifier: init_proof_buffer
 * 2. stark-verifier: upload_chunk (x N)
 * 3. stark-verifier: finalize_and_verify
 * 4. murkl: claim (reads verified buffer from stark-verifier)
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
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sha3 from 'js-sha3';
const { keccak256 } = sha3;

// Program IDs
const MURKL_PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const STARK_VERIFIER_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');

const M31_PRIME = 0x7FFFFFFF;
const CHUNK_SIZE = 900;

// Buffer layout offsets (stark-verifier)
const OFFSET_FINALIZED = 40;
const OFFSET_COMMITMENT = 41;
const OFFSET_NULLIFIER = 73;
const OFFSET_MERKLE_ROOT = 105;
const HEADER_SIZE = 137;

// ============================================================================
// Discriminators
// ============================================================================

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ============================================================================
// Crypto (matching WASM prover)
// ============================================================================

function hashPassword(password: string): number {
  const data = Buffer.concat([
    Buffer.from('murkl_password_v1'),
    Buffer.from(password)
  ]);
  const hash = Buffer.from(keccak256(data), 'hex');
  return hash.readUInt32LE(0) % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = Buffer.concat([
    Buffer.from('murkl_identifier_v1'),
    Buffer.from(normalized)
  ]);
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
// Mock STARK Proof Generator (matches verifier expected format)
// ============================================================================

function generateMockProof(commitment: Buffer, nullifier: Buffer, merkleRoot: Buffer): Buffer {
  // Smaller proof for testing (fits in 4KB)
  const proof = Buffer.alloc(3800);
  let offset = 0;

  // Trace commitment (32 bytes)
  const traceCommitment = Buffer.from(keccak256(Buffer.concat([Buffer.from('trace'), commitment])), 'hex');
  traceCommitment.copy(proof, offset);
  offset += 32;

  // Composition commitment (32 bytes)
  const compositionCommitment = Buffer.from(keccak256(Buffer.concat([Buffer.from('composition'), nullifier])), 'hex');
  compositionCommitment.copy(proof, offset);
  offset += 32;

  // Trace OODS (QM31 = 16 bytes)
  Buffer.from(keccak256(Buffer.concat([Buffer.from('trace_oods'), commitment])), 'hex').slice(0, 16).copy(proof, offset);
  offset += 16;

  // Composition OODS (QM31 = 16 bytes)
  Buffer.from(keccak256(Buffer.concat([Buffer.from('comp_oods'), nullifier])), 'hex').slice(0, 16).copy(proof, offset);
  offset += 16;

  // FRI layers (3 layers to save space)
  proof[offset++] = 3;
  for (let i = 0; i < 3; i++) {
    Buffer.from(keccak256(Buffer.concat([Buffer.from(`fri_${i}`), merkleRoot])), 'hex').copy(proof, offset);
    offset += 32;
  }

  // Final polynomial (2 QM31 coefficients = 32 bytes)
  proof.writeUInt16LE(2, offset);
  offset += 2;
  for (let i = 0; i < 2; i++) {
    Buffer.from(keccak256(Buffer.concat([Buffer.from(`final_${i}`), commitment])), 'hex').slice(0, 16).copy(proof, offset);
    offset += 16;
  }

  // Queries (4 queries to fit in space)
  proof[offset++] = 4;
  for (let q = 0; q < 4; q++) {
    // Query index
    proof.writeUInt32LE(q * 1000, offset);
    offset += 4;

    // Trace value (32 bytes)
    Buffer.from(keccak256(Buffer.concat([Buffer.from(`trace_q${q}`), commitment])), 'hex').copy(proof, offset);
    offset += 32;

    // Trace path (8 nodes)
    proof[offset++] = 8;
    for (let p = 0; p < 8; p++) {
      Buffer.from(keccak256(Buffer.concat([Buffer.from(`trace_path_${q}_${p}`), traceCommitment])), 'hex').copy(proof, offset);
      offset += 32;
    }

    // Composition value (32 bytes)
    Buffer.from(keccak256(Buffer.concat([Buffer.from(`comp_q${q}`), nullifier])), 'hex').copy(proof, offset);
    offset += 32;

    // Composition path (8 nodes)
    proof[offset++] = 8;
    for (let p = 0; p < 8; p++) {
      Buffer.from(keccak256(Buffer.concat([Buffer.from(`comp_path_${q}_${p}`), compositionCommitment])), 'hex').copy(proof, offset);
      offset += 32;
    }

    // FRI layer values (3 layers, each with 4 QM31 siblings + short path)
    for (let l = 0; l < 3; l++) {
      // 4 sibling values (64 bytes)
      for (let s = 0; s < 4; s++) {
        Buffer.from(keccak256(Buffer.concat([Buffer.from(`fri_${l}_${q}_${s}`), merkleRoot])), 'hex').slice(0, 16).copy(proof, offset);
        offset += 16;
      }
      // Path (3 nodes)
      proof[offset++] = 3;
      for (let p = 0; p < 3; p++) {
        Buffer.from(keccak256(Buffer.concat([Buffer.from(`fri_path_${l}_${q}_${p}`)])), 'hex').copy(proof, offset);
        offset += 32;
      }
    }
  }

  console.log(`   Proof size: ${offset} bytes`);
  return proof.slice(0, offset);
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function main() {
  console.log('🐈‍⬛ Murkl E2E Test (New Architecture)\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const relayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8'))));

  console.log(`👛 Relayer: ${relayer.publicKey.toBase58()}`);
  console.log(`💰 Balance: ${(await connection.getBalance(relayer.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // Use existing test pool and deposit
  const pool = new PublicKey('Gjw5fS9TvtaZracqD31QSBcJ2SBP84jyASNFaDF7VSY4');
  const deposit = new PublicKey('AnNwZitdFbdMizXEuEf86zsmKP8xz886cwNmGa2m5MYM');
  const tokenMint = new PublicKey('DTMXeBXH1vRbRvcsHTN46jksTo9tSQwq7WYQSX8MYPA9');

  // Fetch pool to get merkle root
  const poolAccount = await connection.getAccountInfo(pool);
  if (!poolAccount) throw new Error('Pool not found');
  const merkleRoot = Buffer.from(poolAccount.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32));
  console.log(`📦 Pool: ${pool.toBase58()}`);
  console.log(`🌲 Merkle root: 0x${merkleRoot.slice(0, 8).toString('hex')}...`);

  // Use same credentials as original deposit
  const identifier = '@hackathon-test';
  const password = 'demo2026';
  const leafIndex = 0;

  const idHash = hashIdentifier(identifier);
  const secretHash = hashPassword(password);
  const commitment = computeCommitment(idHash, secretHash);
  const nullifier = computeNullifier(secretHash, leafIndex);

  console.log(`\n🔐 Commitment: 0x${commitment.slice(0, 8).toString('hex')}...`);
  console.log(`🔐 Nullifier: 0x${nullifier.slice(0, 8).toString('hex')}...`);

  // Generate proof
  console.log('\n📤 Generating STARK proof...');
  const proofBytes = generateMockProof(commitment, nullifier, merkleRoot);
  console.log(`   Proof size: ${proofBytes.length} bytes`);

  // Create proof buffer keypair (raw account, not PDA)
  const proofBuffer = Keypair.generate();
  const bufferSize = HEADER_SIZE + proofBytes.length;
  const bufferRent = await connection.getMinimumBalanceForRentExemption(bufferSize);

  console.log(`\n📦 Creating proof buffer: ${proofBuffer.publicKey.toBase58()}`);
  console.log(`   Size: ${bufferSize} bytes, Rent: ${bufferRent / LAMPORTS_PER_SOL} SOL`);

  // Step 1: Create and init buffer (stark-verifier)
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: relayer.publicKey,
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
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initBufferData,
  });

  const createTx = new Transaction().add(createAccountIx, initBufferIx);
  createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  createTx.feePayer = relayer.publicKey;

  const createSig = await sendAndConfirmTransaction(connection, createTx, [relayer, proofBuffer], { skipPreflight: true });
  console.log(`   ✅ Buffer created: ${createSig.slice(0, 20)}...`);

  // Step 2: Upload chunks (stark-verifier)
  console.log('\n📤 Uploading proof chunks...');
  const numChunks = Math.ceil(proofBytes.length / CHUNK_SIZE);

  for (let i = 0; i < numChunks; i++) {
    const chunkOffset = i * CHUNK_SIZE;
    const chunk = proofBytes.slice(chunkOffset, chunkOffset + CHUNK_SIZE);

    const uploadData = Buffer.concat([
      getDiscriminator('upload_chunk'),
      Buffer.from(new Uint32Array([chunkOffset]).buffer),
      Buffer.from(new Uint32Array([chunk.length]).buffer),
      chunk,
    ]);

    const uploadIx = new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: proofBuffer.publicKey, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: false },
      ],
      data: uploadData,
    });

    const uploadTx = new Transaction().add(uploadIx);
    uploadTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    uploadTx.feePayer = relayer.publicKey;

    await sendAndConfirmTransaction(connection, uploadTx, [relayer], { skipPreflight: true });
    console.log(`   ✅ Chunk ${i + 1}/${numChunks} (${chunk.length} bytes)`);
  }

  // Step 3: Finalize and verify (stark-verifier)
  console.log('\n🔐 Finalizing and verifying proof...');

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
      { pubkey: relayer.publicKey, isSigner: true, isWritable: false },
    ],
    data: finalizeData,
  });

  const finalizeTx = new Transaction().add(finalizeIx);
  finalizeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  finalizeTx.feePayer = relayer.publicKey;

  try {
    const finalizeSig = await sendAndConfirmTransaction(connection, finalizeTx, [relayer], { skipPreflight: true });
    console.log(`   ✅ Verified: ${finalizeSig.slice(0, 20)}...`);
  } catch (e: any) {
    console.log(`   ❌ Verification failed: ${e.message}`);
    // Try to get logs
    const sim = await connection.simulateTransaction(finalizeTx, [relayer]);
    console.log('   Logs:', sim.value.logs?.join('\n   '));
    process.exit(1);
  }

  // Step 4: Claim via murkl
  console.log('\n💸 Claiming tokens...');

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pool.toBuffer()],
    MURKL_PROGRAM_ID
  );

  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), pool.toBuffer(), nullifier],
    MURKL_PROGRAM_ID
  );

  const recipientAta = await getAssociatedTokenAddress(tokenMint, relayer.publicKey);

  // Prepare claim instruction
  const relayerFee = BigInt(0);
  const feeBuffer = Buffer.alloc(8);
  feeBuffer.writeBigUInt64LE(relayerFee);

  // Correct discriminator: sha256("global:claim")[0..8]
  // 3ec6d6c1d59f6cd2 in hex
  const claimDiscriminator = Buffer.from([0x3e, 0xc6, 0xd6, 0xc1, 0xd5, 0x9f, 0x6c, 0xd2]);
  const claimData = Buffer.concat([
    claimDiscriminator,
    feeBuffer,
    nullifier,
  ]);
  console.log(`   Data size: ${claimData.length} bytes (expected 48)`);
  console.log(`   Discriminator: ${claimDiscriminator.toString('hex')}`);
  console.log(`   Fee: ${feeBuffer.toString('hex')}`);
  console.log(`   Nullifier: ${nullifier.toString('hex').slice(0, 16)}...`);

  const claimTx = new Transaction();

  // Create ATA if needed
  const ataInfo = await connection.getAccountInfo(recipientAta);
  if (!ataInfo) {
    claimTx.add(createAssociatedTokenAccountInstruction(
      relayer.publicKey,
      recipientAta,
      relayer.publicKey,
      tokenMint
    ));
  }

  const claimIx = new TransactionInstruction({
    programId: MURKL_PROGRAM_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },
      { pubkey: deposit, isSigner: false, isWritable: true },
      { pubkey: proofBuffer.publicKey, isSigner: false, isWritable: false },
      { pubkey: nullifierPda, isSigner: false, isWritable: true },
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: recipientAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: claimData,
  });

  claimTx.add(claimIx);
  claimTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  claimTx.feePayer = relayer.publicKey;

  // Simulate first
  console.log('   Simulating...');
  const simResult = await connection.simulateTransaction(claimTx, [relayer]);

  if (simResult.value.err) {
    console.log(`\n❌ Claim failed:`);
    console.log(`   Error: ${JSON.stringify(simResult.value.err)}`);
    console.log(`   Logs:`);
    simResult.value.logs?.forEach(l => console.log(`      ${l}`));
    process.exit(1);
  }

  console.log(`   ✅ Simulation passed (${simResult.value.unitsConsumed} CU)`);

  const claimSig = await sendAndConfirmTransaction(connection, claimTx, [relayer], { skipPreflight: true });
  console.log(`   ✅ Claimed: ${claimSig}`);

  // Final check
  const ataAccount = await getAccount(connection, recipientAta);
  console.log(`\n🎉 SUCCESS!`);
  console.log(`   Token balance: ${Number(ataAccount.amount)} (raw)`);
}

main().catch(e => {
  console.error('\n❌ E2E Test Failed:', e.message);
  process.exit(1);
});
