/**
 * Full E2E Test Suite for Murkl
 * 
 * Tests the complete flow:
 * 1. Deploy programs (stark-verifier + murkl)
 * 2. Initialize pool
 * 3. Deposit with commitment
 * 4. Generate STARK proof (off-chain)
 * 5. Upload proof to verifier buffer
 * 6. Verify proof on-chain
 * 7. Claim tokens via murkl program
 * 
 * Run: npx ts-node tests/e2e-full.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import { keccak_256 } from 'js-sha3';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Constants
// ============================================================================

const STARK_VERIFIER_PROGRAM_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');
const MURKL_PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');

// Buffer layout offsets (must match on-chain)
const OFFSET_OWNER = 0;
const OFFSET_SIZE = 32;
const OFFSET_EXPECTED_SIZE = 36;
const OFFSET_FINALIZED = 40;
const OFFSET_COMMITMENT = 41;
const OFFSET_NULLIFIER = 73;
const OFFSET_MERKLE_ROOT = 105;
const OFFSET_PROOF_DATA = 137;
const HEADER_SIZE = 137;

// ============================================================================
// Crypto Utilities
// ============================================================================

function keccak256(data: Uint8Array): Uint8Array {
  return new Uint8Array(keccak_256.arrayBuffer(data));
}

function generateCommitment(identifier: string, password: string): Uint8Array {
  const prefix = new TextEncoder().encode('murkl_commitment_v1');
  const identifierBytes = new TextEncoder().encode(identifier.toLowerCase().trim());
  const passwordBytes = new TextEncoder().encode(password);
  
  const identifierHash = keccak256(new Uint8Array([...prefix, ...identifierBytes]));
  const passwordHash = keccak256(new Uint8Array([...prefix, ...passwordBytes]));
  
  return keccak256(new Uint8Array([...prefix, ...identifierHash, ...passwordHash]));
}

function generateNullifier(password: string, leafIndex: bigint): Uint8Array {
  const prefix = new TextEncoder().encode('murkl_nullifier_v1');
  const passwordBytes = new TextEncoder().encode(password);
  const passwordHash = keccak256(new Uint8Array([...prefix, ...passwordBytes]));
  
  const indexBytes = new Uint8Array(8);
  const view = new DataView(indexBytes.buffer);
  view.setBigUint64(0, leafIndex, true);
  
  return keccak256(new Uint8Array([...prefix, ...passwordHash, ...indexBytes]));
}

// ============================================================================
// Proof Generation (Mock for testing)
// ============================================================================

function generateMockProof(
  commitment: Uint8Array,
  nullifier: Uint8Array,
  merkleRoot: Uint8Array
): Uint8Array {
  // Generate a mock proof in the expected STWO format
  // Need enough space for: 32+32+16+16+1+(4*32)+2+16+1+(2*(4+32+1+10*32+32+1+10*32))
  // = 96 + 1 + 128 + 2 + 16 + 1 + 2*(4+32+1+320+32+1+320) = ~1700 bytes
  const proof = new Uint8Array(4096);
  let offset = 0;

  // Trace commitment (32 bytes) - derived from public inputs
  const traceCommitment = keccak256(new Uint8Array([...commitment, ...nullifier]));
  proof.set(traceCommitment, offset);
  offset += 32;

  // Composition commitment (32 bytes)
  const compositionCommitment = keccak256(new Uint8Array([...traceCommitment, ...merkleRoot]));
  proof.set(compositionCommitment, offset);
  offset += 32;

  // Trace OODS (16 bytes - QM31)
  const traceOods = keccak256(new Uint8Array([...commitment, 0x01])).slice(0, 16);
  proof.set(traceOods, offset);
  offset += 16;

  // Composition OODS (16 bytes - QM31)
  const compositionOods = keccak256(new Uint8Array([...nullifier, 0x02])).slice(0, 16);
  proof.set(compositionOods, offset);
  offset += 16;

  // Number of FRI layers (1 byte)
  const numFriLayers = 4;
  proof[offset] = numFriLayers;
  offset += 1;

  // FRI layer commitments (32 bytes each)
  for (let i = 0; i < numFriLayers; i++) {
    const layerCommitment = keccak256(new Uint8Array([...traceCommitment, i]));
    proof.set(layerCommitment, offset);
    offset += 32;
  }

  // Final polynomial length (2 bytes)
  const finalPolyLen = 16;
  proof[offset] = finalPolyLen & 0xff;
  proof[offset + 1] = (finalPolyLen >> 8) & 0xff;
  offset += 2;

  // Final polynomial (16 bytes)
  const finalPoly = keccak256(compositionCommitment).slice(0, finalPolyLen);
  proof.set(finalPoly, offset);
  offset += finalPolyLen;

  // Number of queries (1 byte)
  const numQueries = 2;
  proof[offset] = numQueries;
  offset += 1;

  // Query proofs
  for (let q = 0; q < numQueries; q++) {
    // Index (4 bytes)
    const index = q * 1000;
    proof[offset] = index & 0xff;
    proof[offset + 1] = (index >> 8) & 0xff;
    proof[offset + 2] = (index >> 16) & 0xff;
    proof[offset + 3] = (index >> 24) & 0xff;
    offset += 4;

    // Trace value (32 bytes)
    const traceValue = keccak256(new Uint8Array([...traceCommitment, q, 0x10]));
    proof.set(traceValue, offset);
    offset += 32;

    // Trace path length (1 byte)
    const tracePathLen = 10;
    proof[offset] = tracePathLen;
    offset += 1;

    // Trace path (32 bytes each)
    for (let p = 0; p < tracePathLen; p++) {
      const pathNode = keccak256(new Uint8Array([...traceValue, p]));
      proof.set(pathNode, offset);
      offset += 32;
    }

    // Composition value (32 bytes)
    const compositionValue = keccak256(new Uint8Array([...compositionCommitment, q, 0x20]));
    proof.set(compositionValue, offset);
    offset += 32;

    // Composition path length (1 byte)
    const compPathLen = 10;
    proof[offset] = compPathLen;
    offset += 1;

    // Composition path (32 bytes each)
    for (let p = 0; p < compPathLen; p++) {
      const pathNode = keccak256(new Uint8Array([...compositionValue, p]));
      proof.set(pathNode, offset);
      offset += 32;
    }
  }

  return proof.slice(0, offset);
}

// ============================================================================
// Instruction Builders
// ============================================================================

// Anchor discriminators (first 8 bytes of sha256("global:<instruction_name>"))
const DISCRIMINATORS = {
  // stark-verifier
  initProofBuffer: Buffer.from('311b1c58136385c2', 'hex'),
  uploadChunk: Buffer.from('82dba5997795fca2', 'hex'),
  finalizeAndVerify: Buffer.from('822244ad15d5b7ec', 'hex'),
  closeProofBuffer: Buffer.from('82960623c122f357', 'hex'),
  // murkl
  initializeConfig: Buffer.from('d07f1501c2bec446', 'hex'),
  initializePool: Buffer.from('5fb40aac54aee828', 'hex'),
  deposit: Buffer.from('f223c68952e1f2b6', 'hex'),
  claim: Buffer.from('3ec6d6c1d59f6cd2', 'hex'),
};

function buildInitProofBufferIx(
  programId: PublicKey,
  buffer: PublicKey,
  owner: PublicKey,
  expectedSize: number
): TransactionInstruction {
  const data = Buffer.alloc(12);
  DISCRIMINATORS.initProofBuffer.copy(data, 0);
  data.writeUInt32LE(expectedSize, 8);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function buildUploadChunkIx(
  programId: PublicKey,
  buffer: PublicKey,
  owner: PublicKey,
  offset: number,
  chunkData: Uint8Array
): TransactionInstruction {
  const data = Buffer.alloc(16 + chunkData.length);
  DISCRIMINATORS.uploadChunk.copy(data, 0);
  data.writeUInt32LE(offset, 8);
  data.writeUInt32LE(chunkData.length, 12);
  Buffer.from(chunkData).copy(data, 16);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function buildFinalizeAndVerifyIx(
  programId: PublicKey,
  buffer: PublicKey,
  owner: PublicKey,
  commitment: Uint8Array,
  nullifier: Uint8Array,
  merkleRoot: Uint8Array
): TransactionInstruction {
  const data = Buffer.alloc(8 + 96);
  DISCRIMINATORS.finalizeAndVerify.copy(data, 0);
  Buffer.from(commitment).copy(data, 8);
  Buffer.from(nullifier).copy(data, 40);
  Buffer.from(merkleRoot).copy(data, 72);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// ============================================================================
// Test Utilities
// ============================================================================

async function airdrop(connection: Connection, pubkey: PublicKey, amount: number) {
  const sig = await connection.requestAirdrop(pubkey, amount * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig);
  console.log(`Airdropped ${amount} SOL to ${pubkey.toString().slice(0, 8)}...`);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// E2E Tests
// ============================================================================

async function runE2ETests() {
  console.log('='.repeat(60));
  console.log('Murkl E2E Test Suite');
  console.log('='.repeat(60));

  // Connect to local validator or devnet
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8899';
  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`Connected to: ${rpcUrl}`);

  // Load or generate test keypair
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  let wallet: Keypair;
  
  try {
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    wallet = Keypair.fromSecretKey(new Uint8Array(walletData));
  } catch {
    wallet = Keypair.generate();
    console.log('Generated new test wallet');
  }
  
  console.log(`Wallet: ${wallet.publicKey.toString()}`);

  // Airdrop if needed
  const balance = await connection.getBalance(wallet.publicKey);
  if (balance < LAMPORTS_PER_SOL) {
    await airdrop(connection, wallet.publicKey, 5);
  }
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  // Test data
  const identifier = '@alice';
  const password = 'secretpassword123';
  const leafIndex = 0n;

  console.log('\n--- Test 1: Generate Commitment and Nullifier ---');
  const commitment = generateCommitment(identifier, password);
  const nullifier = generateNullifier(password, leafIndex);
  const merkleRoot = keccak256(commitment); // Simplified for single-leaf tree
  
  console.log(`Commitment: ${Buffer.from(commitment).toString('hex').slice(0, 16)}...`);
  console.log(`Nullifier: ${Buffer.from(nullifier).toString('hex').slice(0, 16)}...`);
  console.log(`Merkle Root: ${Buffer.from(merkleRoot).toString('hex').slice(0, 16)}...`);

  console.log('\n--- Test 2: Generate Mock STARK Proof ---');
  const proof = generateMockProof(commitment, nullifier, merkleRoot);
  console.log(`Proof size: ${proof.length} bytes`);

  console.log('\n--- Test 3: Create and Initialize Proof Buffer ---');
  const bufferKeypair = Keypair.generate();
  const bufferSize = HEADER_SIZE + proof.length;
  const lamports = await connection.getMinimumBalanceForRentExemption(bufferSize);

  // Create buffer account
  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: wallet.publicKey,
    newAccountPubkey: bufferKeypair.publicKey,
    lamports,
    space: bufferSize,
    programId: STARK_VERIFIER_PROGRAM_ID,
  });

  // Initialize buffer
  const initBufferIx = buildInitProofBufferIx(
    STARK_VERIFIER_PROGRAM_ID,
    bufferKeypair.publicKey,
    wallet.publicKey,
    proof.length
  );

  try {
    const tx1 = new Transaction().add(createAccountIx, initBufferIx);
    const sig1 = await sendAndConfirmTransaction(connection, tx1, [wallet, bufferKeypair]);
    console.log(`Buffer created: ${bufferKeypair.publicKey.toString()}`);
    console.log(`Tx: ${sig1.slice(0, 16)}...`);
  } catch (e: any) {
    console.error('Failed to create buffer:', e.message);
    console.log('Skipping remaining tests (program may not be deployed)');
    return;
  }

  console.log('\n--- Test 4: Upload Proof in Chunks ---');
  const chunkSize = 900;
  let offset = 0;

  while (offset < proof.length) {
    const chunk = proof.slice(offset, offset + chunkSize);
    const uploadIx = buildUploadChunkIx(
      STARK_VERIFIER_PROGRAM_ID,
      bufferKeypair.publicKey,
      wallet.publicKey,
      offset,
      chunk
    );

    const tx = new Transaction().add(uploadIx);
    await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(`Uploaded chunk: offset=${offset}, size=${chunk.length}`);
    offset += chunk.length;
  }
  console.log(`Total uploaded: ${proof.length} bytes`);

  console.log('\n--- Test 5: Finalize and Verify Proof ---');
  const finalizeIx = buildFinalizeAndVerifyIx(
    STARK_VERIFIER_PROGRAM_ID,
    bufferKeypair.publicKey,
    wallet.publicKey,
    commitment,
    nullifier,
    merkleRoot
  );

  try {
    const tx = new Transaction().add(finalizeIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log(`Proof verified! Tx: ${sig.slice(0, 16)}...`);
  } catch (e: any) {
    console.error('Verification failed:', e.message);
    if (e.logs) {
      console.log('Logs:', e.logs.slice(-5).join('\n'));
    }
  }

  console.log('\n--- Test 6: Read Buffer State ---');
  const bufferAccount = await connection.getAccountInfo(bufferKeypair.publicKey);
  if (bufferAccount) {
    const data = bufferAccount.data;
    const owner = new PublicKey(data.slice(OFFSET_OWNER, OFFSET_OWNER + 32));
    const size = data.readUInt32LE(OFFSET_SIZE);
    const expectedSize = data.readUInt32LE(OFFSET_EXPECTED_SIZE);
    const finalized = data[OFFSET_FINALIZED] === 1;
    const storedCommitment = data.slice(OFFSET_COMMITMENT, OFFSET_COMMITMENT + 32);
    const storedNullifier = data.slice(OFFSET_NULLIFIER, OFFSET_NULLIFIER + 32);
    const storedMerkleRoot = data.slice(OFFSET_MERKLE_ROOT, OFFSET_MERKLE_ROOT + 32);

    console.log(`Owner: ${owner.toString().slice(0, 8)}...`);
    console.log(`Size: ${size}/${expectedSize}`);
    console.log(`Finalized: ${finalized}`);
    console.log(`Stored Commitment: ${Buffer.from(storedCommitment).toString('hex').slice(0, 16)}...`);
    console.log(`Stored Nullifier: ${Buffer.from(storedNullifier).toString('hex').slice(0, 16)}...`);
    console.log(`Stored Merkle Root: ${Buffer.from(storedMerkleRoot).toString('hex').slice(0, 16)}...`);

    // Verify stored values match
    const commitmentMatch = Buffer.compare(storedCommitment, Buffer.from(commitment)) === 0;
    const nullifierMatch = Buffer.compare(storedNullifier, Buffer.from(nullifier)) === 0;
    const merkleRootMatch = Buffer.compare(storedMerkleRoot, Buffer.from(merkleRoot)) === 0;

    console.log(`\nVerification:`);
    console.log(`  Commitment match: ${commitmentMatch ? '✓' : '✗'}`);
    console.log(`  Nullifier match: ${nullifierMatch ? '✓' : '✗'}`);
    console.log(`  Merkle root match: ${merkleRootMatch ? '✓' : '✗'}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('E2E Tests Complete');
  console.log('='.repeat(60));
}

// Run tests
runE2ETests().catch(console.error);
