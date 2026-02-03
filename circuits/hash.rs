//! Simple M31-native hash functions for Murkl
//!
//! Uses pure field operations - trivial to constrain in Circle STARKs.
//! STWO handles Blake3 internally for FRI/commitment scheme.

use super::m31::M31;

/// Mixing constants (arbitrary primes, nothing-up-my-sleeve)
const MIX_A: u32 = 0x9e3779b9; // Golden ratio derivative
const MIX_B: u32 = 0x517cc1b7; // Random prime
const MIX_C: u32 = 0x2545f491; // Random prime

/// Hash two M31 elements into one
/// Simple algebraic construction: mix + square + combine
#[inline]
pub fn hash2(a: M31, b: M31) -> M31 {
    // Add constant to avoid hash(0,0) = 0
    let x = a + b * M31::new(MIX_A) + M31::ONE;
    // Non-linearity (squaring)
    let y = x * x;
    // Final mix with another constant
    y + a * M31::new(MIX_B) + b * M31::new(MIX_C) + M31::new(MIX_A)
}

/// Hash a single M31 element (for leaf hashing)
#[inline]
pub fn hash(x: M31) -> M31 {
    hash2(x, M31::new(MIX_A))
}

/// Create a commitment from identifier and secret
/// commitment = hash(hash(identifier) + hash(secret) * MIX)
#[inline]
pub fn commitment(identifier: M31, secret: M31) -> M31 {
    let h_id = hash(identifier);
    let h_sec = hash(secret);
    hash2(h_id, h_sec)
}

/// Create a nullifier from secret and leaf index
/// nullifier = hash(secret, leaf_index)
/// This prevents double-claiming
#[inline]
pub fn nullifier(secret: M31, leaf_index: u32) -> M31 {
    hash2(secret, M31::new(leaf_index))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_deterministic() {
        let a = M31::new(12345);
        let b = M31::new(67890);
        
        let h1 = hash2(a, b);
        let h2 = hash2(a, b);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_different_inputs() {
        let h1 = hash2(M31::new(1), M31::new(2));
        let h2 = hash2(M31::new(2), M31::new(1));
        let h3 = hash2(M31::new(1), M31::new(3));
        
        assert_ne!(h1, h2); // Order matters
        assert_ne!(h1, h3); // Different inputs
    }

    #[test]
    fn test_commitment_nullifier() {
        let identifier = M31::new(0xCAFE);
        let secret = M31::new(0xBEEF);
        let leaf_index = 42u32;

        let comm = commitment(identifier, secret);
        let null = nullifier(secret, leaf_index);

        // Should be deterministic
        assert_eq!(comm, commitment(identifier, secret));
        assert_eq!(null, nullifier(secret, leaf_index));

        // Commitment and nullifier should differ
        assert_ne!(comm, null);
    }

    #[test]
    fn test_no_trivial_collisions() {
        // Ensure hash(0,0) isn't 0
        let h = hash2(M31::ZERO, M31::ZERO);
        assert_ne!(h, M31::ZERO);
    }
}
