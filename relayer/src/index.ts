/**
 * Murkl Relayer API - Production Ready
 * 
 * Security hardening:
 * - Rate limiting (IP-based + global)
 * - Input validation & sanitization
 * - Helmet security headers
 * - Request timeout handling
 * - Structured logging
 * - Graceful shutdown
 * - Environment validation
 * - Nonce tracking to prevent replay
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID, 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Configuration & Validation
// ============================================================================

interface Config {
  port: number;
  rpcUrl: string;
  programId: PublicKey;
  maxFeeBps: number;
  chunkSize: number;
  corsOrigins: string[];
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  claimRateLimitMaxRequests: number;
  requestTimeoutMs: number;
}

function loadConfig(): Config {
  const programId = process.env.PROGRAM_ID || '74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92';
  
  // Validate program ID format
  try {
    new PublicKey(programId);
  } catch {
    console.error('❌ Invalid PROGRAM_ID');
    process.exit(1);
  }
  
  const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://localhost:3001', 'https://murkl.app'];
  
  return {
    port: parseInt(process.env.PORT || '3001', 10),
    rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8899',
    programId: new PublicKey(programId),
    maxFeeBps: 100,
    chunkSize: 900,
    corsOrigins,
    rateLimitWindowMs: 60 * 1000, // 1 minute
    rateLimitMaxRequests: 100,    // 100 requests per minute (general)
    claimRateLimitMaxRequests: 10, // 10 claims per minute per IP
    requestTimeoutMs: 120_000,    // 2 minutes for claim operations
  };
}

const config = loadConfig();

// ============================================================================
// Logging
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    level,
    message,
    ...meta
  };
  
  // In production, send to logging service
  if (process.env.NODE_ENV === 'production') {
    console.log(JSON.stringify(entry));
  } else {
    const emoji = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }[level];
    console.log(`${emoji} [${timestamp}] ${message}`, meta || '');
  }
}

// ============================================================================
// Input Validation
// ============================================================================

const HEX_REGEX = /^(0x)?[0-9a-fA-F]+$/;
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isValidHex(value: unknown, minBytes = 1, maxBytes = 8192): boolean {
  if (typeof value !== 'string') return false;
  if (!HEX_REGEX.test(value)) return false;
  const hex = value.replace('0x', '');
  const bytes = hex.length / 2;
  return bytes >= minBytes && bytes <= maxBytes;
}

function isValidBase58(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!BASE58_REGEX.test(value)) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function isValidFeeBps(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  return Number.isInteger(value) && value >= 0 && value <= config.maxFeeBps;
}

function isValidLeafIndex(value: unknown): boolean {
  if (typeof value !== 'number') return false;
  return Number.isInteger(value) && value >= 0 && value < 2 ** 32;
}

function sanitizeHex(hex: string): Buffer {
  return Buffer.from(hex.replace('0x', ''), 'hex');
}

// ============================================================================
// Relayer Setup
// ============================================================================

const RELAYER_KEYPAIR_PATH = process.env.RELAYER_KEYPAIR || 
  path.join(process.env.HOME || '', '.config/solana/id.json');

let relayerKeypair: Keypair;
try {
  const secretKey = JSON.parse(fs.readFileSync(RELAYER_KEYPAIR_PATH, 'utf-8'));
  relayerKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
  log('info', 'Relayer keypair loaded', { 
    pubkey: relayerKeypair.publicKey.toBase58().slice(0, 8) + '...' 
  });
} catch (e) {
  log('error', 'Failed to load relayer keypair', { path: RELAYER_KEYPAIR_PATH });
  process.exit(1);
}

const connection = new Connection(config.rpcUrl, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: config.requestTimeoutMs,
});

// ============================================================================
// Nonce Tracking (replay protection)
// ============================================================================

const processedNullifiers = new Set<string>();
const NULLIFIER_CACHE_MAX = 10000;

function trackNullifier(nullifier: string): boolean {
  if (processedNullifiers.has(nullifier)) {
    return false; // Already processed
  }
  
  // Evict oldest if at capacity (simple FIFO)
  if (processedNullifiers.size >= NULLIFIER_CACHE_MAX) {
    const first = processedNullifiers.values().next().value as string | undefined;
    if (first) processedNullifiers.delete(first);
  }
  
  processedNullifiers.add(nullifier);
  return true;
}

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"], // Required for WASM
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", config.rpcUrl],
    }
  },
  crossOriginEmbedderPolicy: false, // Required for WASM
}));

// CORS with whitelist
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.) in dev
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    if (!origin || config.corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      log('warn', 'CORS blocked', { origin });
      callback(new Error('CORS not allowed'));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  maxAge: 86400, // 24 hours
}));

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMaxRequests,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

// Strict rate limiter for claims
const claimLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.claimRateLimitMaxRequests,
  message: { error: 'Too many claim requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

app.use(generalLimiter);
app.use(express.json({ limit: '50kb' })); // Reduced from 1mb

// Request timeout middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setTimeout(config.requestTimeoutMs, () => {
    log('warn', 'Request timeout', { path: req.path, ip: req.ip });
    res.status(408).json({ error: 'Request timeout' });
  });
  next();
});

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') { // Skip health check spam
      log('info', 'Request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip?.slice(0, 20),
      });
    }
  });
  next();
});

// Serve frontend (static files)
const distPath = path.join(__dirname, '../..', 'web', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath, {
    maxAge: '1d',
    etag: true,
  }));
}

// ============================================================================
// Anchor Helpers
// ============================================================================

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ============================================================================
// API Routes
// ============================================================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

app.get('/info', async (_req: Request, res: Response) => {
  try {
    const balance = await connection.getBalance(relayerKeypair.publicKey);
    res.json({
      relayer: relayerKeypair.publicKey.toBase58(),
      balance: balance / LAMPORTS_PER_SOL,
      program: config.programId.toBase58(),
      maxFeeBps: config.maxFeeBps,
      version: '1.0.0',
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    log('error', 'Info endpoint error', { error: message });
    res.status(500).json({ error: 'Service temporarily unavailable' });
  }
});

/**
 * Submit a claim (multi-step chunked upload)
 */
