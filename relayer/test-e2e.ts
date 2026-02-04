/**
 * End-to-end test for Murkl claim flow
 * Generates proof using WASM and submits to relayer
 */

import * as fs from 'fs';
import * as path from 'path';

const RELAYER_URL = 'http://localhost:3001';

// Test parameters
const POOL = '8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ';
const IDENTIFIER = '_Exidz_';
const PASSWORD = '12345678';
const LEAF_INDEX = 9;
const RECIPIENT = 'DhUG7vMJsx3GDAJ3RLmFhs5piwfSxN6zX34ABvUwgC3T';

async function loadWasm() {
  const wasmPath = path.join(__dirname, '../web/src/wasm/murkl_wasm_bg.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  
  // Import the JS glue code
  const wasmModule = await import('../web/src/wasm/murkl_wasm.js');
  
  // Initialize with the buffer
  await wasmModule.default(wasmBuffer);
  
  return wasmModule;
}

async function main() {
  console.log('=== Murkl E2E Test ===\n');
  
  // Step 1: Fetch pool info first (need merkle root for proof)
  console.log('Fetching pool info...');
  const poolRes = await fetch(`${RELAYER_URL}/pool-info?pool=${POOL}`);
  const poolInfo = await poolRes.json() as { merkleRoot: string; leafCount: string };
  console.log(`  Merkle Root: ${poolInfo.merkleRoot}`);
  console.log(`  Leaf Count: ${poolInfo.leafCount}`);
  console.log();
  
  // Step 2: Load WASM and generate proof
  console.log('Loading WASM...');
  const wasm = await loadWasm();
  
  console.log('Generating STARK proof...');
  const bundle = wasm.generate_proof(
    IDENTIFIER,
    PASSWORD,
    LEAF_INDEX,
    poolInfo.merkleRoot
  ) as {
    commitment: string;
    nullifier: string;
    leaf_index: number;
    proof: string;
    proof_size: number;
    error?: string;
  };
  
  if (bundle.error) {
    console.log('❌ Proof generation failed:', bundle.error);
    return;
  }
  
  const { commitment, nullifier, proof } = bundle;
  
  console.log('Credentials:');
  console.log(`  Identifier: ${IDENTIFIER}`);
  console.log(`  Commitment: ${commitment}`);
  console.log(`  Nullifier: ${nullifier}`);
  console.log(`  Leaf Index: ${LEAF_INDEX}`);
  console.log(`  Proof size: ${bundle.proof_size} bytes`);
  console.log(`  Proof prefix: ${proof.slice(0, 64)}...`);
  console.log();
  
  // Step 4: Get recipient token account
  const { PublicKey } = await import('@solana/web3.js');
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  
  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const recipientPubkey = new PublicKey(RECIPIENT);
  const recipientATA = await getAssociatedTokenAddress(WSOL_MINT, recipientPubkey);
  
  console.log(`Recipient ATA: ${recipientATA.toBase58()}`);
  console.log();
  
  // Step 5: Submit claim
  console.log('Submitting claim to relayer...');
  const claimRes = await fetch(`${RELAYER_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof,
      commitment,
      nullifier,
      merkleRoot: poolInfo.merkleRoot,
      leafIndex: LEAF_INDEX,
      recipientTokenAccount: recipientATA.toBase58(),
      poolAddress: POOL,
      feeBps: 50
    })
  });
  
  const resultText = await claimRes.text();
  console.log(`Response status: ${claimRes.status}`);
  console.log(`Response body: ${resultText}`);
  
  try {
    const result = JSON.parse(resultText);
    if (claimRes.ok) {
      console.log('✅ Claim successful!');
      console.log(`  TX: ${result.signature}`);
      console.log(`  Amount: ${result.amount}`);
    } else {
      console.log('❌ Claim failed:');
      console.log(JSON.stringify(result, null, 2));
    }
  } catch {
    console.log('Failed to parse response as JSON');
  }
}

main().catch(console.error);
