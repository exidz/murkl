/**
 * Murkl E2E Test - Full claim flow without UI
 * 
 * Tests:
 * 1. Generate STARK proof (using WASM logic)
 * 2. Upload proof to buffer (chunked)
 * 3. Verify and claim tokens
 */

import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
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

const PROGRAM_ID = new PublicKey('74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const M31_PRIME = 0x7FFFFFFF;
const CHUNK_SIZE = 900;

// ============================================================================
// Hash functions (matching WASM)
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

function computeCommitment(idHash: number, secret: number): Buffer {
  const idBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(idHash, 0);
  const secretBuf = Buffer.alloc(4);
  secretBuf.writeUInt32LE(secret, 0);
  
  const data = Buffer.concat([
    Buffer.from('murkl_m31_hash_v1'),
    idBuf,
    secretBuf
  ]);
  
  return Buffer.from(keccak256(data), 'hex');
}

function computeNullifier(secret: number, leafIndex: number): Buffer {
  const secretBuf = Buffer.alloc(4);
  secretBuf.writeUInt32LE(secret, 0);
  const leafBuf = Buffer.alloc(4);
  leafBuf.writeUInt32LE(leafIndex, 0);
  
  const data = Buffer.concat([
    Buffer.from('murkl_nullifier_v1'),
    secretBuf,
    leafBuf
  ]);
  
  return Buffer.from(keccak256(data), 'hex');
}

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ============================================================================
// Generate STARK proof (exact match to WASM prover format)
// ============================================================================

const PROVER_CONFIG = {
  log_trace_size: 8,
  log_blowup_factor: 2,
  n_queries: 3,
  log_last_layer_degree: 2,
};

function generateStarkProof(idHash: number, secret: number, leafIndex: number): Buffer {
  const parts: Buffer[] = [];
  
  // Compute values like WASM does
  const commitmentHash = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('murkl_m31_hash_v1'),
    Buffer.alloc(4).fill(0).map((_, i) => (idHash >> (i * 8)) & 0xff),
    Buffer.alloc(4).fill(0).map((_, i) => (secret >> (i * 8)) & 0xff),
  ].map(x => typeof x === 'number' ? Buffer.from([x]) : x).flat())), 'hex');
  
  const commitment = commitmentHash.readUInt32LE(0) % M31_PRIME;
  
  const nullifierHash = Buffer.from(keccak256(Buffer.concat([
    Buffer.from('murkl_nullifier_v1'),
    Buffer.alloc(4).fill(0).map((_, i) => (secret >> (i * 8)) & 0xff),
    Buffer.alloc(4).fill(0).map((_, i) => (leafIndex >> (i * 8)) & 0xff),
  ].map(x => typeof x === 'number' ? Buffer.from([x]) : x).flat())), 'hex');
  
  const nullifier = nullifierHash.readUInt32LE(0) % M31_PRIME;
  
  // Trace commitment (32 bytes) - exactly like WASM
  const traceInput = Buffer.concat([
    Buffer.from('trace'),
    u32ToLeBytes(idHash),
    u32ToLeBytes(secret),
    u32ToLeBytes(commitment),
    u32ToLeBytes(nullifier),
  ]);
  const traceCommitment = Buffer.from(keccak256(traceInput), 'hex');
  parts.push(traceCommitment);
  
  // Composition commitment (32 bytes)
  const compositionInput = Buffer.concat([Buffer.from('composition'), traceCommitment]);
  const compositionCommitment = Buffer.from(keccak256(compositionInput), 'hex');
  parts.push(compositionCommitment);
  
  // OODS values: count (u32) + QM31 values
  const oodsCount = 4;
  parts.push(u32ToLeBytes(oodsCount));
  for (const val of [idHash, secret, commitment, nullifier]) {
    parts.push(u32ToLeBytes(val));  // a
    parts.push(u32ToLeBytes(0));     // b
    parts.push(u32ToLeBytes(0));     // c
    parts.push(u32ToLeBytes(0));     // d
  }
  
  // FRI layers
  const nLayers = PROVER_CONFIG.log_trace_size - PROVER_CONFIG.log_last_layer_degree;
  parts.push(u32ToLeBytes(nLayers));
  
  for (let i = 0; i < nLayers; i++) {
    // Layer commitment
    const layerInput = Buffer.concat([
      Buffer.from('fri_layer'),
      u32ToLeBytes(i),
      traceCommitment,
    ]);
    const layerCommitment = Buffer.from(keccak256(layerInput), 'hex');
    parts.push(layerCommitment);
    
    // Evaluations count
    const evalCount = PROVER_CONFIG.n_queries;
    parts.push(u32ToLeBytes(evalCount));
    
    // Evaluations (QM31 values)
    for (let q = 0; q < evalCount; q++) {
      const eval_val = ((q * 7 + i) * 13) % M31_PRIME;
      parts.push(u32ToLeBytes(eval_val));
      parts.push(u32ToLeBytes(0));
      parts.push(u32ToLeBytes(0));
      parts.push(u32ToLeBytes(0));
    }
    
    // Merkle paths count
    parts.push(u32ToLeBytes(evalCount));
    
    const depth = PROVER_CONFIG.log_trace_size + PROVER_CONFIG.log_blowup_factor - i;
    for (let q = 0; q < evalCount; q++) {
      parts.push(u32ToLeBytes(depth));
      for (let d = 0; d < depth; d++) {
        const node = Buffer.alloc(32);
        node[0] = q;
        node[1] = d;
        node[2] = i;
        parts.push(node);
      }
    }
  }
  
  // Last layer poly
  const lastLayerSize = 1 << PROVER_CONFIG.log_last_layer_degree;
  parts.push(u32ToLeBytes(lastLayerSize));
  for (let i = 0; i < lastLayerSize; i++) {
    parts.push(u32ToLeBytes(i));
    parts.push(u32ToLeBytes(0));
    parts.push(u32ToLeBytes(0));
    parts.push(u32ToLeBytes(0));
  }
  
  // Query positions
  parts.push(u32ToLeBytes(PROVER_CONFIG.n_queries));
  const domainSize = 1 << (PROVER_CONFIG.log_trace_size + PROVER_CONFIG.log_blowup_factor);
  for (let q = 0; q < PROVER_CONFIG.n_queries; q++) {
    const pos = ((q * 7 + 13)) % domainSize;
    parts.push(u32ToLeBytes(pos));
  }
  
  // Trace decommitments
  parts.push(u32ToLeBytes(PROVER_CONFIG.n_queries));
  const traceDepth = PROVER_CONFIG.log_trace_size + PROVER_CONFIG.log_blowup_factor;
  for (let q = 0; q < PROVER_CONFIG.n_queries; q++) {
    parts.push(u32ToLeBytes(traceDepth));
    for (let d = 0; d < traceDepth; d++) {
      const node = Buffer.alloc(32);
      node[0] = q;
      node[1] = d;
      parts.push(node);
    }
  }
  
  return Buffer.concat(parts);
}