app.post('/claim', claimLimiter, async (req: Request, res: Response) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  
  try {
    const {
      proof,
      commitment,
      nullifier,
      leafIndex,
      recipientTokenAccount,
      poolAddress,
      feeBps = 50
    } = req.body;
    
    // ========================================
    // Input Validation
    // ========================================
    
    const errors: string[] = [];
    
    if (!isValidHex(proof, 100, 8192)) {
      errors.push('Invalid proof format');
    }
    if (!isValidHex(commitment, 32, 32)) {
      errors.push('Invalid commitment format');
    }
    if (!isValidHex(nullifier, 32, 32)) {
      errors.push('Invalid nullifier format');
    }
    if (!isValidBase58(recipientTokenAccount)) {
      errors.push('Invalid recipient address');
    }
    if (!isValidBase58(poolAddress)) {
      errors.push('Invalid pool address');
    }
    if (!isValidFeeBps(feeBps)) {
      errors.push(`Invalid fee (max ${config.maxFeeBps} bps)`);
    }
    if (leafIndex === undefined || !isValidLeafIndex(leafIndex)) {
      errors.push('Invalid leaf index');
    }
    
    if (errors.length > 0) {
      log('warn', 'Claim validation failed', { requestId, errors });
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    
    // Check for replay attack
    if (!trackNullifier(nullifier)) {
      log('warn', 'Duplicate nullifier submission', { requestId });
      return res.status(400).json({ error: 'Claim already submitted' });
    }
    
    log('info', 'Processing claim', {
      requestId,
      commitment: commitment.slice(0, 16) + '...',
      recipient: recipientTokenAccount.slice(0, 8) + '...',
    });
    
    // ========================================
    // Parse & Validate Addresses
    // ========================================
    
    const proofBytes = sanitizeHex(proof);
    const commitment32 = Buffer.alloc(32);
    const nullifier32 = Buffer.alloc(32);
    sanitizeHex(commitment).slice(0, 32).copy(commitment32);
    sanitizeHex(nullifier).slice(0, 32).copy(nullifier32);
    
    const pool = new PublicKey(poolAddress);
    const recipient = new PublicKey(recipientTokenAccount);
    
    // Derive deposit PDA from pool + leafIndex
    const leafIndexBuffer = Buffer.alloc(4);
    leafIndexBuffer.writeUInt32LE(leafIndex);
    const [depositPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('deposit'), pool.toBuffer(), leafIndexBuffer],
      config.programId
    );
    const deposit = depositPda;
    
    log('info', 'Derived deposit PDA', { requestId, depositPda: depositPda.toBase58(), leafIndex });
    
    // Derive PDAs
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), pool.toBuffer()],
      config.programId
    );
    
    const [proofBufferPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('proof'), relayerKeypair.publicKey.toBuffer(), commitment32.slice(0, 8)],
      config.programId
    );
    
    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), pool.toBuffer(), nullifier32],
      config.programId
    );
    
    // ========================================
    // Check on-chain nullifier status
    // ========================================
    
    const nullifierAccount = await connection.getAccountInfo(nullifierPda);
    if (nullifierAccount) {
      log('warn', 'Nullifier already used on-chain', { requestId });
      return res.status(400).json({ error: 'Funds already claimed' });
    }
    
    // ========================================
    // Step 1: Check Proof Buffer Status
    // ========================================
    
    const existingBuffer = await connection.getAccountInfo(proofBufferPda);
    let bufferFinalized = false;
    let numChunks = Math.ceil(proofBytes.length / config.chunkSize);
    
    if (existingBuffer) {
      const finalizedByte = existingBuffer.data[8 + 32 + 32 + 32 + 4 + 4];
      bufferFinalized = finalizedByte === 1;
      
      if (bufferFinalized) {
        log('info', 'Buffer already finalized', { requestId });
      }
    } else {
      // Create buffer
      const createData = Buffer.concat([
        getDiscriminator('create_proof_buffer'),
        commitment32,
        nullifier32,
        Buffer.from(new Uint32Array([proofBytes.length]).buffer),
      ]);
      
      const createIx = new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: proofBufferPda, isSigner: false, isWritable: true },
          { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: createData,
      });
      
      const createTx = new Transaction().add(createIx);
      createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      createTx.feePayer = relayerKeypair.publicKey;
      
      await sendAndConfirmTransaction(connection, createTx, [relayerKeypair]);
      log('info', 'Buffer created', { requestId });
    }
    
    // ========================================
    // Step 2: Write Proof Chunks
    // ========================================
    
    if (!bufferFinalized) {
      for (let i = 0; i < numChunks; i++) {
        const offset = i * config.chunkSize;
        const chunk = proofBytes.slice(offset, offset + config.chunkSize);
        
        const writeData = Buffer.concat([
          getDiscriminator('write_proof_chunk'),
          Buffer.from(new Uint32Array([offset]).buffer),
          Buffer.from(new Uint32Array([chunk.length]).buffer),
          chunk,
        ]);
        
        const writeIx = new TransactionInstruction({
          programId: config.programId,
          keys: [
            { pubkey: proofBufferPda, isSigner: false, isWritable: true },
            { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
          ],
          data: writeData,
        });
        
        const writeTx = new Transaction().add(writeIx);
        writeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        writeTx.feePayer = relayerKeypair.publicKey;
        
        await sendAndConfirmTransaction(connection, writeTx, [relayerKeypair]);
      }
      
      log('info', 'Chunks written', { requestId, numChunks });
      
      // ========================================
      // Step 3: Finalize Buffer
      // ========================================
      
      const finalizeData = getDiscriminator('finalize_proof_buffer');
      
      const finalizeIx = new TransactionInstruction({
        programId: config.programId,
        keys: [
          { pubkey: proofBufferPda, isSigner: false, isWritable: true },
          { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
        ],
        data: finalizeData,
      });
      
      const finalizeTx = new Transaction().add(finalizeIx);
      finalizeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      finalizeTx.feePayer = relayerKeypair.publicKey;
      
      await sendAndConfirmTransaction(connection, finalizeTx, [relayerKeypair]);
      log('info', 'Buffer finalized', { requestId });
    }
    
    // ========================================
    // Step 4: Prepare ATA & Claim
    // ========================================
    
    const poolInfo = await connection.getAccountInfo(pool);
    if (!poolInfo) {
      return res.status(400).json({ error: 'Pool not found' });
    }
    
    const tokenMint = new PublicKey(poolInfo.data.slice(8 + 32, 8 + 32 + 32));
    const recipientWallet = recipient;
    const recipientAta = await getAssociatedTokenAddress(tokenMint, recipientWallet);
    
    const ataInfo = await connection.getAccountInfo(recipientAta);
    const claimTx = new Transaction();
    
    if (!ataInfo) {
      claimTx.add(
        createAssociatedTokenAccountInstruction(
          relayerKeypair.publicKey,
          recipientAta,
          recipientWallet,
          tokenMint
        )
      );
    }
    
    const relayerAta = await getAssociatedTokenAddress(tokenMint, relayerKeypair.publicKey);
    const relayerAtaInfo = await connection.getAccountInfo(relayerAta);
    
    if (!relayerAtaInfo) {
      claimTx.add(
        createAssociatedTokenAccountInstruction(
          relayerKeypair.publicKey,
          relayerAta,
          relayerKeypair.publicKey,
          tokenMint
        )
      );
    }
    
    // Claim instruction
    const claimData = Buffer.concat([
      getDiscriminator('claim'),
      Buffer.from(new Uint16Array([feeBps]).buffer),
    ]);
    
    const claimIx = new TransactionInstruction({
      programId: config.programId,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: true },
        { pubkey: deposit, isSigner: false, isWritable: true },
        { pubkey: proofBufferPda, isSigner: false, isWritable: false },
        { pubkey: nullifierPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: recipientAta, isSigner: false, isWritable: true },
        { pubkey: relayerAta, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: claimData,
    });
    
    claimTx.add(claimIx);
    claimTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    claimTx.feePayer = relayerKeypair.publicKey;
    
    // Simulate first
    const simResult = await connection.simulateTransaction(claimTx, [relayerKeypair]);
    if (simResult.value.err) {
      log('error', 'Claim simulation failed', { 
        requestId, 
        error: JSON.stringify(simResult.value.err),
      });
      return res.status(400).json({ 
        error: 'Claim verification failed',
        code: 'VERIFICATION_FAILED',
      });
    }
    
    const claimSig = await sendAndConfirmTransaction(connection, claimTx, [relayerKeypair]);
    
    log('info', 'Claim successful', {
      requestId,
      signature: claimSig,
      computeUnits: simResult.value.unitsConsumed,
    });
    
    res.json({
      success: true,
      signature: claimSig,
      chunksWritten: numChunks,
      computeUnits: simResult.value.unitsConsumed,
    });
    
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    log('error', 'Claim error', { requestId, error: message });
    
    // Don't leak internal error details
    if (message.includes('insufficient funds')) {
      res.status(503).json({ error: 'Relayer temporarily unavailable' });
    } else {
      res.status(500).json({ error: 'Internal error' });
    }
  }
});

