import 'dotenv/config';

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
import bs58 from 'bs58';
import { auth, db, getMurklIdentifier, resend, runAuthMigrations } from './auth';
import { toNodeHandler } from 'better-auth/node';
import { 
  initVoucherTable, 
  createVoucher, 
  redeemVoucher, 
  markVoucherClaimed, 
  getVoucherInfo,
  cleanupOldVouchers,
  isValidVoucherCode,
} from './vouchers';

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

// STARK Verifier program ID
const STARK_VERIFIER_ID = new PublicKey('StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw');

function loadConfig(): Config {
  const programId = process.env.PROGRAM_ID || 'muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF';
  
  // Validate program ID format
  try {
    new PublicKey(programId);
  } catch {
    console.error('❌ Invalid PROGRAM_ID');
    process.exit(1);
  }
  
  const corsOrigins = process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'https://murkl.app', 'https://aimed-beauty-faces-ours.trycloudflare.com'];
  
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
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  // Must be whole bytes. Node's Buffer.from(hex, 'hex') silently truncates odd-length strings.
  if (hex.length % 2 !== 0) return false;
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
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error('Invalid hex (odd length)');
  return Buffer.from(h, 'hex');
}

// ============================================================================
// Relayer Setup
// ============================================================================

// Support keypair from env var (JSON array) or file path
function loadRelayerKeypair(): Keypair {
  // First try RELAYER_SECRET_KEY env var (JSON array of bytes)
  if (process.env.RELAYER_SECRET_KEY) {
    try {
      const secretKey = JSON.parse(process.env.RELAYER_SECRET_KEY);
      return Keypair.fromSecretKey(new Uint8Array(secretKey));
    } catch (e) {
      console.error('Failed to parse RELAYER_SECRET_KEY env var');
      process.exit(1);
    }
  }
  
  // Fall back to file path
  const keypairPath = process.env.RELAYER_KEYPAIR || 
    path.join(process.env.HOME || '', '.config/solana/id.json');
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

let relayerKeypair: Keypair;
try {
  relayerKeypair = loadRelayerKeypair();
  log('info', 'Relayer keypair loaded', { 
    pubkey: relayerKeypair.publicKey.toBase58().slice(0, 8) + '...' 
  });
} catch (e) {
  log('error', 'Failed to load relayer keypair', { error: String(e) });
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

// Trust proxy (Railway/Docker reverse proxy) — required for accurate req.ip in rate limiting
// Must be set BEFORE any middleware that reads req.ip (rate limiting, logging).
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"], // Allow avatars from OAuth providers
      connectSrc: [
        "'self'",
        config.rpcUrl,
        config.rpcUrl.replace('https://', 'wss://'), // WebSocket for tx confirmation
      ],
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
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // Required for Better Auth cookies
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

// Voucher redemption rate limiter — prevents brute-force password attacks
// Very strict: 5 attempts per 15 minutes per IP
const voucherRedeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { error: 'Too many redemption attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
  skipSuccessfulRequests: true, // Only count failed attempts
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
// Better Auth Routes
// ============================================================================

// OTP rate limiting middleware — 1 per 5 minutes per email (server-enforced)
const otpSendTimes = new Map<string, number>();
const OTP_RATE_LIMIT_MS = 5 * 60 * 1000; // 5 minutes

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of otpSendTimes) {
    if (now - ts > OTP_RATE_LIMIT_MS) otpSendTimes.delete(key);
  }
}, 10 * 60 * 1000);

app.post('/api/auth/email-otp/send-verification-otp', (req: Request, res: Response, next: NextFunction) => {
  const email = req.body?.email;
  if (!email) return next();
  
  const key = email.toLowerCase().trim();
  const lastSent = otpSendTimes.get(key);
  
  if (lastSent) {
    const elapsed = Date.now() - lastSent;
    if (elapsed < OTP_RATE_LIMIT_MS) {
      const remaining = Math.ceil((OTP_RATE_LIMIT_MS - elapsed) / 1000);
      log('info', 'OTP rate limited', { email: key, remainingSeconds: remaining });
      return res.status(429).json({
        error: `Please wait ${Math.ceil(remaining / 60)} minute(s) before requesting a new code`,
        retryAfter: remaining,
      });
    }
  }
  
  otpSendTimes.set(key, Date.now());
  next();
});

// Mount Better Auth handler
app.all('/api/auth/*', toNodeHandler(auth));