function u32ToLeBytes(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(val >>> 0, 0);
  return buf;
}

// ============================================================================
// Main E2E Test
// ============================================================================

async function main() {
  console.log('🐈‍⬛ Murkl E2E Test\n');
  
  // Load config
  const poolData = JSON.parse(fs.readFileSync('/tmp/murkl-pool.json', 'utf-8'));
  const depositData = JSON.parse(fs.readFileSync('/tmp/murkl-deposit.json', 'utf-8'));
  
  const connection = new Connection(poolData.rpc, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
  });
  
  // Load wallet
  const walletPath = `${process.env.HOME}/.config/solana/id.json`;
  const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
  const relayer = Keypair.fromSecretKey(new Uint8Array(secretKey));
  
  console.log(`👛 Relayer: ${relayer.publicKey.toBase58()}`);
  console.log(`📦 Pool: ${depositData.pool}`);
  console.log(`📄 Deposit: ${depositData.depositPda}`);
  console.log(`🔐 Identifier: ${depositData.identifier}`);
  console.log(`📍 Leaf Index: ${depositData.leafIndex}\n`);
  
  // Compute values
  const idHash = hashIdentifier(depositData.identifier);
  const secret = hashPassword(depositData.password);
  const commitment = computeCommitment(idHash, secret);
  const nullifier = computeNullifier(secret, depositData.leafIndex);
  
  console.log(`   ID Hash: ${idHash}`);
  console.log(`   Secret: ${secret}`);
  console.log(`   Commitment: 0x${commitment.toString('hex').slice(0, 16)}...`);
  console.log(`   Nullifier: 0x${nullifier.toString('hex').slice(0, 16)}...`);
  
  // Verify commitment matches deposit
  const storedCommitment = depositData.commitment;
  const computedCommitment = commitment.toString('hex');
  
  if (storedCommitment !== computedCommitment) {
    console.log(`\n❌ Commitment mismatch!`);
    console.log(`   Stored:   ${storedCommitment}`);
    console.log(`   Computed: ${computedCommitment}`);
    process.exit(1);
  }
  console.log(`\n✅ Commitment matches!\n`);
  
  // Generate proof (matching WASM format exactly)
  console.log('📤 Generating STARK proof...');
  const proofBytes = generateStarkProof(idHash, secret, depositData.leafIndex);
  console.log(`   Proof size: ${proofBytes.length} bytes`);
  
  // Derive PDAs
  const pool = new PublicKey(depositData.pool);
  const deposit = new PublicKey(depositData.depositPda);
  const tokenMint = new PublicKey(poolData.mint);
  
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), pool.toBuffer()],
    PROGRAM_ID
  );
  
  const [proofBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('proof'), relayer.publicKey.toBuffer(), commitment.slice(0, 8)],
    PROGRAM_ID
  );
  
  const [nullifierPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifier'), pool.toBuffer(), nullifier],
    PROGRAM_ID
  );
  
  console.log(`   Proof buffer PDA: ${proofBufferPda.toBase58()}`);
  console.log(`   Nullifier PDA: ${nullifierPda.toBase58()}`);
  
  // Check if proof buffer exists
  const existingBuffer = await connection.getAccountInfo(proofBufferPda);
  let bufferFinalized = false;
  
  if (existingBuffer) {
    const finalizedByte = existingBuffer.data[8 + 32 + 32 + 32 + 4 + 4];
    bufferFinalized = finalizedByte === 1;
    console.log(`\n   Buffer exists, finalized: ${bufferFinalized}`);
  }
  
  if (!bufferFinalized) {
    // Step 1: Create proof buffer
    if (!existingBuffer) {
      console.log('\n📤 Step 1: Creating proof buffer...');
      
      const createData = Buffer.concat([
        getDiscriminator('create_proof_buffer'),
        commitment,
        nullifier,
        Buffer.from(new Uint32Array([proofBytes.length]).buffer),
      ]);
      
      const createIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: proofBufferPda, isSigner: false, isWritable: true },
          { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: createData,
      });
      
      const createTx = new Transaction().add(createIx);
      createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      createTx.feePayer = relayer.publicKey;
      
      const createSig = await sendAndConfirmTransaction(connection, createTx, [relayer], { skipPreflight: true });
      console.log(`   ✅ Created: ${createSig.slice(0, 20)}...`);
    }
    
    // Step 2: Write chunks
    console.log('\n📤 Step 2: Writing proof chunks...');
    const numChunks = Math.ceil(proofBytes.length / CHUNK_SIZE);
    
    for (let i = 0; i < numChunks; i++) {
      const offset = i * CHUNK_SIZE;
      const chunk = proofBytes.slice(offset, offset + CHUNK_SIZE);
      
      const writeData = Buffer.concat([
        getDiscriminator('write_proof_chunk'),
        Buffer.from(new Uint32Array([offset]).buffer),
        Buffer.from(new Uint32Array([chunk.length]).buffer),
        chunk,
      ]);
      
      const writeIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: proofBufferPda, isSigner: false, isWritable: true },
          { pubkey: relayer.publicKey, isSigner: true, isWritable: false },
        ],
        data: writeData,
      });
      
      const writeTx = new Transaction().add(writeIx);
      writeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      writeTx.feePayer = relayer.publicKey;
      
      await sendAndConfirmTransaction(connection, writeTx, [relayer], { skipPreflight: true });
      console.log(`   ✅ Chunk ${i + 1}/${numChunks}`);
    }
    
    // Step 3: Finalize
    console.log('\n📤 Step 3: Finalizing buffer...');
    
    const finalizeIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: proofBufferPda, isSigner: false, isWritable: true },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: false },
      ],
      data: getDiscriminator('finalize_proof_buffer'),
    });
    
    const finalizeTx = new Transaction().add(finalizeIx);
    finalizeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    finalizeTx.feePayer = relayer.publicKey;
    
    await sendAndConfirmTransaction(connection, finalizeTx, [relayer], { skipPreflight: true });
    console.log(`   ✅ Finalized`);
  }
  
  // Step 4: Claim
  console.log('\n🔐 Step 4: Claiming...');
  
  // Get recipient ATA
  const recipientWallet = relayer.publicKey; // Self-claim for test
  const recipientAta = await getAssociatedTokenAddress(tokenMint, recipientWallet);
  
  // Check if ATA exists
  const ataInfo = await connection.getAccountInfo(recipientAta);
  
  const claimTx = new Transaction();
  
  if (!ataInfo) {
    console.log('   Creating recipient ATA...');
    claimTx.add(
      createAssociatedTokenAccountInstruction(
        relayer.publicKey,
        recipientAta,
        recipientWallet,
        tokenMint
      )
    );
  }
  
  const relayerFee = BigInt(0); // No fee for self-claim (u64)
  const feeBuffer = Buffer.alloc(8);
  feeBuffer.writeBigUInt64LE(relayerFee);
  
  const claimData = Buffer.concat([
    getDiscriminator('claim'),
    feeBuffer,           // relayer_fee: u64 (8 bytes)
    nullifier,           // nullifier: [u8; 32] (32 bytes)
  ]);
  
  const claimIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: pool, isSigner: false, isWritable: false },           // pool (not writable)
      { pubkey: deposit, isSigner: false, isWritable: true },         // deposit
      { pubkey: proofBufferPda, isSigner: false, isWritable: false }, // verifier_buffer
      { pubkey: nullifierPda, isSigner: false, isWritable: true },    // nullifier_record (init)
      { pubkey: vaultPda, isSigner: false, isWritable: true },        // vault
      { pubkey: recipientAta, isSigner: false, isWritable: true },    // recipient_token
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },// relayer (signer)
      { pubkey: recipientAta, isSigner: false, isWritable: true },    // relayer_token
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
    console.log(`\n❌ Claim simulation failed:`);
    console.log(`   Error: ${JSON.stringify(simResult.value.err)}`);
    console.log(`   Logs:`);
    simResult.value.logs?.forEach(l => console.log(`      ${l}`));
    process.exit(1);
  }
  
  console.log(`   ✅ Simulation passed (${simResult.value.unitsConsumed} CU)`);
  
  // Send for real
  const claimSig = await sendAndConfirmTransaction(connection, claimTx, [relayer], { skipPreflight: true });
  console.log(`   ✅ Claimed: ${claimSig}`);
  
  // Verify token balance
  const ataAccount = await getAccount(connection, recipientAta);
  console.log(`\n🎉 SUCCESS!`);
  console.log(`   Token balance: ${Number(ataAccount.amount) / 1e9} tokens`);
  console.log(`   Transaction: ${claimSig}`);
}

main().catch(e => {
  console.error('\n❌ E2E Test Failed:', e.message);
  process.exit(1);
});