app.get('/pool/:address', async (req: Request, res: Response) => {
  try {
    if (!isValidBase58(req.params.address)) {
      return res.status(400).json({ error: 'Invalid address' });
    }
    
    const pool = new PublicKey(req.params.address);
    const accountInfo = await connection.getAccountInfo(pool);
    if (!accountInfo) return res.status(404).json({ error: 'Pool not found' });
    
    res.json({
      address: pool.toBase58(),
      owner: accountInfo.owner.toBase58(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal error' });
  }
});

app.get('/nullifier/:pool/:nullifier', async (req: Request, res: Response) => {
  try {
    if (!isValidBase58(req.params.pool) || !isValidHex(req.params.nullifier, 32, 32)) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    const pool = new PublicKey(req.params.pool);
    const nullifierHex = req.params.nullifier as string;
    const nullifierBytes = sanitizeHex(nullifierHex);
    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), pool.toBuffer(), nullifierBytes],
      config.programId
    );
    const accountInfo = await connection.getAccountInfo(nullifierPda);
    
    res.json({
      pda: nullifierPda.toBase58(),
      used: accountInfo !== null
    });
  } catch (e: unknown) {
    res.status(500).json({ error: 'Internal error' });
  }
});

// Fallback for SPA routing
app.get('*', (req: Request, res: Response) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  log('error', 'Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal error' });
});

// ============================================================================
// Server & Graceful Shutdown
// ============================================================================

const server = app.listen(config.port, () => {
  log('info', 'Murkl Relayer started', {
    port: config.port,
    program: config.programId.toBase58(),
    rpc: config.rpcUrl,
    nodeEnv: process.env.NODE_ENV || 'development',
  });
});

// Graceful shutdown
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  
  log('info', `Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    log('info', 'HTTP server closed');
    process.exit(0);
  });
  
  // Force exit after 10s
  setTimeout(() => {
    log('warn', 'Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  log('error', 'Uncaught exception', { error: err.message, stack: err.stack });
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled rejection', { reason: String(reason) });
});
