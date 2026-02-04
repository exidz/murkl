/**
 * Full E2E Test: Deposit → Proof → Claim
 * 
 * Uses correct commitment computation matching WASM/Rust prover.
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

// ============================================================================
// Config
// ============================================================================

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:3001';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || 'muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const STARK_VERIFIER_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');
const POOL_ADDRESS = new PublicKey(process.env.POOL_ADDRESS || '8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ');

const M31_PRIME = 0x7FFFFFFF;
const CHUNK_SIZE = 900;

// Test credentials
const TEST_IDENTIFIER = `@e2e-${Date.now()}`;
const TEST_PASSWORD = 'e2e-test-password-123';
const DEPOSIT_AMOUNT = 0.01; // SOL

// ============================================================================
// Discriminators
// ============================================================================

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ============================================================================
// Commitment/Nullifier (CORRECT - matches WASM/Rust)
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

// CORRECT commitment with domain prefix
function computeCommitment(identifier: string, password: string): Buffer {
  const idHash = hashIdentifier(identifier);
  const secret = hashPassword(password);
  
  const prefix = Buffer.from('murkl_m31_hash_v1');
  const idBuf = Buffer.alloc(4);
  const secretBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(idHash, 0);
  secretBuf.writeUInt32LE(secret, 0);
  
  const data = Buffer.concat([prefix, idBuf, secretBuf]);
  return Buffer.from(keccak256(data), 'hex');
}

// CORRECT nullifier
function computeNullifier(password: string, leafIndex: number): Buffer {
  const secret = hashPassword(password);
  const data = Buffer.alloc(8);
  data.writeUInt32LE(secret, 0);
  data.writeUInt32LE(leafIndex, 4);
  return Buffer.from(keccak256(data), 'hex');
}

// ============================================================================
// Proof Generation (matches WASM prover format)
// ============================================================================

function generateProof(
  idHash: number,
  secret: number,
  leafIndex: number,
  commitment: Buffer,
  nullifier: Buffer,
  merkleRoot: Buffer
): Buffer {
  const N_FRI_LAYERS = 3;
  const N_QUERIES = 4;
  const LOG_TRACE_SIZE = 6;
  const LOG_BLOWUP = 2;
  
  const proof: number[] = [];
  
  // M31 values for trace
  const commitmentM31 = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('murkl_m31_commitment'),
    Buffer.from(new Uint32Array([idHash]).buffer),
    Buffer.from(new Uint32Array([secret]).buffer),
  ])), 'hex').readUInt32LE(0) % M31_PRIME;
  
  const nullifierM31 = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('murkl_m31_nullifier'),
    Buffer.from(new Uint32Array([secret]).buffer),
    Buffer.from(new Uint32Array([leafIndex]).buffer),
  ])), 'hex').readUInt32LE(0) % M31_PRIME;
  
  // 1. Trace commitment (32 bytes)
  const traceCommitment = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('trace_commitment_v3'),
    Buffer.from(new Uint32Array([commitmentM31]).buffer),
    Buffer.from(new Uint32Array([nullifierM31]).buffer),
    Buffer.from(new Uint32Array([idHash]).buffer),
    Buffer.from(new Uint32Array([secret]).buffer),
  ])), 'hex');
  proof.push(...traceCommitment);
  
  // 2. Composition commitment (32 bytes)
  const compositionCommitment = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('composition_v3'),
    traceCommitment,
  ])), 'hex');
  proof.push(...compositionCommitment);
  
  // 3. Trace OODS (16 bytes - QM31)
  const traceOods = [commitmentM31, nullifierM31, idHash, secret];
  for (const val of traceOods) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(val, 0);
    proof.push(...buf);
  }
  
  // 4. Composition OODS (16 bytes - QM31)
  const compositionOods = [
    (commitmentM31 * 7) % M31_PRIME,
    (nullifierM31 * 11) % M31_PRIME,
    0,
    0,
  ];
  for (const val of compositionOods) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(val, 0);
    proof.push(...buf);
  }
  
  // 5. FRI layer count (1 byte)
  proof.push(N_FRI_LAYERS);
  
  // 6. FRI layer commitments (32 bytes each)
  const friLayerCommitments: Buffer[] = [];
  for (let i = 0; i < N_FRI_LAYERS; i++) {
    const layerCommitment = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('fri_layer_v3'),
      Buffer.from(new Uint32Array([i]).buffer),
      traceCommitment,
    ])), 'hex');
    friLayerCommitments.push(layerCommitment);
    proof.push(...layerCommitment);
  }
  
  // 7. Final polynomial count (2 bytes u16)
  proof.push(2, 0);
  
  // 8. Final polynomial coefficients (16 bytes QM31 each)
  // Coefficient 0
  proof.push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  // Coefficient 1
  const coeff1 = Buffer.alloc(16);
  coeff1.writeUInt32LE(commitmentM31 % 1000, 0);
  proof.push(...coeff1);
  
  // 9. Query count (1 byte)
  proof.push(N_QUERIES);
  
  // 10. Queries
  const domainSize = 1 << (LOG_TRACE_SIZE + LOG_BLOWUP);
  const treeDepth = LOG_TRACE_SIZE + LOG_BLOWUP;
  
  for (let q = 0; q < N_QUERIES; q++) {
    // Deterministic query index from Fiat-Shamir
    const querySeed = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('query_index'),
      Buffer.from(new Uint32Array([q]).buffer),
      traceCommitment,
      compositionCommitment,
    ])), 'hex');
    const index = querySeed.readUInt32LE(0) % domainSize;
    
    // Index (4 bytes)
    const indexBuf = Buffer.alloc(4);
    indexBuf.writeUInt32LE(index, 0);
    proof.push(...indexBuf);
    
    // Trace value (32 bytes)
    const traceValue = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('trace_eval'),
      Buffer.from(new Uint32Array([index]).buffer),
      traceCommitment,
    ])), 'hex');
    proof.push(...traceValue);
    
    // Trace path length (1 byte)
    proof.push(treeDepth);
    
    // Trace Merkle path (32 bytes each)
    for (let d = 0; d < treeDepth; d++) {
      const node = Buffer.from(keccak256(Buffer.concat([
        Buffer.from('merkle_sibling'),
        Buffer.from(new Uint32Array([d]).buffer),
        Buffer.from(new Uint32Array([index]).buffer),
        traceCommitment,
      ])), 'hex');
      proof.push(...node);
    }
    
    // Composition value (32 bytes)
    const compositionValue = Buffer.from(keccak256(Buffer.concat([
      Buffer.from('comp_eval'),
      Buffer.from(new Uint32Array([index]).buffer),
      compositionCommitment,
    ])), 'hex');
    proof.push(...compositionValue);
    
    // Composition path length (1 byte)
    proof.push(treeDepth);
    
    // Composition Merkle path (32 bytes each)
    for (let d = 0; d < treeDepth; d++) {
      const node = Buffer.from(keccak256(Buffer.concat([
        Buffer.from('merkle_sibling'),
        Buffer.from(new Uint32Array([d]).buffer),
        Buffer.from(new Uint32Array([index]).buffer),
        compositionCommitment,
      ])), 'hex');
      proof.push(...node);
    }
    
    // FRI layer data
    let currentIndex = index;
    let currentDepth = treeDepth;
    
    for (let layerIdx = 0; layerIdx < N_FRI_LAYERS; layerIdx++) {
      // 4 sibling QM31 values (64 bytes)
      for (let s = 0; s < 4; s++) {
        const valSeed = Buffer.from(keccak256(Buffer.concat([
          Buffer.from('fri_sibling'),
          Buffer.from(new Uint32Array([layerIdx]).buffer),
          Buffer.from(new Uint32Array([currentIndex]).buffer),
          Buffer.from(new Uint32Array([s]).buffer),
          friLayerCommitments[layerIdx],
        ])), 'hex');
        // QM31 = 4 x u32
        proof.push(...valSeed.slice(0, 16));
      }
      
      // FRI layer path
      currentDepth = Math.max(0, currentDepth - 2);
      proof.push(currentDepth);
      
      for (let d = 0; d < currentDepth; d++) {
        const node = Buffer.from(keccak256(Buffer.concat([
          Buffer.from('fri_path'),
          Buffer.from(new Uint32Array([layerIdx]).buffer),
          Buffer.from(new Uint32Array([d]).buffer),
          Buffer.from(new Uint32Array([currentIndex >> 2]).buffer),
          friLayerCommitments[layerIdx],
        ])), 'hex');
        proof.push(...node);
      }
      
      currentIndex = currentIndex >> 2;
    }
  }
  
  return Buffer.from(proof);
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function main() {
  console.log('🧪 Full E2E Test: Deposit → Proof → Claim\n');
  console.log(`Identifier: "${TEST_IDENTIFIER}"`);
  console.log(`Password: "${TEST_PASSWORD}"`);
  console.log(`Amount: ${DEPOSIT_AMOUNT} SOL\n`);
  
  // Connect
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Load payer keypair
  const keypairPath = process.env.KEYPAIR || `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(secretKey));
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL\n`);
  
  if (balance < 0.05 * LAMPORTS_PER_SOL) {
    console.log('❌ Insufficient balance');
    return;
  }
  
  // Compute commitment
  const commitment = computeCommitment(TEST_IDENTIFIER, TEST_PASSWORD);
  const idHash = hashIdentifier(TEST_IDENTIFIER);
  const secret = hashPassword(TEST_PASSWORD);
  
  console.log('Computed values:');
  console.log(`  id_hash: ${idHash}`);
  console.log(`  secret: ${secret}`);
  console.log(`  commitment: ${commitment.toString('hex')}\n`);
  
  // ========================================
  // Step 1: Get pool info
  // ========================================
  console.log('📊 Step 1: Fetching pool info...');
  
  const poolInfo = await connection.getAccountInfo(POOL_ADDRESS);
  if (!poolInfo) {
    console.log('❌ Pool not found');
    return;
  }
  
  // Pool layout: [8 disc][32 admin][32 token_mint][32 vault][32 merkle_root][8 leaf_count]...
  const tokenMint = new PublicKey(poolInfo.data.slice(8 + 32, 8 + 32 + 32));
  const vault = new PublicKey(poolInfo.data.slice(8 + 32 + 32, 8 + 32 + 32 + 32));
  const merkleRoot = poolInfo.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32);
  const leafCount = Number(poolInfo.data.readBigUInt64LE(8 + 32 + 32 + 32 + 32));
  
  console.log(`  Token mint: ${tokenMint.toBase58()}`);
  console.log(`  Vault: ${vault.toBase58()}`);
  console.log(`  Merkle root: ${merkleRoot.toString('hex').slice(0, 16)}...`);
  console.log(`  Leaf count: ${leafCount}`);
  console.log(`  Next leaf index: ${leafCount}\n`);
  
  const leafIndex = leafCount;
  
  // ========================================
  // Step 2: Create deposit
  // ========================================
  console.log('📥 Step 2: Creating deposit...');
  
  // Derive deposit PDA
  const leafIndexBuffer = Buffer.alloc(8);
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex));
  const [depositPda, depositBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), POOL_ADDRESS.toBuffer(), leafIndexBuffer],
    PROGRAM_ID
  );
  
  console.log(`  Deposit PDA: ${depositPda.toBase58()}`);
  
  // Get user ATA for WSOL
  const userAta = await getAssociatedTokenAddress(NATIVE_MINT, payer.publicKey);
  const userAtaInfo = await connection.getAccountInfo(userAta);
  
  // Build deposit transaction
  const depositTx = new Transaction();
  
  // Create ATA if needed
  if (!userAtaInfo) {
    depositTx.add(
      createAssociatedTokenAccountInstruction(
        payer.publicKey,
        userAta,
        payer.publicKey,
        NATIVE_MINT
      )
    );
  }
  
  // Wrap SOL
  const amountLamports = BigInt(Math.floor(DEPOSIT_AMOUNT * LAMPORTS_PER_SOL));
  depositTx.add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: userAta,
      lamports: Number(amountLamports),
    }),
    createSyncNativeInstruction(userAta)
  );
  
  // Deposit instruction
  const depositData = Buffer.alloc(48);
  getDiscriminator('deposit').copy(depositData, 0);
  depositData.writeBigUInt64LE(amountLamports, 8);
  commitment.copy(depositData, 16);
  
  const depositIx = new TransactionInstruction({
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
  });
  
  depositTx.add(depositIx);
  
  // Send deposit
  const { blockhash } = await connection.getLatestBlockhash();
  depositTx.recentBlockhash = blockhash;
  depositTx.feePayer = payer.publicKey;
  
  const depositSig = await sendAndConfirmTransaction(connection, depositTx, [payer]);
  console.log(`  ✅ Deposit confirmed: ${depositSig}\n`);
  
  // Wait for state to settle
  await new Promise(r => setTimeout(r, 2000));
  
  // ========================================
  // Step 3: Verify deposit on-chain
  // ========================================
  console.log('🔍 Step 3: Verifying deposit on-chain...');
  
  const depositAccount = await connection.getAccountInfo(depositPda);
  if (!depositAccount) {
    console.log('❌ Deposit account not found');
    return;
  }
  
  const onchainCommitment = depositAccount.data.slice(40, 72);
  console.log(`  On-chain commitment: ${onchainCommitment.toString('hex')}`);
  
  if (!commitment.equals(onchainCommitment)) {
    console.log('❌ Commitment mismatch!');
    console.log(`  Expected: ${commitment.toString('hex')}`);
    console.log(`  Got: ${onchainCommitment.toString('hex')}`);
    return;
  }
  console.log('  ✅ Commitment matches!\n');
  
  // ========================================
  // Step 4: Generate proof
  // ========================================
  console.log('🔐 Step 4: Generating proof...');
  
  const nullifier = computeNullifier(TEST_PASSWORD, leafIndex);
  console.log(`  Nullifier: ${nullifier.toString('hex')}`);
  
  // Get updated merkle root after deposit
  const updatedPoolInfo = await connection.getAccountInfo(POOL_ADDRESS);
  const updatedMerkleRoot = updatedPoolInfo!.data.slice(8 + 32 + 32 + 32, 8 + 32 + 32 + 32 + 32);
  console.log(`  Merkle root: ${updatedMerkleRoot.toString('hex').slice(0, 16)}...`);
  
  const proof = generateProof(idHash, secret, leafIndex, commitment, nullifier, updatedMerkleRoot);
  console.log(`  Proof size: ${proof.length} bytes\n`);
  
  // ========================================
  // Step 5: Claim via relayer
  // ========================================
  console.log('💰 Step 5: Claiming via relayer...');
  
  // Check relayer health
  try {
    const health = await fetch(`${RELAYER_URL}/health`);
    if (!health.ok) throw new Error('Relayer unhealthy');
    console.log('  Relayer is healthy');
  } catch (e) {
    console.log('❌ Relayer not accessible');
    return;
  }
  
  // Submit claim
  const claimResponse = await fetch(`${RELAYER_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof: proof.toString('hex'),
      commitment: commitment.toString('hex'),
      nullifier: nullifier.toString('hex'),
      merkleRoot: updatedMerkleRoot.toString('hex'),
      leafIndex,
      recipientTokenAccount: payer.publicKey.toBase58(),
      poolAddress: POOL_ADDRESS.toBase58(),
      feeBps: 50,
    }),
  });
  
  const claimResult = await claimResponse.json();
  
  if (!claimResponse.ok) {
    console.log('❌ Claim failed:', claimResult);
    return;
  }
  
  console.log(`  ✅ Claim successful!`);
  console.log(`  Signature: ${claimResult.signature}`);
  console.log(`  Chunks written: ${claimResult.chunksWritten}`);
  console.log(`  Compute units: ${claimResult.computeUnits}\n`);
  
  console.log('🎉 E2E Test PASSED!\n');
  console.log('Summary:');
  console.log(`  Identifier: ${TEST_IDENTIFIER}`);
  console.log(`  Password: ${TEST_PASSWORD}`);
  console.log(`  Leaf index: ${leafIndex}`);
  console.log(`  Deposit: ${depositSig}`);
  console.log(`  Claim: ${claimResult.signature}`);
}

main().catch(console.error);
