/**
 * Test the relayer claim endpoint
 * 
 * This creates a test proof and submits it to the relayer to verify
 * the init_proof_buffer -> upload_chunk -> finalize_and_verify flow works.
 */

import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import * as crypto from 'crypto';

const RELAYER_URL = 'http://localhost:3001';
const POOL_ADDRESS = '8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ';
const RPC_URL = 'https://api.devnet.solana.com';

// Generate deterministic test values
function generateTestProof() {
  const identifier = 'test@example.com';
  const password = 'testpassword123';
  const leafIndex = 0;
  
  // Generate commitment: H(identifier || password)
  const idHash = crypto.createHash('sha256').update(identifier.toLowerCase()).digest();
  const secretHash = crypto.createHash('sha256').update(password).digest();
  const commitment = crypto.createHash('sha256').update(Buffer.concat([idHash, secretHash])).digest();
  
  // Generate nullifier: H(secret || leafIndex)
  const leafBuf = Buffer.alloc(4);
  leafBuf.writeUInt32LE(leafIndex);
  const nullifier = crypto.createHash('sha256').update(Buffer.concat([secretHash, leafBuf])).digest();
  
  // Generate a minimal valid-looking proof (for testing the buffer creation flow)
  // This won't pass verification but will test the init/upload/finalize flow
  const proof = generateMinimalProof(commitment, nullifier);
  
  return {
    commitment: commitment.toString('hex'),
    nullifier: nullifier.toString('hex'),
    leafIndex,
    proof: proof.toString('hex'),
    proofSize: proof.length,
  };
}

function generateMinimalProof(commitment: Buffer, nullifier: Buffer): Buffer {
  const parts: Buffer[] = [];
  
  // Trace commitment (32 bytes)
  parts.push(crypto.createHash('sha256').update(Buffer.concat([Buffer.from('trace'), commitment])).digest());
  
  // Composition commitment (32 bytes)
  parts.push(crypto.createHash('sha256').update(Buffer.concat([Buffer.from('comp'), parts[0]])).digest());
  
  // Trace OODS (16 bytes - QM31)
  parts.push(Buffer.alloc(16, 1));
  
  // Composition OODS (16 bytes - QM31)
  parts.push(Buffer.alloc(16, 2));
  
  // FRI layer count (1 byte) - 3 layers
  parts.push(Buffer.from([3]));
  
  // FRI layer commitments (32 bytes each)
  for (let i = 0; i < 3; i++) {
    parts.push(crypto.createHash('sha256').update(Buffer.from(`fri_layer_${i}`)).digest());
  }
  
  // Final polynomial count (2 bytes)
  parts.push(Buffer.from([2, 0]));
  
  // Final polynomial coefficients (16 bytes each)
  parts.push(Buffer.alloc(16, 3));
  parts.push(Buffer.alloc(16, 4));
  
  // Query count (1 byte) - 4 queries
  parts.push(Buffer.from([4]));
  
  // Generate 4 queries
  const treeDepth = 8;
  for (let q = 0; q < 4; q++) {
    // Query index (4 bytes)
    const indexBuf = Buffer.alloc(4);
    indexBuf.writeUInt32LE(q * 64);
    parts.push(indexBuf);
    
    // Trace value (32 bytes)
    parts.push(crypto.createHash('sha256').update(Buffer.from(`trace_${q}`)).digest());
    
    // Trace path length (1 byte)
    parts.push(Buffer.from([treeDepth]));
    
    // Trace Merkle path
    for (let d = 0; d < treeDepth; d++) {
      parts.push(crypto.createHash('sha256').update(Buffer.from(`trace_path_${q}_${d}`)).digest());
    }
    
    // Composition value (32 bytes)
    parts.push(crypto.createHash('sha256').update(Buffer.from(`comp_${q}`)).digest());
    
    // Composition path length (1 byte)
    parts.push(Buffer.from([treeDepth]));
    
    // Composition Merkle path
    for (let d = 0; d < treeDepth; d++) {
      parts.push(crypto.createHash('sha256').update(Buffer.from(`comp_path_${q}_${d}`)).digest());
    }
    
    // FRI layer data (3 layers)
    let currentDepth = treeDepth;
    for (let layer = 0; layer < 3; layer++) {
      // 4 sibling QM31 values (64 bytes)
      parts.push(Buffer.alloc(64, layer + 5));
      
      // FRI layer path
      currentDepth = Math.max(0, currentDepth - 2);
      parts.push(Buffer.from([currentDepth]));
      
      for (let d = 0; d < currentDepth; d++) {
        parts.push(crypto.createHash('sha256').update(Buffer.from(`fri_${q}_${layer}_${d}`)).digest());
      }
    }
  }
  
  return Buffer.concat(parts);
}

async function testClaim() {
  console.log('=== Testing Relayer Claim Flow ===\n');
  
  // Generate test data
  const testData = generateTestProof();
  console.log('Generated test data:');
  console.log('  Commitment:', testData.commitment.slice(0, 16) + '...');
  console.log('  Nullifier:', testData.nullifier.slice(0, 16) + '...');
  console.log('  Proof size:', testData.proofSize, 'bytes');
  console.log('  Leaf index:', testData.leafIndex);
  console.log();
  
  // Get a test recipient
  const connection = new Connection(RPC_URL);
  const recipientKeypair = Keypair.generate();
  const pool = new PublicKey(POOL_ADDRESS);
  
  // Get pool token mint
  const poolInfo = await connection.getAccountInfo(pool);
  if (!poolInfo) {
    console.error('Pool not found!');
    return;
  }
  const tokenMint = new PublicKey(poolInfo.data.slice(8 + 32, 8 + 32 + 32));
  console.log('Pool token mint:', tokenMint.toBase58());
  
  // Derive recipient ATA
  const recipientAta = await getAssociatedTokenAddress(tokenMint, recipientKeypair.publicKey);
  console.log('Recipient ATA:', recipientAta.toBase58());
  console.log();
  
  // Submit claim request
  console.log('Submitting claim to relayer...');
  try {
    const response = await fetch(`${RELAYER_URL}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: testData.proof,
        commitment: testData.commitment,
        nullifier: testData.nullifier,
        recipientTokenAccount: recipientKeypair.publicKey.toBase58(), // Using pubkey, relayer will derive ATA
        poolAddress: POOL_ADDRESS,
        leafIndex: testData.leafIndex,
        feeBps: 50,
      }),
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Claim succeeded!');
      console.log('   Signature:', result.signature);
      console.log('   Chunks written:', result.chunksWritten);
    } else {
      console.log('❌ Claim failed:');
      console.log('   Status:', response.status);
      console.log('   Error:', result.error);
      console.log('   Details:', result.details || 'none');
    }
  } catch (e) {
    console.error('Request error:', e);
  }
}

testClaim().catch(console.error);
