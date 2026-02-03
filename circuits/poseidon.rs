//! Poseidon hash function over M31 for Murkl
//!
//! Poseidon is a ZK-friendly hash function designed for efficient
//! proving in arithmetic circuits. We use it for:
//! - Commitment hashes: hash(identifier || secret)
//! - Merkle tree internal nodes
//! - Nullifier computation
//!
//! This implementation uses parameters suitable for M31 field.

use super::m31::M31;

/// Poseidon state width (t = rate + capacity)
pub const STATE_WIDTH: usize = 3;

/// Rate (number of elements absorbed per permutation)  
pub const RATE: usize = 2;

/// Number of full rounds
pub const FULL_ROUNDS: usize = 8;

/// Number of partial rounds
pub const PARTIAL_ROUNDS: usize = 56;

/// Round constants for Poseidon over M31
/// These should be generated securely (e.g., from hash of nothing-up-my-sleeve string)
/// For now, using placeholder constants - MUST be replaced with proper ones
const ROUND_CONSTANTS: [[u32; STATE_WIDTH]; FULL_ROUNDS + PARTIAL_ROUNDS] = 
    include!("poseidon_constants.txt");

/// MDS matrix for Poseidon over M31 (3x3)
/// This should be a secure MDS matrix for the M31 field
const MDS_MATRIX: [[u32; STATE_WIDTH]; STATE_WIDTH] = [
    [2, 1, 1],
    [1, 2, 1],
    [1, 1, 2],
];

/// Poseidon permutation state
#[derive(Clone, Debug)]
pub struct PoseidonState {
    state: [M31; STATE_WIDTH],
}

impl PoseidonState {
    /// Create a new state initialized to zero
    pub fn new() -> Self {
        Self {
            state: [M31::ZERO; STATE_WIDTH],
        }
    }

    /// S-box: x^5 (common choice for ZK-friendly hashes)
    #[inline]
    fn sbox(x: M31) -> M31 {
        let x2 = x.square();
        let x4 = x2.square();
        x4 * x
    }

    /// Apply MDS matrix multiplication
    fn apply_mds(&mut self) {
        let mut new_state = [M31::ZERO; STATE_WIDTH];
        
        for i in 0..STATE_WIDTH {
            for j in 0..STATE_WIDTH {
                new_state[i] += self.state[j] * M31::new(MDS_MATRIX[i][j]);
            }
        }
        
        self.state = new_state;
    }

    /// Add round constants
    fn add_round_constants(&mut self, round: usize) {
        for i in 0..STATE_WIDTH {
            self.state[i] += M31::new(ROUND_CONSTANTS[round][i]);
        }
    }

    /// Full round: S-box on all elements
    fn full_round(&mut self, round: usize) {
        // Add round constants
        self.add_round_constants(round);
        
        // S-box on all elements
        for i in 0..STATE_WIDTH {
            self.state[i] = Self::sbox(self.state[i]);
        }
        
        // MDS mixing
        self.apply_mds();
    }

    /// Partial round: S-box only on first element
    fn partial_round(&mut self, round: usize) {
        // Add round constants
        self.add_round_constants(round);
        
        // S-box only on first element
        self.state[0] = Self::sbox(self.state[0]);
        
        // MDS mixing
        self.apply_mds();
    }

    /// Run the full Poseidon permutation
    pub fn permute(&mut self) {
        let half_full = FULL_ROUNDS / 2;
        let mut round = 0;
        
        // First half of full rounds
        for _ in 0..half_full {
            self.full_round(round);
            round += 1;
        }
        
        // Partial rounds
        for _ in 0..PARTIAL_ROUNDS {
            self.partial_round(round);
            round += 1;
        }
        
        // Second half of full rounds
        for _ in 0..half_full {
            self.full_round(round);
            round += 1;
        }
    }

    /// Absorb elements into the state (sponge construction)
    pub fn absorb(&mut self, inputs: &[M31]) {
        for chunk in inputs.chunks(RATE) {
            for (i, &input) in chunk.iter().enumerate() {
                self.state[i] += input;
            }
            self.permute();
        }
    }

    /// Squeeze one element from the state
    pub fn squeeze(&self) -> M31 {
        self.state[0]
    }

    /// Squeeze multiple elements
    pub fn squeeze_n(&mut self, n: usize) -> Vec<M31> {
        let mut output = Vec::with_capacity(n);
        
        while output.len() < n {
            for i in 0..RATE.min(n - output.len()) {
                output.push(self.state[i]);
            }
            if output.len() < n {
                self.permute();
            }
        }
        
        output
    }
}

impl Default for PoseidonState {
    fn default() -> Self {
        Self::new()
    }
}

/// Hash two M31 elements (for Merkle tree)
pub fn hash2(a: M31, b: M31) -> M31 {
    let mut state = PoseidonState::new();
    state.absorb(&[a, b]);
    state.squeeze()
}

/// Hash arbitrary number of M31 elements
pub fn hash(inputs: &[M31]) -> M31 {
    let mut state = PoseidonState::new();
    state.absorb(inputs);
    state.squeeze()
}

/// Compute commitment: hash(identifier || secret)
pub fn commitment(identifier: M31, secret: M31) -> M31 {
    hash2(identifier, secret)
}

/// Compute nullifier: hash(secret || leaf_index)
pub fn nullifier(secret: M31, leaf_index: u32) -> M31 {
    hash2(secret, M31::new(leaf_index))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sbox() {
        let x = M31::new(2);
        let x5 = PoseidonState::sbox(x);
        assert_eq!(x5.value(), 32); // 2^5 = 32
    }

    #[test]
    fn test_hash_deterministic() {
        let a = M31::new(123);
        let b = M31::new(456);
        
        let h1 = hash2(a, b);
        let h2 = hash2(a, b);
        
        assert_eq!(h1.value(), h2.value());
    }

    #[test]
    fn test_hash_different_inputs() {
        let h1 = hash2(M31::new(1), M31::new(2));
        let h2 = hash2(M31::new(1), M31::new(3));
        
        assert_ne!(h1.value(), h2.value());
    }

    #[test]
    fn test_commitment_nullifier() {
        let identifier = M31::new(12345); // hash of email
        let secret = M31::new(98765);
        let leaf_idx = 42u32;
        
        let comm = commitment(identifier, secret);
        let null = nullifier(secret, leaf_idx);
        
        // Should be different
        assert_ne!(comm.value(), null.value());
        
        // Should be deterministic
        assert_eq!(comm.value(), commitment(identifier, secret).value());
        assert_eq!(null.value(), nullifier(secret, leaf_idx).value());
    }
}