// Get current user's linked identities
// Returns ALL linked accounts so the frontend can offer a picker
app.get('/api/me', async (req: Request, res: Response) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers as Record<string, string>,
    });
    
    if (!session?.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Get all linked accounts
    const accounts = await auth.api.listUserAccounts({
      headers: req.headers as Record<string, string>,
    });
    
    // Build all identities from linked accounts
    const identities: { provider: string; identifier: string; label: string }[] = [];
    const seen = new Set<string>();
    
    if (accounts && Array.isArray(accounts)) {
      for (const account of accounts) {
        const providerId = (account as any).providerId || 'unknown';
        const identifier = getMurklIdentifier(session.user, providerId);
        
        // Deduplicate
        if (!seen.has(identifier)) {
          seen.add(identifier);
          
          let label = identifier;
          if (providerId === 'twitter') label = `𝕏 ${identifier}`;
          else if (providerId === 'discord') label = `Discord ${identifier.replace('discord:', '')}`;
          else if (providerId === 'email-otp' || providerId === 'email' || providerId === 'credential') label = `✉️ ${identifier.replace('email:', '')}`;
          
          identities.push({ provider: providerId, identifier, label });
        }
      }
    }
    
    // If user has email and no email-based account was found, add it
    if (session.user.email && !identities.some(i => i.identifier.startsWith('email:'))) {
      const emailId = `email:${session.user.email}`;
      identities.push({ provider: 'email', identifier: emailId, label: `✉️ ${session.user.email}` });
    }
    
    res.json({
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      },
      identities,
      // Legacy: first identity for backwards compat
      provider: identities[0]?.provider || 'unknown',
      murklIdentifier: identities[0]?.identifier || '',
    });
  } catch (e: unknown) {
    log('error', 'Get user failed', { error: String(e) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================================
// Anchor Helpers
// ============================================================================

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

function readU64LE(buf: Buffer, offset: number): bigint {
  if (offset + 8 > buf.length) throw new Error('readU64LE out of bounds');
  return buf.readBigUInt64LE(offset);
}

function u64ToSafeNumber(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JS safe integer range`);
  }
  return Number(value);
}

/**
 * Verify that a user-submitted txSignature really performed a Murkl `deposit` into the
 * expected pool + leafIndex + commitment + amount.
 *
 * Threat model:
 * - Prevent authenticated attackers from registering fake deposits for other identities
 *   (and triggering notification emails / voucher creation).
 * - Prevent poisoning the local deposit index DB with arbitrary entries.
 */
async function verifyDepositTx(params: {
  txSignature: string;
  pool: PublicKey;
  leafIndex: number;
  /** Human amount in token units (e.g. 0.01 SOL). */
  amount: number;
  commitmentHex: string;
}): Promise<{ depositAccount: PublicKey }> {
  const { txSignature, pool, leafIndex, amount, commitmentHex } = params;

  // On-chain deposit stores amounts in base units (lamports for SOL/WSOL).
  // Our API uses human units for UX, so convert for verification.
  const amountBaseUnits = Math.round(amount * 1e9);
  if (!Number.isFinite(amountBaseUnits) || amountBaseUnits <= 0) {
    throw new Error('Invalid amount (base units)');
  }

  const commitmentBuf = sanitizeHex(commitmentHex);
  if (commitmentBuf.length !== 32) throw new Error('Invalid commitment length');

  // Expected PDA for the deposit record, derived from leafIndex (u64 LE)
  const leafIndexBuf = Buffer.alloc(8);
  leafIndexBuf.writeBigUInt64LE(BigInt(leafIndex));
  const [expectedDepositPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('deposit'), pool.toBuffer(), leafIndexBuf],
    config.programId
  );

  // Use parsed tx for a consistent instruction shape (base58 `data` + `accounts`).
  const tx = await connection.getParsedTransaction(txSignature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  } as any);

  if (!tx) throw new Error('Transaction not found');
  if (tx.meta?.err) throw new Error('Transaction failed');

  type AnyIx = any;
  const allIxs: AnyIx[] = [];

  // Top-level instructions
  for (const ix of (tx.transaction.message.instructions || [])) {
    allIxs.push(ix as AnyIx);
  }

  // Inner instructions
  const inner = (tx.meta as any)?.innerInstructions as Array<any> | undefined;
  if (inner) {
    for (const innerIx of inner) {
      for (const ix of innerIx.instructions || []) {
        allIxs.push(ix as AnyIx);
      }
    }
  }

  const depositDisc = getDiscriminator('deposit');
  let matched = false;

  for (const ix of allIxs) {
    // We care about PartiallyDecodedInstruction: { programId, accounts, data }
    const programId: PublicKey | undefined = ix?.programId;
    const accounts: PublicKey[] | undefined = ix?.accounts;
    const data: string | undefined = ix?.data;

    if (!programId || !programId.equals(config.programId)) continue;
    if (!accounts || accounts.length < 2) continue;
    if (!data || typeof data !== 'string') continue;

    let dataBuf: Buffer;
    try {
      dataBuf = Buffer.from(bs58.decode(data));
    } catch {
      // Not base58 (or not a raw instruction) — skip
      continue;
    }

    if (dataBuf.length < 8 + 8 + 32) continue;
    if (!dataBuf.subarray(0, 8).equals(depositDisc)) continue;

    // Anchor args: amount: u64 (base units), commitment: [u8; 32]
    const ixAmount = u64ToSafeNumber(readU64LE(dataBuf, 8), 'ixAmount');
    const ixCommitment = dataBuf.subarray(16, 48);

    if (ixAmount !== amountBaseUnits) continue;
    if (!ixCommitment.equals(commitmentBuf)) continue;

    // Accounts: [pool, deposit, vault, depositor, depositor_token, token_program, system_program]
    const ixPool = accounts[0];
    const ixDeposit = accounts[1];
    if (!ixPool?.equals(pool)) continue;
    if (!ixDeposit?.equals(expectedDepositPda)) continue;

    matched = true;
    break;
  }

  if (!matched) {
    throw new Error('txSignature does not match expected Murkl deposit');
  }

  // Verify deposit account exists and has the expected leafIndex & commitment.
  const depInfo = await connection.getAccountInfo(expectedDepositPda, 'confirmed');
  if (!depInfo) throw new Error('Deposit account not found');
  if (!depInfo.owner.equals(config.programId)) throw new Error('Deposit account owner mismatch');

  // Anchor account layout: 8 disc + pool(32) + commitment(32) + amount(8) + leaf_index(8) + claimed(1) + bump(1)
  const data = Buffer.from(depInfo.data);
  if (data.length < 8 + 32 + 32 + 8 + 8) throw new Error('Deposit account too small');

  const onchainPool = new PublicKey(data.subarray(8, 40));
  const onchainCommitment = data.subarray(40, 72);
  const onchainAmount = u64ToSafeNumber(readU64LE(data, 72), 'onchainAmount');
  const onchainLeafIndex = u64ToSafeNumber(readU64LE(data, 80), 'onchainLeafIndex');

  if (!onchainPool.equals(pool)) throw new Error('On-chain deposit pool mismatch');
  if (!onchainCommitment.equals(commitmentBuf)) throw new Error('On-chain deposit commitment mismatch');
  if (onchainAmount !== amountBaseUnits) throw new Error('On-chain deposit amount mismatch');
  if (onchainLeafIndex !== leafIndex) throw new Error('On-chain deposit leafIndex mismatch');

  return { depositAccount: expectedDepositPda };
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

// Debug: Verify commitment computation — DEVELOPMENT ONLY
if (process.env.NODE_ENV !== 'production') {
  app.post('/debug/commitment', (req: Request, res: Response) => {
    // @ts-ignore - js-sha3 doesn't have types
    const { keccak256 } = require('js-sha3');
    try {
      const { identifier, password } = req.body;
      if (!identifier || !password) {
        return res.status(400).json({ error: 'identifier and password required' });
      }
      
      const M31_PRIME = 0x7FFFFFFF;
      
      const normalizedId = identifier.toLowerCase();
      const idData = Buffer.concat([Buffer.from('murkl_identifier_v1'), Buffer.from(normalizedId)]);
      const idHash = Buffer.from(keccak256(idData), 'hex');
      const idM31 = idHash.readUInt32LE(0) % M31_PRIME;
      
      const pwData = Buffer.concat([Buffer.from('murkl_password_v1'), Buffer.from(password)]);
      const pwHash = Buffer.from(keccak256(pwData), 'hex');
      const secretM31 = pwHash.readUInt32LE(0) % M31_PRIME;
      
      const idBuf = Buffer.alloc(4);
      const secretBuf = Buffer.alloc(4);
      idBuf.writeUInt32LE(idM31, 0);
      secretBuf.writeUInt32LE(secretM31, 0);
      
      const commitData = Buffer.concat([Buffer.from('murkl_m31_hash_v1'), idBuf, secretBuf]);
      const commitment = keccak256(commitData);
      
      res.json({
        identifier,
        normalizedId,
        idM31,
        secretM31,
        commitment,
      });
    } catch (e: unknown) {
      res.status(500).json({ error: String(e) });
    }
  });
}

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

// Get pool info (merkle root needed for proof generation)
app.get('/pool-info', async (req: Request, res: Response) => {
  try {
    const poolAddress = req.query.pool as string;
    if (!poolAddress) {
      return res.status(400).json({ error: 'pool query param required' });
    }
    
    const pool = new PublicKey(poolAddress);
    const poolInfo = await connection.getAccountInfo(pool);
    
    if (!poolInfo) {
      return res.status(404).json({ error: 'Pool not found' });
    }

    if (!poolInfo.owner.equals(config.programId)) {
      return res.status(400).json({ error: 'Pool account owner mismatch' });
    }

    // Pool layout: [8 discriminator][32 admin][32 token_mint][32 vault][32 merkle_root][8 leaf_count]...
    if (poolInfo.data.length < 8 + 32 + 32 + 32 + 32 + 8) {
      return res.status(400).json({ error: 'Pool account data too small' });
    }

    const merkleRoot = poolInfo.data.slice(104, 136).toString('hex');
    const leafCount = poolInfo.data.readBigUInt64LE(136);
    
    res.json({
      pool: poolAddress,
      merkleRoot,
      leafCount: leafCount.toString(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    log('error', 'Pool info error', { error: message });
    res.status(500).json({ error: 'Failed to fetch pool info' });
  }
});

/**
 * Submit a claim (multi-step chunked upload)
 */
app.post('/claim', claimLimiter, async (req: Request, res: Response) => {
  const requestId = crypto.randomBytes(8).toString('hex');
  let claimNullifier: string | undefined; // Track for cleanup on error
  
  try {
    const {
      proof,
      commitment,
      nullifier,
      merkleRoot,
      leafIndex,
      recipientTokenAccount,
      poolAddress,
      feeBps = 50
    } = req.body;
    
    claimNullifier = nullifier; // Store for error handling
    
    // ========================================
    // Input Validation
    // ========================================
    
    const errors: string[] = [];
    
    if (!isValidHex(proof, 100, 16384)) {
      errors.push('Invalid proof format');
    }
    if (!isValidHex(commitment, 32, 32)) {
      errors.push('Invalid commitment format');
    }
    if (!isValidHex(nullifier, 32, 32)) {
      errors.push('Invalid nullifier format');
    }
    // merkleRoot is optional - fetched from pool if not provided
    if (merkleRoot && !isValidHex(merkleRoot, 32, 32)) {
      errors.push('Invalid merkle root format');
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
    
    const redactHex = (s: string, keep = 8) => {
      if (!s) return s;
      const h = s.startsWith('0x') ? s.slice(2) : s;
      if (h.length <= keep) return h;
      return `${h.slice(0, keep)}...`;
    };

    log('info', 'Processing claim', {
      requestId,
      commitment: redactHex(commitment),
      nullifier: redactHex(nullifier),
      merkleRoot: merkleRoot ? redactHex(merkleRoot) : 'from-pool',
      leafIndex,
      recipient: recipientTokenAccount.slice(0, 8) + '...',
    });
    
    // ========================================
    // Parse & Validate Addresses
    // ========================================
    
    const proofBytes = sanitizeHex(proof);
    log('info', 'Proof size', { requestId, size: proofBytes.length, maxAllowed: 16384 });
    const commitment32 = Buffer.alloc(32);
    const nullifier32 = Buffer.alloc(32);
    sanitizeHex(commitment).slice(0, 32).copy(commitment32);
    sanitizeHex(nullifier).slice(0, 32).copy(nullifier32);
    
    const pool = new PublicKey(poolAddress);
    const recipient = new PublicKey(recipientTokenAccount);
    
    // Fetch pool to get merkle_root (if not provided in request)
    const poolInfo = await connection.getAccountInfo(pool);
    if (!poolInfo) {
      return res.status(400).json({ error: 'Pool not found' });
    }

    if (!poolInfo.owner.equals(config.programId)) {
      return res.status(400).json({ error: 'Pool account owner mismatch' });
    }

    if (poolInfo.data.length < 8 + 32 + 32 + 32 + 32) {
      return res.status(400).json({ error: 'Pool account data too small' });
    }

    // Pool layout: [8 discriminator][32 admin][32 token_mint][32 vault][32 merkle_root]...
    // merkle_root is at offset 104
    const merkleRoot32 = Buffer.alloc(32);
    if (merkleRoot) {
      sanitizeHex(merkleRoot).slice(0, 32).copy(merkleRoot32);
    } else {
      poolInfo.data.slice(104, 136).copy(merkleRoot32);
      log('info', 'Fetched merkle_root from pool', { requestId, merkleRoot: merkleRoot32.toString('hex').slice(0, 16) + '...' });
    }
    
    // Derive deposit PDA from pool + leafIndex (u64 = 8 bytes)
    const leafIndexBuffer = Buffer.alloc(8);
    leafIndexBuffer.writeBigUInt64LE(BigInt(leafIndex));
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
    log('info', 'DEBUG: vaultPda derived', { requestId, vaultPda: vaultPda.toBase58() });
    
    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('nullifier'), pool.toBuffer(), nullifier32],
      config.programId
    );
    log('info', 'DEBUG: nullifierPda derived', { requestId, nullifierPda: nullifierPda.toBase58() });
    
    // ========================================
    // Check on-chain nullifier status
    // ========================================
    
    log('info', 'DEBUG: fetching nullifier account...', { requestId });
    const nullifierAccount = await connection.getAccountInfo(nullifierPda);
    log('info', 'DEBUG: nullifier account fetched', { requestId, exists: !!nullifierAccount });
    if (nullifierAccount) {
      log('warn', 'Nullifier already used on-chain', { requestId });
      return res.status(400).json({ error: 'Funds already claimed' });
    }
    
    // ========================================
    // Step 1: Create Proof Buffer
    // ========================================
    
    // Create a fresh buffer for this claim (temp account, closed after claim)
    const bufferKeypair = Keypair.generate();
    const HEADER_SIZE = 169;
    const accountSize = HEADER_SIZE + proofBytes.length;
    const rentExempt = await connection.getMinimumBalanceForRentExemption(accountSize);
    let numChunks = Math.ceil(proofBytes.length / config.chunkSize);
    
    const createAccountIx = SystemProgram.createAccount({
      fromPubkey: relayerKeypair.publicKey,
      newAccountPubkey: bufferKeypair.publicKey,
      lamports: rentExempt,
      space: accountSize,
      programId: STARK_VERIFIER_ID,
    });
    
    // Initialize the buffer via stark-verifier
    const expectedSizeBuffer = Buffer.alloc(4);
    expectedSizeBuffer.writeUInt32LE(proofBytes.length);
    
    const initData = Buffer.concat([
      getDiscriminator('init_proof_buffer'),
      expectedSizeBuffer,
    ]);
    
    const initIx = new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: initData,
    });
    
    const createTx = new Transaction().add(createAccountIx).add(initIx);
    createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    createTx.feePayer = relayerKeypair.publicKey;
    
    // Buffer keypair must sign for createAccount
    await sendAndConfirmTransaction(connection, createTx, [relayerKeypair, bufferKeypair]);
    
    log('info', 'Buffer created', { requestId, buffer: bufferKeypair.publicKey.toBase58().slice(0, 8), accountSize, rentExempt });
    
    // ========================================
    // Step 2: Write Proof Chunks
    // ========================================
    
    log('info', 'DEBUG: Writing chunks', { requestId, numChunks, chunkSize: config.chunkSize });
    for (let i = 0; i < numChunks; i++) {
      const offset = i * config.chunkSize;
      const chunk = proofBytes.slice(offset, offset + config.chunkSize);
      
      log('info', `DEBUG: Writing chunk ${i+1}/${numChunks}`, { requestId, offset, chunkLen: chunk.length });
      
      const writeData = Buffer.concat([
        getDiscriminator('upload_chunk'),
        Buffer.from(new Uint32Array([offset]).buffer),
        Buffer.from(new Uint32Array([chunk.length]).buffer),
        chunk,
      ]);
      
      const writeIx = new TransactionInstruction({
        programId: STARK_VERIFIER_ID,
        keys: [
          { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
          { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
        ],
        data: writeData,
      });
      
      const writeTx = new Transaction().add(writeIx);
      writeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      writeTx.feePayer = relayerKeypair.publicKey;
      
      try {
        await sendAndConfirmTransaction(connection, writeTx, [relayerKeypair]);
        log('info', `DEBUG: Chunk ${i+1} written successfully`, { requestId });
      } catch (chunkErr) {
        log('error', `DEBUG: Chunk ${i+1} failed`, { requestId, error: String(chunkErr) });
        throw chunkErr;
      }
    }
    
    log('info', 'Chunks written', { requestId, numChunks });
    
    // ========================================
    // Step 3: Finalize Buffer
    // ========================================
    
    // DEBUG: Log exact values being sent to finalize
    log('info', 'DEBUG: Finalize params', {
      requestId,
      commitment: `${commitment32.toString('hex').slice(0, 8)}...`,
      nullifier: `${nullifier32.toString('hex').slice(0, 8)}...`,
      merkleRoot: `${merkleRoot32.toString('hex').slice(0, 8)}...`,
      proofSize: proofBytes.length,
      proofFirst32: `${proofBytes.slice(0, 32).toString('hex').slice(0, 8)}...`, // trace_commitment
    });
    
    // finalize_and_verify(commitment: [u8; 32], nullifier: [u8; 32], merkle_root: [u8; 32], recipient: [u8; 32])
    const recipient32 = new PublicKey(recipientTokenAccount).toBuffer();
    const finalizeData = Buffer.concat([
      getDiscriminator('finalize_and_verify'),
      commitment32,
      nullifier32,
      merkleRoot32,
      recipient32,
    ]);
    
    const finalizeIx = new TransactionInstruction({
      programId: STARK_VERIFIER_ID,
      keys: [
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data: finalizeData,
    });
    
    const finalizeTx = new Transaction().add(finalizeIx);
    finalizeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    finalizeTx.feePayer = relayerKeypair.publicKey;
    
    await sendAndConfirmTransaction(connection, finalizeTx, [relayerKeypair]);
    log('info', 'Buffer finalized', { requestId });
    
    // DEBUG: Read buffer to verify commitment was stored correctly
    const bufferInfo = await connection.getAccountInfo(bufferKeypair.publicKey);
    if (bufferInfo) {
      const bufData = bufferInfo.data;
      const bufFinalized = bufData[40] === 1;
      const bufCommitment = bufData.slice(41, 73).toString('hex');
      log('info', 'DEBUG: Buffer state after finalize', { 
        requestId,
        finalized: bufFinalized,
        bufferCommitment: bufCommitment,
        expectedCommitment: commitment,
        match: bufCommitment === commitment ? '✅' : '❌'
      });
    }
    
    // ========================================
    // Step 4: Prepare ATA & Claim
    // ========================================
    
    // poolInfo already fetched above for merkle_root
    const tokenMint = new PublicKey(poolInfo.data.slice(8 + 32, 8 + 32 + 32));
    // recipient is already the ATA address (recipientTokenAccount from request)
    const recipientAta = recipient;
    
    // Check if recipient ATA exists (it should already exist, provided by client)
    const ataInfo = await connection.getAccountInfo(recipientAta);
    const claimTx = new Transaction();
    
    if (!ataInfo) {
      // If ATA doesn't exist, we can't create it without knowing the wallet owner
      // Client should provide an existing ATA
      log('error', 'Recipient ATA does not exist', { requestId, recipientAta: recipientAta.toBase58() });
      return res.status(400).json({ error: 'Recipient token account does not exist. Please create it first.' });
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
    
    // Claim instruction expects `relayer_fee` in *token units*, not bps.
    // Convert requested feeBps into an absolute fee using the on-chain deposit amount.
    const depInfo = await connection.getAccountInfo(deposit, 'confirmed');
    if (!depInfo) {
      return res.status(400).json({ error: 'Deposit account not found' });
    }
    const depData = Buffer.from(depInfo.data);
    if (depData.length < 8 + 32 + 32 + 8) {
      return res.status(400).json({ error: 'Invalid deposit account' });
    }
    const depositAmount = u64ToSafeNumber(readU64LE(depData, 8 + 32 + 32), 'depositAmount');

    // floor(amount * bps / 10_000)
    const relayerFeeAmount = Math.floor((depositAmount * feeBps) / 10_000);

    const relayerFeeBuffer = Buffer.alloc(8);
    relayerFeeBuffer.writeBigUInt64LE(BigInt(relayerFeeAmount));
    
    const claimData = Buffer.concat([
      getDiscriminator('claim'),
      relayerFeeBuffer,
      nullifier32,
    ]);
    
    const claimIx = new TransactionInstruction({
      programId: config.programId,
      keys: [
        { pubkey: pool, isSigner: false, isWritable: false },           // pool (read-only)
        { pubkey: deposit, isSigner: false, isWritable: true },         // deposit
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: false }, // verifier_buffer
        { pubkey: nullifierPda, isSigner: false, isWritable: true },    // nullifier_record
        { pubkey: vaultPda, isSigner: false, isWritable: true },        // vault
        { pubkey: recipientAta, isSigner: false, isWritable: true },    // recipient_token
        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true }, // relayer (SIGNER - before relayer_token!)
        { pubkey: relayerAta, isSigner: false, isWritable: true },      // relayer_token
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
      // Parse error for better diagnostics
      const errJson = JSON.stringify(simResult.value.err);
      let errorDetail = errJson;
      
      // Check for specific Anchor errors
      if (errJson.includes('3007')) {
        // AccountOwnedByWrongProgram - check which account
        const depositInfo = await connection.getAccountInfo(deposit);
        const poolInfo = await connection.getAccountInfo(pool);
        errorDetail = `AccountOwnedByWrongProgram: ` +
          `deposit=${deposit.toBase58()} owner=${depositInfo?.owner?.toBase58() || 'NOT_FOUND'}, ` +
          `pool=${pool.toBase58()} owner=${poolInfo?.owner?.toBase58() || 'NOT_FOUND'}, ` +
          `expected=${config.programId.toBase58()}`;
      }
      
      log('error', 'Claim simulation failed', { 
        requestId, 
        error: errJson,
        detail: errorDetail,
        logs: simResult.value.logs?.slice(-10),
      });
      return res.status(400).json({ 
        error: 'Claim verification failed',
        code: 'VERIFICATION_FAILED',
        detail: errorDetail,
      });
    }
    
    const claimSig = await sendAndConfirmTransaction(connection, claimTx, [relayerKeypair]);
    
    log('info', 'Claim successful', {
      requestId,
      signature: claimSig,
      computeUnits: simResult.value.unitsConsumed,
    });
    
    // Mark deposit as claimed in the database
    const depositId = `${poolAddress}-${leafIndex}`;
    const dep = stmtFindById.get(depositId) as any;
    if (dep) {
      stmtMarkClaimed.run(dep.id);
      log('info', 'Deposit marked claimed', { requestId, depositId: dep.id });
    }
    
    res.json({
      success: true,
      signature: claimSig,
      chunksWritten: numChunks,
      computeUnits: simResult.value.unitsConsumed,
    });
    
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const stack = e instanceof Error ? e.stack : undefined;
    log('error', 'Claim error', { requestId, error: message, stack });
    console.error('❌ Claim error:', message);
    if (stack) console.error(stack);
    
    // Remove nullifier from cache so user can retry
    if (claimNullifier) {
      processedNullifiers.delete(claimNullifier);
    }
    
    // Return more detail in development
    const isDev = process.env.NODE_ENV !== 'production';
    if (message.includes('insufficient funds')) {
      res.status(503).json({ error: 'Relayer temporarily unavailable' });
    } else if (isDev) {
      res.status(500).json({ error: message, requestId });
    } else {
      res.status(500).json({ error: 'Internal error' });
    }
  }
});

// ============================================================================
// Deposit Indexing (for OAuth claim flow)
// ============================================================================

// SQLite-backed deposit index (persistent across restarts)
interface IndexedDeposit {
  id: string;
  pool: string;
  commitment: string;
  identifierHash: string;
  amount: number;
  token: string;
  leafIndex: number;
  timestamp: string;
  claimed: boolean;
  txSignature: string;
}

// Initialize deposits table
db.exec(`
  CREATE TABLE IF NOT EXISTS deposits (
    id TEXT PRIMARY KEY,
    pool TEXT NOT NULL,
    commitment TEXT NOT NULL,
    identifier_hash TEXT NOT NULL,
    amount REAL NOT NULL,
    token TEXT NOT NULL DEFAULT 'SOL',
    leaf_index INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    claimed INTEGER NOT NULL DEFAULT 0,
    tx_signature TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deposits_identifier_hash ON deposits(identifier_hash);
  CREATE INDEX IF NOT EXISTS idx_deposits_leaf_index ON deposits(leaf_index);
`);

// Initialize vouchers table
initVoucherTable(db);

// Periodic cleanup of old claimed vouchers (every 6 hours)
setInterval(() => {
  const deleted = cleanupOldVouchers(db, 30);
  if (deleted > 0) {
    log('info', 'Cleaned up old vouchers', { deleted });
  }
}, 6 * 60 * 60 * 1000);

// Prepared statements for performance
const stmtInsertDeposit = db.prepare(`
  INSERT OR IGNORE INTO deposits (id, pool, commitment, identifier_hash, amount, token, leaf_index, timestamp, claimed, tx_signature)
  VALUES (@id, @pool, @commitment, @identifierHash, @amount, @token, @leafIndex, @timestamp, @claimed, @txSignature)
`);
const stmtGetByHash = db.prepare(`SELECT * FROM deposits WHERE identifier_hash = ?`);
const stmtMarkClaimed = db.prepare(`UPDATE deposits SET claimed = 1 WHERE id = ?`);
const stmtFindById = db.prepare(`SELECT * FROM deposits WHERE id = ?`);

function rowToDeposit(row: any): IndexedDeposit {
  return {
    id: row.id,
    pool: row.pool,
    commitment: row.commitment,
    identifierHash: row.identifier_hash,
    amount: row.amount,
    token: row.token,
    leafIndex: row.leaf_index,
    timestamp: row.timestamp,
    claimed: !!row.claimed,
    txSignature: row.tx_signature,
  };
}

// Hash identifier for lookup (same as on-chain)
function hashIdentifier(identifier: string): string {
  return crypto.createHash('sha256').update(identifier.toLowerCase().trim()).digest('hex');
}

// Index a new deposit
function indexDeposit(deposit: IndexedDeposit): void {
  stmtInsertDeposit.run({
    id: deposit.id,
    pool: deposit.pool,
    commitment: deposit.commitment,
    identifierHash: deposit.identifierHash,
    amount: deposit.amount,
    token: deposit.token,
    leafIndex: deposit.leafIndex,
    timestamp: deposit.timestamp,
    claimed: deposit.claimed ? 1 : 0,
    txSignature: deposit.txSignature,
  });
  log('info', 'Deposit indexed', { 
    identifierHash: deposit.identifierHash.slice(0, 16) + '...', 
    leafIndex: deposit.leafIndex 
  });
}

// Get deposits by identity — requires auth to prevent enumeration attacks
app.get('/deposits', async (req: Request, res: Response) => {
  try {
    // Require authenticated session to prevent deposit enumeration
    const session = await auth.api.getSession({
      headers: req.headers as Record<string, string>,
    });
    if (!session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const identity = req.query.identity as string;
    if (!identity || identity.length < 1 || identity.length > 256) {
      return res.status(400).json({ error: 'Invalid identity parameter' });
    }
    
    // Verify the queried identity belongs to this user
    const accounts = await auth.api.listUserAccounts({
      headers: req.headers as Record<string, string>,
    });
    const userIdentifiers = new Set<string>();
    if (accounts && Array.isArray(accounts)) {
      for (const account of accounts) {
        const providerId = (account as any).providerId || 'unknown';
        const identifier = getMurklIdentifier(session.user, providerId);
        userIdentifiers.add(identifier.toLowerCase());
      }
    }
    if (session.user.email) {
      userIdentifiers.add(`email:${session.user.email}`.toLowerCase());
    }
    
    // Only allow querying your own identities
    if (!userIdentifiers.has(identity.toLowerCase())) {
      log('warn', 'Deposit query denied — not user identity', { 
        userId: session.user.id, 
        queriedIdentity: identity.slice(0, 20) 
      });
      return res.status(403).json({ error: 'Not your identity' });
    }
    
    const identifierHash = hashIdentifier(identity);
    const rows = stmtGetByHash.all(identifierHash);
    const deposits = rows.map(rowToDeposit);
    
    // Return all deposits — UI shows claimed ones with a badge
    res.json({
      identity: identity,
      deposits: deposits.map(d => ({
        id: d.id,
        amount: d.amount,
        token: d.token,
        leafIndex: d.leafIndex,
        timestamp: d.timestamp,
        claimed: d.claimed,
      })),
      totalCount: deposits.length,
      unclaimedCount: deposits.filter(d => !d.claimed).length,
    });
  } catch (e: unknown) {
    log('error', 'Deposits query failed', { error: String(e) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// Register deposit (called after successful deposit tx)
//
// NOTE: This endpoint intentionally does NOT require auth.
// The sender may not be logged in, and the recipient definitely won't be logged
// in yet (especially for email). We rely on on-chain transaction verification
// (verifyDepositTx) + rate limiting to prevent spam/DB poisoning.
app.post('/deposits/register', async (req: Request, res: Response) => {
  try {
    const { identifier, amount, token, leafIndex, pool, commitment, txSignature } = req.body as {
      identifier?: unknown;
      amount?: unknown;
      token?: unknown;
      leafIndex?: unknown;
      pool?: unknown;
      commitment?: unknown;
      txSignature?: unknown;
    };

    if (typeof identifier !== 'string' || identifier.length < 1 || identifier.length > 256) {
      return res.status(400).json({ error: 'Invalid identifier' });
    }

    if (typeof pool !== 'string' || !isValidBase58(pool)) {
      return res.status(400).json({ error: 'Invalid pool' });
    }

    if (typeof commitment !== 'string' || !isValidHex(commitment, 32, 32)) {
      return res.status(400).json({ error: 'Invalid commitment' });
    }

    const leafIndexNum = typeof leafIndex === 'number' ? leafIndex : Number(leafIndex);
    if (!Number.isInteger(leafIndexNum) || leafIndexNum < 0 || leafIndexNum > 0xffffffff) {
      return res.status(400).json({ error: 'Invalid leafIndex' });
    }

    const amountNum = typeof amount === 'number' ? amount : Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Validate txSignature format (base58)
    if (typeof txSignature !== 'string' || txSignature.length < 64 || txSignature.length > 128 || !BASE58_REGEX.test(txSignature)) {
      return res.status(400).json({ error: 'Invalid transaction signature' });
    }

    const tokenStr = typeof token === 'string' && token.length > 0 ? token : 'SOL';

    // NOTE: identifier is the RECIPIENT. Users must be able to send to identities
    // that are not yet in our DB (e.g., a friend who hasn't used Murkl).
    //
    // Security is enforced by verifying the on-chain tx + deposit account data,
    // so clients can't register fake deposits or trigger emails without paying
    // for a real on-chain deposit.

    // Verify on-chain tx to prevent fake registrations / DB poisoning
    const poolPk = new PublicKey(pool);
    try {
      await verifyDepositTx({
        txSignature,
        pool: poolPk,
        leafIndex: leafIndexNum,
        amount: amountNum,
        commitmentHex: commitment,
      });
    } catch (verErr: any) {
      const msg = verErr instanceof Error ? verErr.message : String(verErr);
      log('warn', 'Deposit tx verification failed', {
        reason: msg,
        pool: pool.slice(0, 8) + '...',
        leafIndex: leafIndexNum,
      });
      return res.status(400).json({ error: 'Invalid deposit transaction', reason: msg });
    }

    const deposit: IndexedDeposit = {
      id: `${pool}-${leafIndexNum}`,
      pool,
      commitment,
      identifierHash: hashIdentifier(identifier),
      amount: amountNum,
      token: tokenStr,
      leafIndex: leafIndexNum,
      timestamp: new Date().toISOString(),
      claimed: false,
      txSignature,
    };

    indexDeposit(deposit);
    
    // For email deposits, create a voucher if password was provided
    // This enables OTP-free claiming via voucher code
    let voucherCode: string | undefined;
    if (identifier.startsWith('email:') && (req.body as any).password) {
      try {
        voucherCode = createVoucher(db, {
          identifier,
          leafIndex: leafIndexNum,
          pool,
          password: (req.body as any).password,
          amount: amountNum,
          token: tokenStr,
        });
        log('info', 'Voucher created for email deposit', { voucherCode, leafIndex: leafIndexNum });
      } catch (voucherErr) {
        log('warn', 'Failed to create voucher', { error: String(voucherErr) });
        // Non-critical — user can still claim via OTP
      }
    }
    
    // Send notification email if depositing to an email identifier
    if (identifier.startsWith('email:') && resend) {
      const recipientEmail = identifier.slice('email:'.length);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      
      // Prefer voucher claim link (fast path). If no voucher was created (e.g. password not
      // provided to /deposits/register), fall back to the classic id/leaf/pool link.
      const claimParams = new URLSearchParams({
        tab: 'claim',
        ...(voucherCode
          ? { voucher: voucherCode }
          : { id: identifier, leaf: String(leafIndexNum), pool }
        ),
      });
      const claimLink = `${frontendUrl}/?${claimParams.toString()}`;
      
      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Murkl <noreply@email.siklab.dev>',
          to: recipientEmail,
          subject: `💰 You received ${amountNum} ${tokenStr} on Murkl`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 2rem; background: #0a0a0f; color: #fff; border-radius: 16px;">
              <div style="text-align: center; margin-bottom: 1.5rem;">
                <span style="font-size: 2.5rem;">🐈‍⬛</span>
                <h1 style="font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0 0;">You received funds!</h1>
              </div>
              
              <div style="background: #14141f; border: 1px solid #27272a; border-radius: 12px; padding: 1.5rem; text-align: center; margin: 1.5rem 0;">
                <p style="color: #a1a1aa; font-size: 0.9rem; margin: 0 0 0.5rem;">Amount</p>
                <p style="font-size: 2rem; font-weight: 700; margin: 0; color: #fff;">${amountNum} ${tokenStr}</p>
              </div>
              
              <p style="color: #a1a1aa; font-size: 0.95rem; line-height: 1.5; text-align: center;">
                Someone sent you tokens privately via Murkl.
              </p>

              ${voucherCode ? `
              <p style="color: #a1a1aa; font-size: 0.95rem; line-height: 1.5; text-align: center; margin-top: 0.75rem;">
                Use this <strong style="color: #fff;">claim code</strong> (and the secret code the sender shared) to claim.
              </p>
              <div style="background: #14141f; border: 1px solid #3d95ce; border-radius: 12px; padding: 1rem; margin: 1rem 0; text-align: center;">
                <p style="color: #a1a1aa; font-size: 0.8rem; margin: 0 0 0.5rem;">Your claim code</p>
                <p style="font-size: 1.5rem; font-weight: 700; font-family: monospace; letter-spacing: 0.1em; color: #3d95ce; margin: 0;">${voucherCode}</p>
              </div>
              ` : `
              <div style="background: #14141f; border: 1px solid #27272a; border-radius: 12px; padding: 1rem; margin: 1rem 0;">
                <p style="color: #a1a1aa; font-size: 0.9rem; margin: 0; line-height: 1.4; text-align: center;">
                  To claim, open Murkl and sign in with this email. You’ll also need the <strong style="color: #fff;">secret code</strong> the sender shared with you.
                </p>
              </div>
              `}
              
              <div style="text-align: center; margin: 1.5rem 0;">
                <a href="${claimLink}" style="display: inline-block; padding: 0.875rem 2rem; background: #3d95ce; color: #fff; text-decoration: none; border-radius: 12px; font-weight: 600; font-size: 1rem;">
                  Claim your ${tokenStr}
                </a>
              </div>
              
              <div style="background: #14141f; border: 1px solid #27272a; border-radius: 10px; padding: 1rem; margin-top: 1.5rem;">
                <p style="color: #71717a; font-size: 0.8rem; margin: 0; text-align: center;">
                  🔒 Your funds are secured by a STARK proof on Solana.<br>
                  Only someone with the password can claim them.
                </p>
              </div>
              
              <p style="color: #52525b; font-size: 0.75rem; text-align: center; margin-top: 1.5rem;">
                <a href="${claimLink}" style="color: #52525b; word-break: break-all;">${claimLink}</a>
              </p>
            </div>
          `,
        });
        log('info', 'Claim notification email sent', { to: recipientEmail, leafIndex, hasVoucher: !!voucherCode });
      } catch (emailErr) {
        log('warn', 'Failed to send claim notification email', { error: String(emailErr) });
        // Non-critical — deposit still registered
      }
    }

    res.json({ success: true, depositId: deposit.id, voucherCode });
  } catch (e: unknown) {
    log('error', 'Deposit registration failed', { error: String(e) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// Mark deposit as claimed — requires auth
app.post('/deposits/mark-claimed', async (req: Request, res: Response) => {
  try {
    // Require authenticated session to prevent unauthorized state manipulation
    const session = await auth.api.getSession({
      headers: req.headers as Record<string, string>,
    });
    if (!session?.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { depositId, nullifier } = req.body;
    
    if (!depositId) {
      return res.status(400).json({ error: 'Missing depositId' });
    }
    
    // Find and mark as claimed — only if the deposit belongs to one of the user's identities
    const accounts = await auth.api.listUserAccounts({
      headers: req.headers as Record<string, string>,
    });
    const userIdentifierHashes = new Set<string>();
    if (accounts && Array.isArray(accounts)) {
      for (const account of accounts) {
        const providerId = (account as any).providerId || 'unknown';
        const identifier = getMurklIdentifier(session.user, providerId);
        userIdentifierHashes.add(hashIdentifier(identifier));
      }
    }
    if (session.user.email) {
      userIdentifierHashes.add(hashIdentifier(`email:${session.user.email}`));
    }
    
    const deposit = stmtFindById.get(depositId) as any;
    if (!deposit) {
      return res.status(404).json({ error: 'Deposit not found' });
    }
    
    // Verify the deposit belongs to this user
    if (!userIdentifierHashes.has(deposit.identifier_hash)) {
      return res.status(403).json({ error: 'Not your deposit' });
    }
    
    stmtMarkClaimed.run(depositId);
    log('info', 'Deposit marked claimed', { depositId, userId: session.user.id });
    return res.json({ success: true });
  } catch (e: unknown) {
    log('error', 'Mark claimed failed', { error: String(e) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================================
// Voucher System (OTP-free email claiming)
// ============================================================================

// Get voucher info (without decrypting — just shows amount, token, status)
app.get('/vouchers/:code', async (req: Request, res: Response) => {
  try {
    const code = req.params.code as string;
    
    // Strict validation: must match exact voucher code format
    if (!isValidVoucherCode(code)) {
      return res.status(400).json({ error: 'Invalid voucher code' });
    }
    
    const info = getVoucherInfo(db, code);
    
    if (!info) {
      return res.status(404).json({ error: 'Voucher not found' });
    }
    
    res.json({
      code: info.code,
      amount: info.amount,
      token: info.token,
      claimed: info.claimed,
    });
  } catch (e: unknown) {
    log('error', 'Voucher info failed', { error: String(e) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// Redeem voucher (decrypt with password to get claim data)
// Rate-limited to prevent brute-force password attacks
app.post('/vouchers/redeem', voucherRedeemLimiter, async (req: Request, res: Response) => {
  try {
    const { code, password } = req.body;
    
    if (!code || !password) {
      return res.status(400).json({ error: 'Code and password required' });
    }
    
    // Strict validation: must match exact voucher code format
    if (!isValidVoucherCode(code)) {
      return res.status(400).json({ error: 'Invalid voucher code format' });
    }
    
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Invalid password format' });
    }
    
    const result = redeemVoucher(db, code, password);
    
    if ('error' in result) {
      // Constant-time-ish response: don't reveal whether code exists or password is wrong
      // Add small jitter to prevent timing attacks
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(400).json({ error: 'Invalid code or password' });
    }
    
    // Return decrypted claim data
    res.json({
      success: true,
      identifier: result.data.identifier,
      leafIndex: result.data.leafIndex,
      pool: result.pool,
      amount: result.amount,
      token: result.token,
    });
  } catch (e: unknown) {
    log('error', 'Voucher redeem failed', { error: String(e) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// Mark voucher as claimed (called after successful claim)
// Security: require the voucher password to prevent unauthenticated DoS
// (without this, anyone could mark arbitrary vouchers as claimed).
app.post('/vouchers/mark-claimed', voucherRedeemLimiter, async (req: Request, res: Response) => {
  try {
    const { code, password } = req.body as { code?: unknown; password?: unknown };

    if (typeof code !== 'string' || !isValidVoucherCode(code)) {
      return res.status(400).json({ error: 'Invalid voucher code format' });
    }

    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Invalid password format' });
    }

    // Verify password matches voucher (and that voucher exists / is unclaimed)
    const redeemed = redeemVoucher(db, code, password);
    if ('error' in redeemed) {
      // Do not leak whether the code exists vs wrong password
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(400).json({ error: 'Invalid code or password' });
    }

    const success = markVoucherClaimed(db, code);
    if (!success) {
      // Extremely rare race (claimed between redeem and update)
      return res.status(404).json({ error: 'Voucher not found' });
    }

    res.json({ success: true });
  } catch (e: unknown) {
    log('error', 'Mark voucher claimed failed', { error: String(e) });
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================================
// Pool Info
// ============================================================================

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

// Run auth migrations then start server
runAuthMigrations().then(() => {
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
}).catch((err) => {
  log('error', 'Failed to start server', { error: String(err) });
  process.exit(1);
});
