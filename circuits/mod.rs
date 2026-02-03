//! Murkl ZK Constraints
//!
//! Cryptographic primitives for anonymous social transfers.
//! Uses Circle STARKs over M31 - no trusted setup, no ceremony.

pub mod m31;
pub mod circle;
pub mod hash;      // Simple M31-native hash (replaces Poseidon)
pub mod merkle;
pub mod stark_circuit;
pub mod prover;

// Legacy alias for compatibility
pub mod poseidon {
    pub use super::hash::*;
}

// Re-exports for convenience
pub use m31::M31;
pub use circle::{CirclePoint, CIRCLE_GENERATOR};
pub use hash::{hash, hash2, commitment, nullifier};
pub use merkle::{MerkleTree, MerklePath, MerkleWitness, TREE_DEPTH};
pub use stark_circuit::{MurklClaim, MurklPublicInputs, MurklWitness as ClaimWitness};
pub use prover::{MurklComponent, MurklEval, generate_stwo_trace};
