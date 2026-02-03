"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
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
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
function loadConfig() {
    const programId = process.env.PROGRAM_ID || '74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92';
    // Validate program ID format
    try {
        new web3_js_1.PublicKey(programId);
    }
    catch {
        console.error('❌ Invalid PROGRAM_ID');
        process.exit(1);
    }
    const corsOrigins = process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
        : ['http://localhost:3000', 'http://localhost:3001', 'https://murkl.app'];
    return {
        port: parseInt(process.env.PORT || '3001', 10),
        rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8899',
        programId: new web3_js_1.PublicKey(programId),
        maxFeeBps: 100,
        chunkSize: 900,
        corsOrigins,
        rateLimitWindowMs: 60 * 1000, // 1 minute
        rateLimitMaxRequests: 100, // 100 requests per minute (general)
        claimRateLimitMaxRequests: 10, // 10 claims per minute per IP
        requestTimeoutMs: 120_000, // 2 minutes for claim operations
    };
}
const config = loadConfig();
function log(level, message, meta) {
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
    }
    else {
        const emoji = { debug: '🔍', info: 'ℹ️', warn: '⚠️', error: '❌' }[level];
        console.log(`${emoji} [${timestamp}] ${message}`, meta || '');
    }
}
// ============================================================================
// Input Validation
// ============================================================================
const HEX_REGEX = /^(0x)?[0-9a-fA-F]+$/;
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;
function isValidHex(value, minBytes = 1, maxBytes = 8192) {
    if (typeof value !== 'string')
        return false;
    if (!HEX_REGEX.test(value))
        return false;
    const hex = value.replace('0x', '');
    const bytes = hex.length / 2;
    return bytes >= minBytes && bytes <= maxBytes;
}
function isValidBase58(value) {
    if (typeof value !== 'string')
        return false;
    if (!BASE58_REGEX.test(value))
        return false;
    try {
        new web3_js_1.PublicKey(value);
        return true;
    }
    catch {
        return false;
    }
}
function isValidFeeBps(value) {
    if (typeof value !== 'number')
        return false;
    return Number.isInteger(value) && value >= 0 && value <= config.maxFeeBps;
}
function isValidLeafIndex(value) {
    if (typeof value !== 'number')
        return false;
    return Number.isInteger(value) && value >= 0 && value < 2 ** 32;
}
function sanitizeHex(hex) {
    return Buffer.from(hex.replace('0x', ''), 'hex');
}
// ============================================================================
// Relayer Setup
// ============================================================================
const RELAYER_KEYPAIR_PATH = process.env.RELAYER_KEYPAIR ||
    path.join(process.env.HOME || '', '.config/solana/id.json');
