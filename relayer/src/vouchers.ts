/**
 * Murkl Voucher System
 *
 * Password-encrypted claim vouchers for email recipients.
 * Eliminates OTP verification since email delivery IS the verification.
 *
 * Encryption: PBKDF2 → AES-256-GCM
 * Code format: nanoid (12 chars, URL-safe)
 */

import * as crypto from 'crypto';
import Database from 'better-sqlite3';
import { customAlphabet } from 'nanoid';

// URL-safe alphabet (no ambiguous chars like 0/O, 1/l/I)
const VOUCHER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
const generateVoucherCode = customAlphabet(VOUCHER_ALPHABET, 12);

// Regex to validate voucher code format
const VOUCHER_CODE_REGEX = new RegExp(`^[${VOUCHER_ALPHABET}]{12}$`);

/**
 * Validate voucher code format (exact length + alphabet)
 */
export function isValidVoucherCode(code: string): boolean {
  return typeof code === 'string' && VOUCHER_CODE_REGEX.test(code);
}

// Crypto constants
const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32; // AES-256

export interface VoucherData {
  identifier: string;
  leafIndex: number;
}

export interface CreateVoucherParams {
  identifier: string;
  leafIndex: number;
  pool: string;
  password: string;
  amount: number;
  token: string;
}

export interface VoucherRecord {
  code: string;
  pool: string;
  amount: number;
  token: string;
  createdAt: string;
  claimed: boolean;
}

/**
 * Derive encryption key from password using PBKDF2
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt data using AES-256-GCM
 */
function encrypt(data: VoucherData, password: string): { encryptedData: string; salt: string; iv: string } {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const jsonData = JSON.stringify(data);
  
  const encrypted = Buffer.concat([
    cipher.update(jsonData, 'utf8'),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();
  
  // Combine encrypted data + auth tag
  const combined = Buffer.concat([encrypted, authTag]);
  
  return {
    encryptedData: combined.toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
function decrypt(encryptedData: string, salt: string, iv: string, password: string): VoucherData | null {
  try {
    const saltBuf = Buffer.from(salt, 'base64');
    const ivBuf = Buffer.from(iv, 'base64');
    const key = deriveKey(password, saltBuf);
    
    const combined = Buffer.from(encryptedData, 'base64');
    
    // Split encrypted data and auth tag (last 16 bytes)
    const encrypted = combined.slice(0, -16);
    const authTag = combined.slice(-16);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    // Wrong password or corrupted data
    return null;
  }
}

/**
 * Initialize voucher table
 */
export function initVoucherTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vouchers (
      code TEXT PRIMARY KEY,
      pool TEXT NOT NULL,
      amount REAL NOT NULL,
      token TEXT NOT NULL,
      encrypted_data TEXT NOT NULL,
      salt TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at TEXT NOT NULL,
      claimed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_vouchers_created ON vouchers(created_at);
  `);
}

/**
 * Create a voucher for email claim
 */
export function createVoucher(
  db: Database.Database,
  params: CreateVoucherParams,
): string {
  const code = generateVoucherCode();
  
  const voucherData: VoucherData = {
    identifier: params.identifier,
    leafIndex: params.leafIndex,
  };
  
  const { encryptedData, salt, iv } = encrypt(voucherData, params.password);
  
  const stmt = db.prepare(`
    INSERT INTO vouchers (code, pool, amount, token, encrypted_data, salt, iv, created_at, claimed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
  `);
  
  stmt.run(
    code,
    params.pool,
    params.amount,
    params.token,
    encryptedData,
    salt,
    iv,
    new Date().toISOString(),
  );
  
  return code;
}

/**
 * Redeem a voucher with password
 */
export function redeemVoucher(
  db: Database.Database,
  code: string,
  password: string,
): { data: VoucherData; pool: string; amount: number; token: string } | { error: string } {
  const stmt = db.prepare(`SELECT * FROM vouchers WHERE code = ?`);
  const row = stmt.get(code) as any;
  
  if (!row) {
    return { error: 'Invalid voucher code' };
  }
  
  if (row.claimed) {
    return { error: 'Voucher already used' };
  }
  
  const decrypted = decrypt(row.encrypted_data, row.salt, row.iv, password);
  
  if (!decrypted) {
    return { error: 'Incorrect password' };
  }
  
  return {
    data: decrypted,
    pool: row.pool,
    amount: row.amount,
    token: row.token,
  };
}

/**
 * Mark a voucher as claimed
 */
export function markVoucherClaimed(db: Database.Database, code: string): boolean {
  const stmt = db.prepare(`UPDATE vouchers SET claimed = 1 WHERE code = ?`);
  const result = stmt.run(code);
  return result.changes > 0;
}

/**
 * Get voucher info (without decrypting)
 */
export function getVoucherInfo(db: Database.Database, code: string): VoucherRecord | null {
  const stmt = db.prepare(`SELECT code, pool, amount, token, created_at, claimed FROM vouchers WHERE code = ?`);
  const row = stmt.get(code) as any;
  
  if (!row) {
    return null;
  }
  
  return {
    code: row.code,
    pool: row.pool,
    amount: row.amount,
    token: row.token,
    createdAt: row.created_at,
    claimed: !!row.claimed,
  };
}

/**
 * Clean up old claimed vouchers (run periodically)
 */
export function cleanupOldVouchers(db: Database.Database, daysOld: number = 30): number {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  const stmt = db.prepare(`DELETE FROM vouchers WHERE claimed = 1 AND created_at < ?`);
  const result = stmt.run(cutoff);
  return result.changes;
}
