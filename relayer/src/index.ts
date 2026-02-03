/**
 * Murkl Relayer API
 * 
 * Accepts STARK proofs and submits claim transactions on behalf of users.
 * The recipient never signs anything - full privacy!
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// Config
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8899';
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || '74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92');
const MAX_FEE_BPS = 100; // 1% max fee

// Load relayer keypair
const RELAYER_KEYPAIR_PATH = process.env.RELAYER_KEYPAIR || 
  path.join(process.env.HOME || '', '.config/solana/id.json');

let relayerKeypair: Keypair;
try {
  const secretKey = JSON.parse(fs.readFileSync(RELAYER_KEYPAIR_PATH, 'utf-8'));
  relayerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
  console.log(`🔑 Relayer: ${relayerKeypair.publicKey.toBase58()}`);
} catch (e) {
  console.error('Failed to load relayer keypair:', e);
  process.exit(1);
}

const connection = new Connection(RPC_URL, 'confirmed');
const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ============================================================================
// API Routes
// ============================================================================

/**
 * Health check
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    relayer: relayerKeypair.publicKey.toBase58(),
    program: PROGRAM_ID.toBase58(),
    rpc: RPC_URL
  });
});

/**
 * Get relayer info
 */
app.get('/info', async (req: Request, res: Response) => {
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    
    res.json({
      relayer: relayerKeypair.publicKey.toBase58(),
      balance: balance / LAMPORTS_PER_SOL,
      program: PROGRAM_ID.toBase58(),
      maxFeeBps: MAX_FEE_BPS,
      rpc: RPC_URL
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Submit a claim
 * 
 * Body:
 * - proof: hex-encoded STARK proof
 * - commitment: hex-encoded commitment (32 bytes)
 * - nullifier: hex-encoded nullifier (32 bytes)
 * - leafIndex: number
 * - merkleProof: array of hex-encoded nodes
 * - recipientTokenAccount: recipient's token account address
 * - poolAddress: pool address
 * - depositAddress: deposit account address
 * - feeBps: relayer fee in basis points (0-100)
 */
app.post('/claim', async (req: Request, res: Response) => {
  try {
    const {
      proof,
      commitment,
      nullifier,
      leafIndex,
      merkleProof = [],
      recipientTokenAccount,
      poolAddress,
      depositAddress,
      feeBps = 50 // Default 0.5% fee
    } = req.body;
    
    // Validate inputs
    if (!proof || !commitment || !nullifier || !recipientTokenAccount || !poolAddress || !depositAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    if (feeBps > MAX_FEE_BPS) {
      return res.status(400).json({ error: `Fee too high, max ${MAX_FEE_BPS} bps` });
    }
    
    console.log(`\n📥 Claim request:`);
    console.log(`   Commitment: ${commitment.slice(0, 16)}...`);
    console.log(`   Nullifier: ${nullifier.slice(0, 16)}...`);
    console.log(`   Leaf index: ${leafIndex}`);
    console.log(`   Recipient: ${recipientTokenAccount}`);
    console.log(`   Fee: ${feeBps} bps`);
    
    // Parse addresses
    const pool = new PublicKey(poolAddress);
    const deposit = new PublicKey(depositAddress);
    const recipient = new PublicKey(recipientTokenAccount);
    
    // Derive PDAs
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), pool.toBuffer()],
      PROGRAM_ID
    );
    
    const nullifierBytes = Buffer.from(nullifier.replace('0x', ''), 'hex');
    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), pool.toBuffer(), nullifierBytes],
      PROGRAM_ID
    );
    
    // Get relayer token account (for fee)
    // For simplicity, use recipient as relayer token account (no fee case)
    // In production, create relayer's ATA
    const relayerTokenAccount = recipient;
    
    // Build instruction data
    // Anchor discriminator for claim
    const discriminator = Buffer.from([
      0x3e, 0xc6, 0xd6, 0xc1, 0xd5, 0x9b, 0x00, 0x00 // claim discriminator (placeholder)
    ]);
    
    // Serialize proof data
    const proofBytes = Buffer.from(proof.replace('0x', ''), 'hex');
    const commitmentBytes = Buffer.from(commitment.replace('0x', ''), 'hex');
    const merkleProofBuffers = merkleProof.map((p: string) => 
      Buffer.from(p.replace('0x', ''), 'hex')
    );
    
    // Build instruction
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: deposit, isSigner: false, isWritable: true },
        { pubkey: nullifierPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: recipient, isSigner: false, isWritable: true },
        { pubkey: relayerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        discriminator,
        // proof_data length (u32) + data
        Buffer.from(new Uint32Array([proofBytes.length]).buffer),
        proofBytes,
        // commitment
        commitmentBytes,
        // nullifier  
        nullifierBytes,
        // leaf_index
        Buffer.from(new Uint32Array([leafIndex]).buffer),
        // merkle_proof length + data
        Buffer.from(new Uint32Array([merkleProofBuffers.length]).buffer),
        ...merkleProofBuffers,
        // relayer_fee_bps
        Buffer.from(new Uint16Array([feeBps]).buffer),
      ])
    });
    
    // Build transaction
    const tx = new Transaction().add(ix);
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    tx.feePayer = relayerKeypair.publicKey;
    
    // Simulate first
    console.log(`   Simulating...`);
    const simResult = await connection.simulateTransaction(tx, [relayerKeypair]);
    
    if (simResult.value.err) {
      console.log(`   ❌ Simulation failed:`, simResult.value.err);
      return res.status(400).json({ 
        error: 'Simulation failed',
        details: simResult.value.err,
        logs: simResult.value.logs
      });
    }
    
    console.log(`   ✅ Simulation passed, CU: ${simResult.value.unitsConsumed}`);
    
    // Send transaction
    console.log(`   Sending transaction...`);
    const signature = await sendAndConfirmTransaction(connection, tx, [relayerKeypair]);
    
    console.log(`   ✅ Confirmed: ${signature}`);
    
    res.json({
      success: true,
      signature,
      computeUnits: simResult.value.unitsConsumed,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`
    });
    
  } catch (e: any) {
    console.error('Claim error:', e);
    res.status(500).json({ 
      error: e.message,
      logs: e.logs 
    });
  }
});

/**
 * Get pool info
 */
app.get('/pool/:address', async (req: Request, res: Response) => {
  try {
    const pool = new PublicKey(req.params.address);
    const accountInfo = await connection.getAccountInfo(pool);
    
    if (!accountInfo) {
      return res.status(404).json({ error: 'Pool not found' });
    }
    
    // Decode pool data (simplified)
    const data = accountInfo.data;
    
    res.json({
      address: pool.toBase58(),
      owner: accountInfo.owner.toBase58(),
      lamports: accountInfo.lamports,
      dataLength: data.length
    });
    
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * Check if nullifier is used
 */
app.get('/nullifier/:pool/:nullifier', async (req: Request, res: Response) => {
  try {
    const pool = new PublicKey(req.params.pool);
    const nullifierBytes = Buffer.from(req.params.nullifier.replace('0x', ''), 'hex');
    
    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), pool.toBuffer(), nullifierBytes],
      PROGRAM_ID
    );
    
    const accountInfo = await connection.getAccountInfo(nullifierPda);
    
    res.json({
      nullifier: req.params.nullifier,
      used: accountInfo !== null,
      pda: nullifierPda.toBase58()
    });
    
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================================
// Start Server
// ============================================================================

app.listen(PORT, () => {
  console.log(`\n🐈‍⬛ Murkl Relayer API`);
  console.log(`   Port: ${PORT}`);
  console.log(`   RPC: ${RPC_URL}`);
  console.log(`   Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`   Relayer: ${relayerKeypair.publicKey.toBase58()}`);
  console.log(`\n   Endpoints:`);
  console.log(`   GET  /health          - Health check`);
  console.log(`   GET  /info            - Relayer info`);
  console.log(`   POST /claim           - Submit claim`);
  console.log(`   GET  /pool/:address   - Pool info`);
  console.log(`   GET  /nullifier/:pool/:nullifier - Check nullifier`);
  console.log(`\n🚀 Ready!`);
});
