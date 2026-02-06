/*
E2E sanity: deposit -> generate proof (WASM) -> claim via relayer
and verify recipient-substitution attack fails.

Run:
  cd /home/exidz/.openclaw/workspace/murkl
  npx tsx scripts/e2e-recipient-binding.ts
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';

// WASM prover (node init via initSync with bytes)
import initSync, { generate_commitment, generate_proof } from '../web/src/wasm/murkl_wasm.js';

const RELAYER_URL = process.env.RELAYER_URL || 'https://murkl-relayer-production.up.railway.app';
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

const PROGRAM_ID = new PublicKey('muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const POOL = new PublicKey('8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function u8aToHex(u8: Uint8Array): string {
  return Buffer.from(u8).toString('hex');
}

async function anchorDiscriminator(name: string): Promise<Buffer> {
  // Anchor discriminator: sha256("global:<name>")[0..8]
  const nodeCrypto = await import('node:crypto');
  const hash = nodeCrypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

async function fetchPoolInfo(connection: Connection, pool: PublicKey): Promise<{ mint: PublicKey; vault: PublicKey; nextLeafIndex: number }> {
  const info = await connection.getAccountInfo(pool);
  if (!info) throw new Error('Pool not found');
  const data = info.data;
  const mint = new PublicKey(data.slice(40, 72));
  const vault = new PublicKey(data.slice(72, 104));
  const nextLeafIndex = Number(data.readBigUInt64LE(136));
  return { mint, vault, nextLeafIndex };
}

async function buildDepositTx(params: {
  connection: Connection;
  depositor: PublicKey;
  identifier: string;
  password: string;
  amountSol: number;
}): Promise<{ tx: Transaction; leafIndex: number; commitmentHex: string }> {
  const { connection, depositor, identifier, password, amountSol } = params;

  const poolInfo = await fetchPoolInfo(connection, POOL);
  if (!poolInfo.mint.equals(NATIVE_MINT)) {
    throw new Error('Pool mint is not WSOL/NATIVE_MINT; script assumes WSOL pool');
  }

  const leafIndex = poolInfo.nextLeafIndex;

  const leafIndexBuf = Buffer.alloc(8);
  leafIndexBuf.writeBigUInt64LE(BigInt(leafIndex));
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), POOL.toBuffer(), leafIndexBuf],
    PROGRAM_ID,
  );

  const userAta = await getAssociatedTokenAddress(poolInfo.mint, depositor);
  const userAtaInfo = await connection.getAccountInfo(userAta);

  const commitmentHex = generate_commitment(identifier, password);
  const commitmentBytes = Buffer.from(commitmentHex, 'hex');
  if (commitmentBytes.length !== 32) throw new Error('commitment not 32 bytes');

  const amountLamports = BigInt(Math.floor(amountSol * 1e9));

  const disc = await anchorDiscriminator('deposit');
  const ixData = Buffer.alloc(8 + 8 + 32);
  disc.copy(ixData, 0);
  ixData.writeBigUInt64LE(amountLamports, 8);
  commitmentBytes.copy(ixData, 16);

  const tx = new Transaction();

  if (!userAtaInfo) {
    tx.add(createAssociatedTokenAccountInstruction(depositor, userAta, depositor, poolInfo.mint));
  }

  // Wrap SOL into WSOL ATA
  tx.add(
    SystemProgram.transfer({
      fromPubkey: depositor,
      toPubkey: userAta,
      lamports: Number(amountLamports),
    }),
  );
  tx.add(createSyncNativeInstruction(userAta));

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: POOL, isSigner: false, isWritable: true },
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: poolInfo.vault, isSigner: false, isWritable: true },
      { pubkey: depositor, isSigner: true, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: ixData,
  });

  tx.add(ix);
  return { tx, leafIndex, commitmentHex };
}

async function main() {
  const payer = loadKeypair(path.join(process.env.HOME || '', '.config/solana/id.json'));
  const connection = new Connection(RPC_URL, 'confirmed');

  console.log('payer:', payer.publicKey.toBase58());

  // Init WASM (load .wasm bytes)
  const wasmPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'src', 'wasm', 'murkl_wasm_bg.wasm');
  initSync(fs.readFileSync(wasmPath));

  // Create a fresh recipient wallet B to test substitution
  const recipientB = Keypair.generate();

  const recipientAtaA = await getAssociatedTokenAddress(WSOL_MINT, payer.publicKey);
  const recipientAtaB = await getAssociatedTokenAddress(WSOL_MINT, recipientB.publicKey);

  // Ensure recipientAtaB exists (relayer requires ATA exists)
  const ataBInfo = await connection.getAccountInfo(recipientAtaB);
  if (!ataBInfo) {
    const ix = createAssociatedTokenAccountInstruction(
      payer.publicKey,
      recipientAtaB,
      recipientB.publicKey,
      WSOL_MINT,
    );
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(payer);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log('created recipient B ATA:', recipientAtaB.toBase58(), sig);
  }

  // Deposit params
  const identifier = `twitter:@e2e_${Date.now()}`;
  const password = `E2E_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  const amountSol = 0.01;

  const redact = (s: string, keepStart = 6, keepEnd = 4) => {
    if (!s) return '';
    if (s.length <= keepStart + keepEnd) return `${s.slice(0, 2)}…`;
    return `${s.slice(0, keepStart)}…${s.slice(-keepEnd)}`;
  };

  console.log('deposit identifier:', redact(identifier));
  console.log('deposit password: [REDACTED]');

  const { tx, leafIndex, commitmentHex } = await buildDepositTx({
    connection,
    depositor: payer.publicKey,
    identifier,
    password,
    amountSol,
  });

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = blockhash;
  tx.sign(payer);

  const depSig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await connection.confirmTransaction({ signature: depSig, blockhash, lastValidBlockHeight }, 'confirmed');

  console.log('deposit tx:', depSig);
  console.log('leafIndex:', leafIndex);
  console.log('commitment:', redact(commitmentHex));

  // Fetch merkle root from relayer
  const poolInfoRes = await fetch(`${RELAYER_URL}/pool-info?pool=${POOL.toBase58()}`);
  if (!poolInfoRes.ok) throw new Error('pool-info failed');
  const poolInfo = await poolInfoRes.json() as any;
  const merkleRootHex = poolInfo.merkleRoot as string;
  console.log('pool merkleRoot:', merkleRootHex);

  // Generate proof bound to recipient ATA A
  const recipientHexA = u8aToHex(recipientAtaA.toBytes());
  const proofBundle: any = generate_proof(identifier, password, leafIndex, merkleRootHex, recipientHexA);
  if (proofBundle?.error) throw new Error(`wasm proof error: ${proofBundle.error}`);

  console.log('proof size:', proofBundle.proof_size);
  if (proofBundle.debug_alpha) console.log('wasm alpha:', proofBundle.debug_alpha);
  if (proofBundle.debug_oods_point) console.log('wasm oods_point:', proofBundle.debug_oods_point);
  if (proofBundle.debug_trace_oods) console.log('wasm trace_oods:', proofBundle.debug_trace_oods);
  if (proofBundle.debug_composition_oods) console.log('wasm composition_oods:', proofBundle.debug_composition_oods);

  // Attack attempt: submit same proof but claim to recipient B
  const attackRes = await fetch(`${RELAYER_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof: proofBundle.proof,
      commitment: proofBundle.commitment,
      nullifier: proofBundle.nullifier,
      merkleRoot: merkleRootHex,
      leafIndex,
      recipientTokenAccount: recipientAtaB.toBase58(),
      poolAddress: POOL.toBase58(),
      feeBps: 50,
    }),
  });

  const attackText = await attackRes.text();
  console.log('attack status:', attackRes.status, attackText.slice(0, 200));
  if (attackRes.ok) {
    throw new Error('❌ recipient substitution unexpectedly succeeded');
  }

  // Legit claim: recipient A
  const claimRes = await fetch(`${RELAYER_URL}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proof: proofBundle.proof,
      commitment: proofBundle.commitment,
      nullifier: proofBundle.nullifier,
      merkleRoot: merkleRootHex,
      leafIndex,
      recipientTokenAccount: recipientAtaA.toBase58(),
      poolAddress: POOL.toBase58(),
      feeBps: 50,
    }),
  });

  const claimText = await claimRes.text();
  console.log('claim status:', claimRes.status, claimText.slice(0, 200));
  if (!claimRes.ok) {
    throw new Error(`❌ claim failed: ${claimText}`);
  }

  console.log('✅ E2E passed: substitution rejected, legit claim succeeded');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