let relayerKeypair;
try {
    const secretKey = JSON.parse(fs.readFileSync(RELAYER_KEYPAIR_PATH, 'utf-8'));
    relayerKeypair = web3_js_1.Keypair.fromSecretKey(new Uint8Array(secretKey));
    log('info', 'Relayer keypair loaded', {
        pubkey: relayerKeypair.publicKey.toBase58().slice(0, 8) + '...'
    });
}
catch (e) {
    log('error', 'Failed to load relayer keypair', { path: RELAYER_KEYPAIR_PATH });
    process.exit(1);
}
const connection = new web3_js_1.Connection(config.rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: config.requestTimeoutMs,
});
// ============================================================================
// Nonce Tracking (replay protection)
// ============================================================================
const processedNullifiers = new Set();
const NULLIFIER_CACHE_MAX = 10000;
function trackNullifier(nullifier) {
    if (processedNullifiers.has(nullifier)) {
        return false; // Already processed
    }
    // Evict oldest if at capacity (simple FIFO)
    if (processedNullifiers.size >= NULLIFIER_CACHE_MAX) {
        const first = processedNullifiers.values().next().value;
        if (first)
            processedNullifiers.delete(first);
    }
    processedNullifiers.add(nullifier);
    return true;
}
// ============================================================================
// Express App Setup
// ============================================================================
const app = (0, express_1.default)();
// Security headers
app.use((0, helmet_1.default)({
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
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.) in dev
        if (!origin && process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }
        if (!origin || config.corsOrigins.includes(origin)) {
            callback(null, true);
        }
        else {
            log('warn', 'CORS blocked', { origin });
            callback(new Error('CORS not allowed'));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400, // 24 hours
}));
// General rate limiter
const generalLimiter = (0, express_rate_limit_1.default)({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMaxRequests,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'unknown',
});
// Strict rate limiter for claims
const claimLimiter = (0, express_rate_limit_1.default)({
    windowMs: config.rateLimitWindowMs,
    max: config.claimRateLimitMaxRequests,
    message: { error: 'Too many claim requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'unknown',
});
app.use(generalLimiter);
app.use(express_1.default.json({ limit: '50kb' })); // Reduced from 1mb
// Request timeout middleware
app.use((req, res, next) => {
    res.setTimeout(config.requestTimeoutMs, () => {
        log('warn', 'Request timeout', { path: req.path, ip: req.ip });
        res.status(408).json({ error: 'Request timeout' });
    });
    next();
});
// Request logging
app.use((req, res, next) => {
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
    app.use(express_1.default.static(distPath, {
        maxAge: '1d',
        etag: true,
    }));
}
// ============================================================================
// Anchor Helpers
// ============================================================================
function getDiscriminator(name) {
    const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
    return hash.slice(0, 8);
}
// ============================================================================
// API Routes
// ============================================================================
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});
app.get('/info', async (_req, res) => {
    try {
        const balance = await connection.getBalance(relayerKeypair.publicKey);
        res.json({
            relayer: relayerKeypair.publicKey.toBase58(),
            balance: balance / web3_js_1.LAMPORTS_PER_SOL,
            program: config.programId.toBase58(),
            maxFeeBps: config.maxFeeBps,
            version: '1.0.0',
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        log('error', 'Info endpoint error', { error: message });
        res.status(500).json({ error: 'Service temporarily unavailable' });
    }
});
/**
 * Submit a claim (multi-step chunked upload)
 */
app.post('/claim', claimLimiter, async (req, res) => {
    const requestId = crypto.randomBytes(8).toString('hex');
    try {
        const { proof, commitment, nullifier, leafIndex, recipientTokenAccount, poolAddress, feeBps = 50 } = req.body;
        // ========================================
        // Input Validation
        // ========================================
        const errors = [];
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
        const pool = new web3_js_1.PublicKey(poolAddress);
        const recipient = new web3_js_1.PublicKey(recipientTokenAccount);
        // Derive deposit PDA from pool + leafIndex
        const leafIndexBuffer = Buffer.alloc(4);
        leafIndexBuffer.writeUInt32LE(leafIndex);
        const [depositPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('deposit'), pool.toBuffer(), leafIndexBuffer], config.programId);
        const deposit = depositPda;
        log('info', 'Derived deposit PDA', { requestId, depositPda: depositPda.toBase58(), leafIndex });
        // Derive PDAs
        const [vaultPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault'), pool.toBuffer()], config.programId);
        const [proofBufferPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('proof'), relayerKeypair.publicKey.toBuffer(), commitment32.slice(0, 8)], config.programId);
        const [nullifierPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('nullifier'), pool.toBuffer(), nullifier32], config.programId);
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
        }
        else {
            // Create buffer
            const createData = Buffer.concat([
                getDiscriminator('create_proof_buffer'),
                commitment32,
                nullifier32,
                Buffer.from(new Uint32Array([proofBytes.length]).buffer),
            ]);
            const createIx = new web3_js_1.TransactionInstruction({
                programId: config.programId,
                keys: [
                    { pubkey: proofBufferPda, isSigner: false, isWritable: true },
                    { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: true },
                    { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                data: createData,
            });
            const createTx = new web3_js_1.Transaction().add(createIx);
            createTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            createTx.feePayer = relayerKeypair.publicKey;
            await (0, web3_js_1.sendAndConfirmTransaction)(connection, createTx, [relayerKeypair]);
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
                const writeIx = new web3_js_1.TransactionInstruction({
                    programId: config.programId,
                    keys: [
                        { pubkey: proofBufferPda, isSigner: false, isWritable: true },
                        { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
                    ],
                    data: writeData,
                });
                const writeTx = new web3_js_1.Transaction().add(writeIx);
                writeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
                writeTx.feePayer = relayerKeypair.publicKey;
                await (0, web3_js_1.sendAndConfirmTransaction)(connection, writeTx, [relayerKeypair]);
            }
            log('info', 'Chunks written', { requestId, numChunks });
            // ========================================
            // Step 3: Finalize Buffer
            // ========================================
            const finalizeData = getDiscriminator('finalize_proof_buffer');
            const finalizeIx = new web3_js_1.TransactionInstruction({
                programId: config.programId,
                keys: [
                    { pubkey: proofBufferPda, isSigner: false, isWritable: true },
                    { pubkey: relayerKeypair.publicKey, isSigner: true, isWritable: false },
                ],
                data: finalizeData,
            });
            const finalizeTx = new web3_js_1.Transaction().add(finalizeIx);
            finalizeTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
            finalizeTx.feePayer = relayerKeypair.publicKey;
            await (0, web3_js_1.sendAndConfirmTransaction)(connection, finalizeTx, [relayerKeypair]);
            log('info', 'Buffer finalized', { requestId });
        }
        // ========================================
        // Step 4: Prepare ATA & Claim
        // ========================================
        const poolInfo = await connection.getAccountInfo(pool);
        if (!poolInfo) {
            return res.status(400).json({ error: 'Pool not found' });
        }
        const tokenMint = new web3_js_1.PublicKey(poolInfo.data.slice(8 + 32, 8 + 32 + 32));
        const recipientWallet = recipient;
        const recipientAta = await (0, spl_token_1.getAssociatedTokenAddress)(tokenMint, recipientWallet);
        const ataInfo = await connection.getAccountInfo(recipientAta);
        const claimTx = new web3_js_1.Transaction();
        if (!ataInfo) {
            claimTx.add((0, spl_token_1.createAssociatedTokenAccountInstruction)(relayerKeypair.publicKey, recipientAta, recipientWallet, tokenMint));
        }
        const relayerAta = await (0, spl_token_1.getAssociatedTokenAddress)(tokenMint, relayerKeypair.publicKey);
        const relayerAtaInfo = await connection.getAccountInfo(relayerAta);
        if (!relayerAtaInfo) {
            claimTx.add((0, spl_token_1.createAssociatedTokenAccountInstruction)(relayerKeypair.publicKey, relayerAta, relayerKeypair.publicKey, tokenMint));
        }
        // Claim instruction
        const claimData = Buffer.concat([
            getDiscriminator('claim'),
            Buffer.from(new Uint16Array([feeBps]).buffer),
        ]);
        const claimIx = new web3_js_1.TransactionInstruction({
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
                { pubkey: spl_token_1.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
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
        const claimSig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, claimTx, [relayerKeypair]);
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
    }
    catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        log('error', 'Claim error', { requestId, error: message });
        // Don't leak internal error details
        if (message.includes('insufficient funds')) {
            res.status(503).json({ error: 'Relayer temporarily unavailable' });
        }
        else {
            res.status(500).json({ error: 'Internal error' });
        }
    }
});
app.get('/pool/:address', async (req, res) => {
    try {
        if (!isValidBase58(req.params.address)) {
            return res.status(400).json({ error: 'Invalid address' });
        }
        const pool = new web3_js_1.PublicKey(req.params.address);
        const accountInfo = await connection.getAccountInfo(pool);
        if (!accountInfo)
            return res.status(404).json({ error: 'Pool not found' });
        res.json({
            address: pool.toBase58(),
            owner: accountInfo.owner.toBase58(),
        });
    }
    catch (e) {
        res.status(500).json({ error: 'Internal error' });
    }
});
app.get('/nullifier/:pool/:nullifier', async (req, res) => {
    try {
        if (!isValidBase58(req.params.pool) || !isValidHex(req.params.nullifier, 32, 32)) {
            return res.status(400).json({ error: 'Invalid parameters' });
        }
        const pool = new web3_js_1.PublicKey(req.params.pool);
        const nullifierHex = req.params.nullifier;
        const nullifierBytes = sanitizeHex(nullifierHex);
        const [nullifierPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('nullifier'), pool.toBuffer(), nullifierBytes], config.programId);
        const accountInfo = await connection.getAccountInfo(nullifierPda);
        res.json({
            pda: nullifierPda.toBase58(),
            used: accountInfo !== null
        });
    }
    catch (e) {
        res.status(500).json({ error: 'Internal error' });
    }
});
// Fallback for SPA routing
app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    }
    else {
        res.status(404).json({ error: 'Not found' });
    }
});
// Error handler
app.use((err, _req, res, _next) => {
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
async function shutdown(signal) {
    if (shuttingDown)
        return;
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
