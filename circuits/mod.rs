//! Murkl ZK Circuits
//!
//! Cryptographic primitives for anonymous social transfers.

pub mod m31;
pub mod circle;
pub mod poseidon;
pub mod merkle;

// Re-exports for convenience
pub use m31::M31;
pub use circle::{CirclePoint, CIRCLE_GENERATOR};
pub use poseidon::{hash, hash2, commitment, nullifier};
pub use merkle::{MerkleTree, MerklePath, MerkleWitness, TREE_DEPTH};
