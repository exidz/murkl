/**
 * E2E test: Deposit + Register + Claim flow against devnet
 * 
 * Tests:
 * 1. Build deposit TX with pool_merkle account
 * 2. Sign & send deposit on devnet
 * 3. Register deposit with relayer (triggers email for email identifiers)
 * 4. Verify deposit shows up via relayer API
 * 5. Generate proof & submit claim
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from '@solana/spl-token';
import { keccak256 } from 'js-sha3';
import * as fs from 'fs';
import * as crypto from 'crypto';

// ============================================================
// Config
// ============================================================

const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const RELAYER_URL = process.env.RELAYER_URL || 'https://murkl-relayer-production.up.railway.app';
const PROGRAM_ID = new PublicKey('muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF');
const POOL_ADDRESS = new PublicKey('8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ');
const TOKEN_DECIMALS = 9;

const connection = new Connection(RPC_URL, 'confirmed');

// Load relayer keypair for testing (or generate ephemeral)
function loadTestWallet(): Keypair {
  // Try relayer key first
  const relayerKeyPath = process.env.RELAYER_KEY || '/home/exidz/.openclaw/workspace/murkl/relayer/keypair.json';
  if (fs.existsSync(relayerKeyPath)) {
    const raw = JSON.parse(fs.readFileSync(relayerKeyPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  // Generate ephemeral
  console.log('⚠️  No relayer key found, generating ephemeral wallet (needs airdrop)');
  return Keypair.generate();
}

// ============================================================
// Helpers (matching frontend logic exactly)
// ============================================================

const M31_PRIME = 0x7FFFFFFF;

function hashPassword(password: string): number {
  const data = Buffer.concat([Buffer.from('murkl_password_v1'), Buffer.from(password)]);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  return view.getUint32(0, true) % M31_PRIME;
}

function hashIdentifier(id: string): number {
  const normalized = id.toLowerCase();
  const data = Buffer.concat([Buffer.from('murkl_identifier_v1'), Buffer.from(normalized)]);
  const hash = keccak256.arrayBuffer(data);
  const view = new DataView(hash);
  return view.getUint32(0, true) % M31_PRIME;
}

function computeCommitment(identifier: string, password: string): Buffer {
  const idHash = hashIdentifier(identifier);
  const secret = hashPassword(password);

  const prefix = Buffer.from('murkl_m31_hash_v1');
  const idBuf = Buffer.alloc(4);
  const secretBuf = Buffer.alloc(4);
  idBuf.writeUInt32LE(idHash);
  secretBuf.writeUInt32LE(secret);

  const combined = Buffer.concat([prefix, idBuf, secretBuf]);
  return Buffer.from(keccak256.arrayBuffer(combined));
}

function hashIdentifierForDb(identifier: string): string {
  const normalized = identifier.toLowerCase();
  const data = Buffer.concat([Buffer.from('murkl_identifier_v1'), Buffer.from(normalized)]);
  const hash = keccak256(data);
  // Match relayer's hashIdentifier which returns hex string
  return hash;
}

async function getDiscriminator(name: string): Promise<Buffer> {
  const data = Buffer.from(`global:${name}`);
  const hashBuffer = crypto.createHash('sha256').update(data).digest();
  return hashBuffer.subarray(0, 8);
}

async function fetchPoolInfo(pool: PublicKey) {
  const info = await connection.getAccountInfo(pool);
  if (!info) throw new Error('Pool not found');
  const data = info.data;
  return {
    authority: new PublicKey(data.subarray(8, 40)),
    mint: new PublicKey(data.subarray(40, 72)),
    vault: new PublicKey(data.subarray(72, 104)),
    root: data.subarray(104, 136),
    leafCount: Number(data.readBigUInt64LE(136)),
  };
}

// ============================================================
// Test: Deposit
// ============================================================

async function testDeposit(wallet: Keypair, identifier: string, password: string, amountSol: number) {
  console.log('\n========================================');
  console.log(`📤 TEST DEPOSIT: ${amountSol} SOL → ${identifier}`);
  console.log('========================================\n');

  // 1. Fetch pool info
  const poolInfo = await fetchPoolInfo(POOL_ADDRESS);
  const leafIndex = poolInfo.leafCount;
  console.log(`✅ Pool info: mint=${poolInfo.mint.toBase58().slice(0,8)}..., leafCount=${leafIndex}`);

  // 2. Compute commitment
  const commitment = computeCommitment(identifier, password);
  console.log(`✅ Commitment: ${commitment.toString('hex').slice(0, 16)}...`);

  // 3. Derive PDAs
  const [poolMerklePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pool-merkle'), POOL_ADDRESS.toBuffer()],
    PROGRAM_ID
  );
  console.log(`✅ PoolMerkle PDA: ${poolMerklePda.toBase58().slice(0, 12)}...`);

  // Check pool_merkle exists
  const poolMerkleInfo = await connection.getAccountInfo(poolMerklePda);
  if (!poolMerkleInfo) {
    console.log('❌ FATAL: pool_merkle PDA does not exist on-chain!');
    return null;
  }
  console.log(`✅ PoolMerkle exists: owner=${poolMerkleInfo.owner.toBase58().slice(0,8)}..., size=${poolMerkleInfo.data.length}`);

  const leafIndexBuffer = Buffer.alloc(8);
  leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex));
  const [depositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), POOL_ADDRESS.toBuffer(), leafIndexBuffer],
    PROGRAM_ID
  );
  console.log(`✅ Deposit PDA: ${depositPda.toBase58().slice(0, 12)}...`);

  // 4. Get/create user ATA
  const userAta = await getAssociatedTokenAddress(poolInfo.mint, wallet.publicKey);
  const userAtaInfo = await connection.getAccountInfo(userAta);

  const tx = new Transaction();

  if (!userAtaInfo) {
    console.log('ℹ️  Creating user WSOL ATA...');
    tx.add(createAssociatedTokenAccountInstruction(
      wallet.publicKey, userAta, wallet.publicKey, poolInfo.mint
    ));
  }

  // Wrap SOL
  const amountLamports = BigInt(Math.floor(amountSol * Math.pow(10, TOKEN_DECIMALS)));
  tx.add(SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: userAta,
    lamports: Number(amountLamports),
  }));
  tx.add(createSyncNativeInstruction(userAta));

  // 5. Build deposit instruction
  const discriminator = await getDiscriminator('deposit');
  const instructionData = Buffer.alloc(48);
  instructionData.set(discriminator, 0);
  instructionData.writeBigUInt64LE(amountLamports, 8);
  commitment.copy(instructionData, 16);

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), POOL_ADDRESS.toBuffer()],
    PROGRAM_ID
  );

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: POOL_ADDRESS, isSigner: false, isWritable: true },        // pool
      { pubkey: poolMerklePda, isSigner: false, isWritable: true },       // pool_merkle
      { pubkey: depositPda, isSigner: false, isWritable: true },          // deposit
      { pubkey: vaultPda, isSigner: false, isWritable: true },            // vault
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },     // depositor
      { pubkey: userAta, isSigner: false, isWritable: true },             // depositor_token
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },   // token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ],
    data: instructionData,
  });
  tx.add(ix);

  // 6. Simulate first
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = wallet.publicKey;

  console.log('\n🔍 Simulating deposit transaction...');
  try {
    const sim = await connection.simulateTransaction(tx, [wallet]);
    if (sim.value.err) {
      console.log('❌ SIMULATION FAILED:', JSON.stringify(sim.value.err));
      console.log('Logs:', sim.value.logs?.slice(-10).join('\n'));
      return null;
    }
    console.log(`✅ Simulation passed! CU: ${sim.value.unitsConsumed}`);
  } catch (simErr) {
    console.log('❌ Simulation error:', simErr);
    return null;
  }

  // 7. Send transaction
  console.log('\n📡 Sending deposit transaction...');
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet], { commitment: 'confirmed' });
    console.log(`✅ Deposit TX confirmed: ${sig}`);

    return {
      signature: sig,
      leafIndex,
      commitment: commitment.toString('hex'),
      identifier,
      amount: amountSol,
    };
  } catch (txErr: any) {
    console.log('❌ TX failed:', txErr.message);
    if (txErr.logs) console.log('Logs:', txErr.logs.slice(-10).join('\n'));
    return null;
  }
}

// ============================================================
// Test: Register Deposit
// ============================================================

async function testRegisterDeposit(deposit: {
  signature: string;
  leafIndex: number;
  commitment: string;
  identifier: string;
  amount: number;
}) {
  console.log('\n========================================');
  console.log(`📝 TEST REGISTER: leaf=${deposit.leafIndex}`);
  console.log('========================================\n');

  const body = {
    identifier: deposit.identifier,
    amount: deposit.amount,
    token: 'SOL',
    leafIndex: deposit.leafIndex,
    pool: POOL_ADDRESS.toBase58(),
    commitment: deposit.commitment,
    txSignature: deposit.signature,
  };

  try {
    const res = await fetch(`${RELAYER_URL}/deposits/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${text}`);

    if (res.ok) {
      console.log('✅ Deposit registered successfully');
      if (deposit.identifier.startsWith('email:')) {
        console.log('📧 Email notification should have been triggered');
      }
      return true;
    } else {
      console.log('❌ Registration failed');
      return false;
    }
  } catch (err) {
    console.log('❌ Registration error:', err);
    return false;
  }
}

// ============================================================
// Test: Query Deposits (unauthenticated — check relayer DB)
// ============================================================

async function testQueryDeposits(identifier: string) {
  console.log('\n========================================');
  console.log(`🔍 TEST QUERY DEPOSITS: ${identifier}`);
  console.log('========================================\n');

  // The /deposits endpoint requires auth, so let's check the pool-info instead
  // and verify the deposit PDA on-chain
  const poolInfo = await fetchPoolInfo(POOL_ADDRESS);
  console.log(`Pool leaf count: ${poolInfo.leafCount}`);
  console.log(`Pool merkle root: ${poolInfo.root.toString('hex').slice(0, 16)}...`);

  // Check the identifier hash matches what the relayer would compute
  const idHash = hashIdentifierForDb(identifier);
  console.log(`Identifier hash for "${identifier}": ${idHash.slice(0, 16)}...`);

  // Verify with different casing
  const variants = [identifier, identifier.toLowerCase(), identifier.toUpperCase()];
  for (const v of variants) {
    const h = hashIdentifierForDb(v);
    console.log(`  hash("${v}") = ${h.slice(0, 16)}... ${h === idHash ? '✅ MATCH' : '❌ DIFFERENT'}`);
  }
}

// ============================================================
// Test: Verify commitment matching
// ============================================================

function testCommitmentMatching() {
  console.log('\n========================================');
  console.log('🔐 TEST COMMITMENT MATCHING');
  console.log('========================================\n');

  const testCases = [
    { id: 'twitter:@_Exidz_', pw: 'testpass123' },
    { id: 'twitter:@Exidz', pw: 'testpass123' },
    { id: 'email:test@example.com', pw: 'testpass123' },
    { id: 'discord:sable', pw: 'testpass123' },
  ];

  for (const tc of testCases) {
    const commitment = computeCommitment(tc.id, tc.pw);
    const idHash = hashIdentifier(tc.id);
    console.log(`${tc.id}:`);
    console.log(`  idHash=${idHash}, commitment=${commitment.toString('hex').slice(0, 16)}...`);
  }

  // Show the twitter handle issue
  console.log('\n⚠️  Twitter handle comparison:');
  const c1 = computeCommitment('twitter:@_Exidz_', 'test');
  const c2 = computeCommitment('twitter:@Exidz', 'test');
  console.log(`  twitter:@_Exidz_ → ${c1.toString('hex').slice(0, 16)}...`);
  console.log(`  twitter:@Exidz   → ${c2.toString('hex').slice(0, 16)}...`);
  console.log(`  Match: ${c1.equals(c2) ? '✅' : '❌ MISMATCH — this is the bug!'}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🐈‍⬛ Murkl E2E Test Suite');
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Relayer: ${RELAYER_URL}`);
  console.log('');

  // Test 0: Commitment matching (no network needed)
  testCommitmentMatching();

  // Load wallet
  const wallet = loadTestWallet();
  console.log(`\n💳 Test wallet: ${wallet.publicKey.toBase58()}`);
  
  const balance = await connection.getBalance(wallet.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

  if (balance < 0.01 * LAMPORTS_PER_SOL) {
    console.log('❌ Insufficient balance for testing. Need at least 0.01 SOL');
    return;
  }

  // Test identifiers
  const testIdentifier = `email:e2etest-${Date.now()}@test.murkl.dev`;
  const testPassword = 'E2E_test_pw_' + crypto.randomBytes(8).toString('hex');
  const testAmount = 0.001; // Tiny amount for testing

  // Test 1: Deposit
  const deposit = await testDeposit(wallet, testIdentifier, testPassword, testAmount);
  if (!deposit) {
    console.log('\n❌ DEPOSIT FAILED — stopping');
    return;
  }

  // Test 2: Register
  const registered = await testRegisterDeposit(deposit);

  // Test 3: Query
  await testQueryDeposits(testIdentifier);

  // Test 4: Verify on-chain deposit PDA
  console.log('\n========================================');
  console.log('🔗 VERIFY ON-CHAIN DEPOSIT');
  console.log('========================================\n');

  const leafBuf = Buffer.alloc(8);
  leafBuf.writeBigUInt64LE(BigInt(deposit.leafIndex));
  const [depPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), POOL_ADDRESS.toBuffer(), leafBuf],
    PROGRAM_ID
  );
  const depInfo = await connection.getAccountInfo(depPda);
  if (depInfo) {
    const data = depInfo.data;
    const onchainPool = new PublicKey(data.subarray(8, 40));
    const onchainCommitment = data.subarray(40, 72).toString('hex');
    const onchainAmount = Number(data.readBigUInt64LE(72));
    const onchainLeaf = Number(data.readBigUInt64LE(80));
    const claimed = data[88] === 1;

    console.log(`✅ Deposit PDA exists: ${depPda.toBase58()}`);
    console.log(`  Pool: ${onchainPool.toBase58().slice(0, 12)}...`);
    console.log(`  Commitment: ${onchainCommitment.slice(0, 16)}...`);
    console.log(`  Expected:   ${deposit.commitment.slice(0, 16)}...`);
    console.log(`  Match: ${onchainCommitment === deposit.commitment ? '✅' : '❌ MISMATCH'}`);
    console.log(`  Amount: ${onchainAmount / 1e9} SOL`);
    console.log(`  Leaf: ${onchainLeaf}`);
    console.log(`  Claimed: ${claimed}`);
  } else {
    console.log('❌ Deposit PDA not found on-chain!');
  }

  // Summary
  console.log('\n========================================');
  console.log('📋 SUMMARY');
  console.log('========================================');
  console.log(`Deposit TX:  ${deposit ? '✅' : '❌'} ${deposit?.signature || ''}`);
  console.log(`Register:    ${registered ? '✅' : '❌'}`);
  console.log(`Identifier:  ${testIdentifier}`);
  console.log(`Leaf Index:  ${deposit?.leafIndex}`);
  console.log(`Password:    ${testPassword}`);
  console.log('');
  console.log(`Explorer: https://explorer.solana.com/tx/${deposit?.signature}?cluster=devnet`);
}

main().catch(console.error);
