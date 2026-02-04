/**
 * Batch claim multiple leaves
 */

import * as fs from 'fs';
import * as path from 'path';

const RELAYER_URL = 'http://localhost:3001';

// Batch parameters
const POOL = '8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ';
const IDENTIFIER = '_Exidz_';
const PASSWORD = '12345678';
const RECIPIENT = 'B3faDo3TXjX69zpXKRX4xLqQeYiBDYga5spPWgGFaDoh';
const LEAVES = [13, 14, 15, 16, 17, 18, 19, 20, 21];

async function loadWasm() {
  const wasmPath = path.join(__dirname, '../web/src/wasm/murkl_wasm_bg.wasm');
  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmModule = await import('../web/src/wasm/murkl_wasm.js');
  await wasmModule.default(wasmBuffer);
  return wasmModule;
}

async function main() {
  console.log('=== Murkl Batch Claim ===\n');
  console.log(`Recipient: ${RECIPIENT}`);
  console.log(`Leaves: ${LEAVES.join(', ')}\n`);
  
  // Fetch pool info
  console.log('Fetching pool info...');
  const poolRes = await fetch(`${RELAYER_URL}/pool-info?pool=${POOL}`);
  const poolInfo = await poolRes.json() as { merkleRoot: string; leafCount: string };
  console.log(`  Merkle Root: ${poolInfo.merkleRoot}`);
  console.log(`  Leaf Count: ${poolInfo.leafCount}\n`);
  
  // Load WASM
  console.log('Loading WASM...');
  const wasm = await loadWasm();
  
  // Get recipient ATA
  const { PublicKey } = await import('@solana/web3.js');
  const { getAssociatedTokenAddress } = await import('@solana/spl-token');
  
  const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const recipientPubkey = new PublicKey(RECIPIENT);
  const recipientATA = await getAssociatedTokenAddress(WSOL_MINT, recipientPubkey);
  console.log(`Recipient ATA: ${recipientATA.toBase58()}\n`);
  
  const results: { leaf: number; success: boolean; tx?: string; error?: string }[] = [];
  
  for (const leafIndex of LEAVES) {
    console.log(`\n--- Claiming leaf ${leafIndex} ---`);
    
    try {
      // Generate proof
      const bundle = wasm.generate_proof(
        IDENTIFIER,
        PASSWORD,
        leafIndex,
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
        console.log(`❌ Proof generation failed: ${bundle.error}`);
        results.push({ leaf: leafIndex, success: false, error: bundle.error });
        continue;
      }
      
      console.log(`  Commitment: ${bundle.commitment.slice(0, 16)}...`);
      console.log(`  Nullifier: ${bundle.nullifier.slice(0, 16)}...`);
      console.log(`  Proof size: ${bundle.proof_size} bytes`);
      
      // Submit claim
      const claimRes = await fetch(`${RELAYER_URL}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proof: bundle.proof,
          commitment: bundle.commitment,
          nullifier: bundle.nullifier,
          merkleRoot: poolInfo.merkleRoot,
          leafIndex,
          recipientTokenAccount: recipientATA.toBase58(),
          poolAddress: POOL,
          feeBps: 50
        })
      });
      
      const result = await claimRes.json() as { success?: boolean; signature?: string; error?: string };
      
      if (claimRes.ok && result.success) {
        console.log(`✅ Claimed! TX: ${result.signature}`);
        results.push({ leaf: leafIndex, success: true, tx: result.signature });
      } else {
        console.log(`❌ Failed: ${result.error || 'Unknown error'}`);
        results.push({ leaf: leafIndex, success: false, error: result.error });
      }
      
      // Small delay between claims
      await new Promise(r => setTimeout(r, 1000));
      
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`❌ Error: ${errMsg}`);
      results.push({ leaf: leafIndex, success: false, error: errMsg });
    }
  }
  
  // Summary
  console.log('\n\n=== SUMMARY ===');
  const succeeded = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n✅ Succeeded: ${succeeded.length}`);
  for (const r of succeeded) {
    console.log(`  Leaf ${r.leaf}: ${r.tx}`);
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ Failed: ${failed.length}`);
    for (const r of failed) {
      console.log(`  Leaf ${r.leaf}: ${r.error}`);
    }
  }
}

main().catch(console.error);
