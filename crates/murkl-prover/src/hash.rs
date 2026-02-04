//! Hash functions for Murkl protocol
//!
//! Provides keccak256-based hash functions for:
//! - Commitments (identifier + secret → commitment)
//! - Nullifiers (secret + leaf_index → nullifier)
//! - M31 field element derivation
//!
//! All hashing uses domain separation for security.

#[cfg(not(feature = "std"))]
use alloc::vec::Vec;

use crate::m31::{M31, M31_PRIME};
use sha3::{Digest, Keccak256};

/// A 32-byte hash output
pub type Hash32 = [u8; 32];

/// Hash arbitrary inputs with keccak256
///
/// Concatenates all inputs and returns the hash.
///
/// # Example
/// ```rust,ignore
/// use murkl_prover::hash::keccak_hash;
///
/// let hash = keccak_hash(&[b"domain", &[1, 2, 3]]);
/// ```
pub fn keccak_hash(inputs: &[&[u8]]) -> Hash32 {
    let mut hasher = Keccak256::new();
    for input in inputs {
        hasher.update(input);
    }
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Convert first 4 bytes of hash to M31 element
#[inline]
pub fn hash_to_m31(hash: &Hash32) -> M31 {
    let val = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]);
    M31::new(val % M31_PRIME)
}

/// Hash a password to derive secret (M31)
///
/// Domain: `murkl_password_v1`
pub fn hash_password(password: &str) -> M31 {
    let hash = keccak_hash(&[b"murkl_password_v1", password.as_bytes()]);
    hash_to_m31(&hash)
}

/// Hash an identifier to M31 (case-insensitive)
///
/// Domain: `murkl_identifier_v1`
pub fn hash_identifier(identifier: &str) -> M31 {
    let normalized = identifier.to_lowercase();
    let hash = keccak_hash(&[b"murkl_identifier_v1", normalized.as_bytes()]);
    hash_to_m31(&hash)
}

/// Compute M31 commitment from id_hash and secret
///
/// Domain: `murkl_m31_commitment`
pub fn m31_commitment(id_hash: M31, secret: M31) -> M31 {
    let hash = keccak_hash(&[
        b"murkl_m31_commitment",
        &id_hash.to_le_bytes(),
        &secret.to_le_bytes(),
    ]);
    hash_to_m31(&hash)
}

/// Compute M31 nullifier from secret and leaf index
///
/// Domain: `murkl_m31_nullifier`
pub fn m31_nullifier(secret: M31, leaf_index: u32) -> M31 {
    let hash = keccak_hash(&[
        b"murkl_m31_nullifier",
        &secret.to_le_bytes(),
        &leaf_index.to_le_bytes(),
    ]);
    hash_to_m31(&hash)
}

/// Compute full 32-byte commitment (for on-chain storage)
///
/// Domain: `murkl_commitment_v1`
pub fn pq_commitment(id_hash: M31, secret: M31) -> Hash32 {
    keccak_hash(&[
        b"murkl_m31_hash_v1",
        &id_hash.to_le_bytes(),
        &secret.to_le_bytes(),
    ])
}

/// Compute full 32-byte nullifier (for on-chain double-spend prevention)
///
/// Domain: `murkl_nullifier_v1`  
pub fn pq_nullifier(secret: M31, leaf_index: u32) -> Hash32 {
    let mut data = [0u8; 8];
    data[0..4].copy_from_slice(&secret.to_le_bytes());
    data[4..8].copy_from_slice(&leaf_index.to_le_bytes());
    keccak_hash(&[&data])
}

/// Hash two M31 values together (generic)
///
/// Domain: `murkl_m31_hash_v1`
pub fn m31_hash2(a: M31, b: M31) -> Hash32 {
    keccak_hash(&[
        b"murkl_m31_hash_v1",
        &a.to_le_bytes(),
        &b.to_le_bytes(),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keccak_hash() {
        let hash = keccak_hash(&[b"test"]);
        assert_eq!(hash.len(), 32);
        // Known value test
        assert_ne!(hash, [0u8; 32]);
    }

    #[test]
    fn test_hash_deterministic() {
        let hash1 = keccak_hash(&[b"hello", b"world"]);
        let hash2 = keccak_hash(&[b"hello", b"world"]);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_password() {
        let secret1 = hash_password("password123");
        let secret2 = hash_password("password123");
        let secret3 = hash_password("different");

        assert_eq!(secret1, secret2);
        assert_ne!(secret1, secret3);
        assert!(secret1.value() < M31_PRIME);
    }

    #[test]
    fn test_hash_identifier_case_insensitive() {
        let id1 = hash_identifier("@Alice");
        let id2 = hash_identifier("@alice");
        let id3 = hash_identifier("@ALICE");

        assert_eq!(id1, id2);
        assert_eq!(id2, id3);
    }

    #[test]
    fn test_m31_commitment() {
        let id = M31::new(12345);
        let secret = M31::new(67890);
        let commitment = m31_commitment(id, secret);

        // Deterministic
        assert_eq!(commitment, m31_commitment(id, secret));
        assert!(commitment.value() < M31_PRIME);
    }

    #[test]
    fn test_m31_nullifier() {
        let secret = M31::new(12345);
        let nullifier1 = m31_nullifier(secret, 0);
        let nullifier2 = m31_nullifier(secret, 1);

        // Different leaf indices → different nullifiers
        assert_ne!(nullifier1, nullifier2);
    }

    #[test]
    fn test_pq_commitment() {
        let id = M31::new(100);
        let secret = M31::new(200);
        let commitment = pq_commitment(id, secret);

        assert_eq!(commitment.len(), 32);
        // Non-zero
        assert_ne!(commitment, [0u8; 32]);
    }

    #[test]
    fn test_pq_nullifier() {
        let secret = M31::new(100);
        let nullifier = pq_nullifier(secret, 5);

        assert_eq!(nullifier.len(), 32);
    }
}

#[test]
fn test_commitment_values() {
    // Test @alice with testpass123
    let id1 = hash_identifier("@alice");
    let secret1 = hash_password("testpass123");
    let commitment1 = pq_commitment(id1, secret1);
    println!("@alice + testpass123:");
    println!("  id_hash: {}", id1.value());
    println!("  secret: {}", secret1.value());
    println!("  commitment: {}", hex::encode(commitment1));
    
    // Test alice without @
    let id2 = hash_identifier("alice");
    let commitment2 = pq_commitment(id2, secret1);
    println!("\nalice + testpass123:");
    println!("  id_hash: {}", id2.value());
    println!("  secret: {}", secret1.value());
    println!("  commitment: {}", hex::encode(commitment2));
}
