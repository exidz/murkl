import { keccak_256 } from '@noble/hashes/sha3';

/**
 * Compute keccak256 hash
 */
export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

/**
 * Hash an identifier (email, @twitter, etc.)
 */
export function hashIdentifier(identifier: string): Uint8Array {
  const prefix = new TextEncoder().encode('murkl_identifier_v1');
  const identifierBytes = new TextEncoder().encode(identifier.toLowerCase().trim());
  return keccak256(new Uint8Array([...prefix, ...identifierBytes]));
}

/**
 * Hash a password/secret
 */
export function hashSecret(secret: string): Uint8Array {
  const prefix = new TextEncoder().encode('murkl_secret_v1');
  const secretBytes = new TextEncoder().encode(secret);
  return keccak256(new Uint8Array([...prefix, ...secretBytes]));
}

/**
 * Generate commitment from identifier and password
 * commitment = keccak256("murkl_commitment_v1" || identifier || hash(password))
 */
export function generateCommitment(identifier: string, password: string): Uint8Array {
  const prefix = new TextEncoder().encode('murkl_commitment_v1');
  const identifierHash = hashIdentifier(identifier);
  const secretHash = hashSecret(password);
  return keccak256(new Uint8Array([...prefix, ...identifierHash, ...secretHash]));
}

/**
 * Generate nullifier from secret and leaf index
 * nullifier = keccak256("murkl_nullifier_v1" || hash(secret) || leaf_index)
 */
export function generateNullifier(password: string, leafIndex: bigint): Uint8Array {
  const prefix = new TextEncoder().encode('murkl_nullifier_v1');
  const secretHash = hashSecret(password);
  const leafIndexBytes = new Uint8Array(8);
  const view = new DataView(leafIndexBytes.buffer);
  view.setBigUint64(0, leafIndex, true); // little-endian
  return keccak256(new Uint8Array([...prefix, ...secretHash, ...leafIndexBytes]));
}

/**
 * Verify a commitment matches identifier + password
 */
export function verifyCommitment(
  commitment: Uint8Array,
  identifier: string,
  password: string
): boolean {
  const expected = generateCommitment(identifier, password);
  if (commitment.length !== expected.length) return false;
  return commitment.every((byte, i) => byte === expected[i]);
}

/**
 * Convert bytes to hex string
 */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
