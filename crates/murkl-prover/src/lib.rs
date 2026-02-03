//! Murkl Prover - Circle STARK proof generation library
//!
//! This crate provides cryptographic primitives for generating and verifying
//! Circle STARK proofs for the Murkl privacy protocol.
//!
//! # Features
//!
//! - `std` - Enable standard library features (default)
//! - `simd` - Enable SIMD optimizations for M31 field operations
//! - `wasm` - Enable WebAssembly support
//!
//! # Components
//!
//! - `m31` - Mersenne-31 field implementation with optional SIMD
//! - `circle` - Circle group operations for Circle STARKs
//! - `merkle` - Keccak256-based Merkle tree
//! - `fri` - FRI (Fast Reed-Solomon IOPP) protocol
//! - `air` - Algebraic Intermediate Representation constraints
//! - `prover` - Proof generation
//! - `verifier` - Proof verification (for testing)
//! - `types` - Common types (Proof, PublicInputs, etc.)

#![cfg_attr(not(feature = "std"), no_std)]
#![cfg_attr(feature = "simd", feature(portable_simd))]

#[cfg(not(feature = "std"))]
extern crate alloc;

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};

pub mod m31;
pub mod circle;
pub mod merkle;
pub mod fri;
pub mod air;
pub mod prover;
pub mod verifier;
pub mod types;

// Re-exports for convenience
pub use m31::{M31, M31_PRIME};
pub use circle::{CirclePoint, CIRCLE_GENERATOR};
pub use merkle::{MerkleTree, MerklePath, TREE_DEPTH};
pub use fri::{FriConfig, FriProof};
pub use air::{AirConfig, TraceColumn};
pub use prover::{Prover, ProverConfig};
pub use verifier::Verifier;
pub use types::{Proof, PublicInputs, Witness, ProofError};

/// Prelude module for convenient imports
pub mod prelude {
    pub use crate::m31::{M31, M31_PRIME};
    pub use crate::circle::{CirclePoint, CIRCLE_GENERATOR};
    pub use crate::merkle::{MerkleTree, MerklePath};
    pub use crate::types::{Proof, PublicInputs, Witness};
    pub use crate::prover::Prover;
    pub use crate::verifier::Verifier;
}
