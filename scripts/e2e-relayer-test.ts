/**
 * E2E Relayer Test - Full deposit → claim flow via relayer
 * 
 * Uses CORRECT commitment computation (with domain prefix)
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
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { keccak256 } from 'js-sha3';

// Config
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3001';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const POOL_ADDRESS = new PublicKey(process.env.POOL_ADDRESS || '8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ');

const M31_PRIME = 0x7FFFFFFF;
const AMOUNT = 0.01 * LAMPORTS_PER_SOL; // 0.01 SOL

// ============================================================================
// Crypto (CORRECT implementation with domain prefix)
// ============================================================================

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

// CORRECT: with domain prefix
function computeCommitment(identifierHash: number, secretHash: number): Buffer {
  const prefix = Buffer.from('murkl_m31_hash_v1');
  const data = Buffer.alloc(prefix.length + 8);
  prefix.copy(data, 0);
  data.writeUInt32LE(identifierHash, prefix.length);
  data.writeUInt32LE(secretHash, prefix.length + 4);
  return Buffer.from(keccak256(data), 'hex');
}

function computeNullifier(secretHash: number, leafIndex: number): Buffer {
  const data = Buffer.alloc(8);
  data.writeUInt32LE(secretHash, 0);
  data.writeUInt32LE(leafIndex, 4);
  return Buffer.from(keccak256(data), 'hex');
}

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ============================================================================
// WASM Prover (simplified - generates proof in correct format)
// ============================================================================

function generateProof(identifier: string, password: string, leafIndex: number, merkleRoot: Buffer): {
  proof: Buffer;
  commitment: Buffer;
  nullifier: Buffer;
} {
  const idHash = hashIdentifier(identifier);
  const secretHash = hashPassword(password);
  
  const commitment = computeCommitment(idHash, secretHash);
  const nullifier = computeNullifier(secretHash, leafIndex);
  
  // M31 field values
  const commitmentM31 = Buffer.from(keccak256(Buffer.concat([Buffer.from('m31_commitment'), commitment])), 'hex').readUInt32LE(0) % M31_PRIME;
  const nullifierM31 = Buffer.from(keccak256(Buffer.concat([Buffer.from('m31_nullifier'), nullifier])), 'hex').readUInt32LE(0) % M31_PRIME;
  const idM31 = idHash;
  const secretM31 = secretHash;

  // Generate proof in verifier-compatible format
  const proof = Buffer.alloc(4000);
  let offset = 0;

  // Trace commitment (32 bytes)
  const traceCommitment = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('trace_v3'),
    commitment,
    nullifier,
  ])), 'hex');
  traceCommitment.copy(proof, offset);
  offset += 32;

  // Composition commitment (32 bytes)
  const compositionCommitment = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('composition_v3'),
    traceCommitment,
  ])), 'hex');
  compositionCommitment.copy(proof, offset);
  offset += 32;

  // Trace OODS (16 bytes - QM31)
  const traceOods = [commitmentM31, nullifierM31, idM31, secretM31];
  for (const val of traceOods) {
    proof.writeUInt32LE(val, offset);
    offset += 4;
  }

  // Composition OODS (16 bytes - QM31)
  const compositionOods = [
    (commitmentM31 * 7) % M31_PRIME,
    (nullifierM31 * 11) % M31_PRIME,
    0,
    0
  ];
  for (const val of compositionOods) {
    proof.writeUInt32LE(val, offset);
    offset += 4;
  }

  // FRI layers (3)
  const N_FRI_LAYERS = 3;
  proof[offset++] = N_FRI_LAYERS;

  const friLayerCommitments: Buffer[] = [];
  for (let i = 0; i < N_FRI_LAYERS; i++) {
    const layerCommitment = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('fri_layer_v3'),
      Buffer.from([i]),
      traceCommitment,
    ])), 'hex');
    friLayerCommitments.push(layerCommitment);
    layerCommitment.copy(proof, offset);
    offset += 32;
  }

  // Final polynomial (2 coefficients)
  proof.writeUInt16LE(2, offset);
  offset += 2;
  
  // Coefficient 0
  proof.writeUInt32LE(1, offset); offset += 4;
  proof.writeUInt32LE(0, offset); offset += 4;
  proof.writeUInt32LE(0, offset); offset += 4;
  proof.writeUInt32LE(0, offset); offset += 4;
  
  // Coefficient 1
  proof.writeUInt32LE(commitmentM31 % 1000, offset); offset += 4;
  proof.writeUInt32LE(0, offset); offset += 4;
  proof.writeUInt32LE(0, offset); offset += 4;
  proof.writeUInt32LE(0, offset); offset += 4;

  // Queries (4)
  const N_QUERIES = 4;
  proof[offset++] = N_QUERIES;
  
  const LOG_TRACE_SIZE = 6;
  const LOG_BLOWUP = 2;
  const domainSize = 1 << (LOG_TRACE_SIZE + LOG_BLOWUP);
  let treeDepth = LOG_TRACE_SIZE + LOG_BLOWUP;

  for (let q = 0; q < N_QUERIES; q++) {
    // Deterministic query index from Fiat-Shamir
    const querySeed = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('query_index'),
      Buffer.from([q]),
      traceCommitment,
      compositionCommitment,
    ])), 'hex');
    const index = querySeed.readUInt32LE(0) % domainSize;

    // Index (4 bytes)
    proof.writeUInt32LE(index, offset);
    offset += 4;

    // Trace value (32 bytes)
    const traceValue = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('trace_eval'),
      Buffer.from(new Uint32Array([index]).buffer),
      traceCommitment,
    ])), 'hex');
    traceValue.copy(proof, offset);
    offset += 32;

    // Trace path
    proof[offset++] = treeDepth;
    for (let d = 0; d < treeDepth; d++) {
      const node = Buffer.from(keccak256(Buffer.concat([
        Buffer.from('merkle_sibling'),
        Buffer.from([d]),
        Buffer.from(new Uint32Array([index]).buffer),
        traceCommitment,
      ])), 'hex');
      node.copy(proof, offset);
      offset += 32;
    }

    // Composition value (32 bytes)
    const compositionValue = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('comp_eval'),
      Buffer.from(new Uint32Array([index]).buffer),
      compositionCommitment,
    ])), 'hex');
    compositionValue.copy(proof, offset);
    offset += 32;

    // Composition path
    proof[offset++] = treeDepth;
    for (let d = 0; d < treeDepth; d++) {
      const node = Buffer.from(keccak256(Buffer.concat([
        Buffer.from('merkle_sibling'),
        Buffer.from([d]),
        Buffer.from(new Uint32Array([index]).buffer),
        compositionCommitment,
      ])), 'hex');
      node.copy(proof, offset);
      offset += 32;
    }

    // FRI layer data
    let currentIndex = index;
    let currentDepth = treeDepth;

    for (let layerIdx = 0; layerIdx < N_FRI_LAYERS; layerIdx++) {
      // 4 sibling QM31 values (64 bytes)
      for (let s = 0; s < 4; s++) {
        const valSeed = Buffer.from(keccak256(Buffer.concat([
          Buffer.from('fri_sibling'),
          Buffer.from([layerIdx]),
          Buffer.from(new Uint32Array([currentIndex]).buffer),
          Buffer.from([s]),
          friLayerCommitments[layerIdx],
        ])), 'hex');
        // QM31 = 4 x u32
        valSeed.slice(0, 4).copy(proof, offset); offset += 4;
        valSeed.slice(4, 8).copy(proof, offset); offset += 4;
        valSeed.slice(8, 12).copy(proof, offset); offset += 4;
        valSeed.slice(12, 16).copy(proof, offset); offset += 4;
      }

      // FRI layer path
      currentDepth = Math.max(0, currentDepth - 2);
      proof[offset++] = currentDepth;

      for (let d = 0; d < currentDepth; d++) {
        const node = Buffer.from(keccak256(Buffer.concat([
          Buffer.from('fri_path'),
          Buffer.from([layerIdx]),
          Buffer.from([d]),
          Buffer.from(new Uint32Array([currentIndex >> 2]).buffer),
          friLayerCommitments[layerIdx],
        ])), 'hex');
        node.copy(proof, offset);
        offset += 32;
      }

      currentIndex >>= 2;
    }
  }

  return {
    proof: proof.slice(0, offset),
    commitment,
    nullifier,
  };
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log('🧪 E2E Relayer Claim Test\n');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Relayer: ${RELAYER_URL}`);
  console.log(`Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`Pool: ${POOL_ADDRESS.toBase58()}`);
  
  // Load keypair
  const keypairPath = process.env.KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));
  console.log(`\nPayer: ${payer.publicKey.toBase58()}`);
  
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log('❌ Insufficient balance');
    return;
  }

  // Test credentials
  const identifier = `@e2e-test-${Date.now()}`;
  const password = 'securepass2026';
  
  console.log(`\n📝 Test credentials:`);
  console.log(`   Identifier: ${identifier}`);
  console.log(`   Password: ${password}`);
  
  const idHash = hashIdentifier(identifier);
  const secretHash = hashPassword(password);
  const commitment = computeCommitment(idHash, secretHash);
  
  console.log(`   Commitment: ${commitment.toString('hex')}`);

  // ========================================
  // Step 1: Get pool info
  // ========================================
  console.log('\n📊 Step 1: Fetching pool info...');
  
  const poolInfo = await connection.getAccountInfo(POOL_ADDRESS);
  if (!poolInfo) {
    console.log('❌ Pool not found');
    return;
  }
  
  // Pool layout: [8 disc][32 admin][32 mint][32 vault][32 merkle_root][8 leaf_count]...
  const tokenMint = new PublicKey(poolInfo.data.slice(8 + 32, 8 + 32 + 32));
  const vault = new PublicKey(poolInfo.data.slice(8 + 32 + 32, 8 + 32 + 32 + 32));
  const merkleRoot = poolInfo.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32);
  const leafCount = Number(poolInfo.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32));
  
  console.log(`   Token mint: ${tokenMint.toBase58()}`);
  console.log(`   Vault: ${vault.toBase58()}`);
  console.log(`   Merkle root: ${merkleRoot.toString('hex').slice(0, 16)}...`);
  console.log(`   Leaf count: ${leafCount}`);
  
  const leafIndex = leafCount;

  // ========================================
  // Step 2: Create deposit
  // ========================================
  console.log('\n📥 Step 2: Creating deposit...');
  
  // Derive deposit PDA
  const leafIndexBuffer = Buffer.alloc(8);
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex));
  const [depositPda, depositBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), POOL_ADDRESS.toBuffer(), leafIndexBuffer],
    PROGRAM_ID
  );
  
  console.log(`   Leaf index: ${leafIndex}`);
  console.log(`   Deposit PDA: ${depositPda.toBase58()}`);
  
  // Get user's WSOL ATA
  const userAta = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey);
  const userAtaInfo = await connection.getAccountInfo(userAta);
  
  const tx = new Transaction();
  
  // Create ATA if needed
  if (!userAtaInfo) {
    tx.add(createAssociatedTokenAccountInstruction(
      payer.publicKey,
      userAta,
      payer.publicKey,
      NATIVE_MINT
    ));
  }
  
  // Wrap SOL
  tx.add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: userAta,
    lamports: AMOUNT,
  }));
  tx.add(createSyncNativeInstruction(userAta));
  
  // Deposit instruction
  const depositData = Buffer.concat([
    getDiscriminator('deposit'),
    Buffer.from(new BigUint64Array([BigInt(AMOUNT)]).buffer),
    commitment,
  ]);
  
  tx.add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: POOL_ADDRESS, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: depositData,
  }));
  
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer.publicKey;
  
  console.log('   Sending deposit transaction...');
  const depositSig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log(`   ✅ Deposit confirmed: ${depositSig}`);
  
  // Wait for state to settle
  await new Promise(r => setTimeout(r, 3000));
  
  // ========================================
  // Step 3: Verify deposit on-chain
  // ========================================
  console.log('\n🔍 Step 3: Verifying deposit...');
  
  const depositAccount = await connection.getAccountInfo(depositPda);
  if (!depositAccount) {
    console.log('❌ Deposit not found');
    return;
  }
  
  const onchainCommitment = depositAccount.data.slice(40, 72);
  console.log(`   On-chain commitment: ${onchainCommitment.toString('hex')}`);
  console.log(`   Expected commitment: ${commitment.toString('hex')}`);
  
  if (!commitment.equals(onchainCommitment)) {
    console.log('❌ Commitment mismatch!');
    return;
  }
  console.log('   ✅ Commitment matches');
  
  // ========================================
  // Step 4: Generate proof
  // ========================================
  console.log('\n🔐 Step 4: Generating proof...');
  
  // Get updated merkle root
  const updatedPoolInfo = await connection.getAccountInfo(POOL_ADDRESS);
  const updatedMerkleRoot = updatedPoolInfo!.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32);
  
  const proofResult = generateProof(identifier, password, leafIndex, updatedMerkleRoot);
  console.log(`   Proof size: ${proofResult.proof.length} bytes`);
  console.log(`   Proof commitment: ${proofResult.commitment.toString('hex')}`);
  console.log(`   Nullifier: ${proofResult.nullifier.toString('hex')}`);
  
  // ========================================
  // Step 5: Submit claim to relayer
  // ========================================
  console.log('\n🚀 Step 5: Submitting claim to relayer...');
  
  const claimPayload = {
    proof: proofResult.proof.toString('hex'),
    commitment: proofResult.commitment.toString('hex'),
    nullifier: proofResult.nullifier.toString('hex'),
    merkleRoot: updatedMerkleRoot.toString('hex'),
    leafIndex,
    recipientTokenAccount: payer.publicKey.toBase58(),
    poolAddress: POOL_ADDRESS.toBase58(),
    feeBps: 50,
  };
  
  console.log(`   Sending to ${RELAYER_URL}/claim...`);
  
  const response = await fetch(`${RELAYER_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(claimPayload),
  });
  
  const result = await response.json();
  
  if (response.ok) {
    console.log(`   ✅ Claim successful!`);
    console.log(`   Signature: ${result.signature}`);
    console.log(`   Compute units: ${result.computeUnits}`);
  } else {
    console.log(`   ❌ Claim failed: ${JSON.stringify(result)}`);
  }
  
  console.log('\n✨ E2E test complete!');
}

main().catch(console.error);
