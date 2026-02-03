//! Common types for the Murkl prover
//!
//! Defines Proof, PublicInputs, Witness, and other shared types.

#[cfg(not(feature = "std"))]
use alloc::{vec::Vec, string::String};

use crate::fri::FriProof;
use crate::m31::M31;
use crate::merkle::Hash;
use crate::prover::QueryProof;

/// A STARK proof
#[derive(Clone, Debug)]
pub struct Proof {
    /// Merkle roots for trace column commitments
    pub trace_commitment: Vec<Hash>,
    /// Merkle root for composition polynomial
    pub composition_root: Hash,
    /// FRI proof for low-degree testing
    pub fri_proof: FriProof,
    /// Query proofs (openings at sampled points)
    pub query_proofs: Vec<QueryProof>,
    /// Public inputs
    pub public_inputs: PublicInputs,
}

impl Proof {
    /// Serialize the proof to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();

        // Trace commitments
        bytes.extend_from_slice(&(self.trace_commitment.len() as u32).to_le_bytes());
        for root in &self.trace_commitment {
            bytes.extend_from_slice(root);
        }

        // Composition root
        bytes.extend_from_slice(&self.composition_root);

        // FRI proof (simplified serialization)
        bytes.extend_from_slice(&(self.fri_proof.layer_commitments.len() as u32).to_le_bytes());
        for layer in &self.fri_proof.layer_commitments {
            bytes.extend_from_slice(&layer.root);
            bytes.extend_from_slice(&layer.log_size.to_le_bytes());
        }

        bytes.extend_from_slice(&(self.fri_proof.final_poly.len() as u32).to_le_bytes());
        for coeff in &self.fri_proof.final_poly {
            bytes.extend_from_slice(&coeff.to_le_bytes());
        }

        // Public inputs
        bytes.extend_from_slice(&(self.public_inputs.initial_state.len() as u32).to_le_bytes());
        for val in &self.public_inputs.initial_state {
            bytes.extend_from_slice(&val.to_le_bytes());
        }

        bytes.extend_from_slice(&(self.public_inputs.final_state.len() as u32).to_le_bytes());
        for val in &self.public_inputs.final_state {
            bytes.extend_from_slice(&val.to_le_bytes());
        }

        bytes
    }

    /// Approximate proof size in bytes
    pub fn size(&self) -> usize {
        // This is an approximation
        let trace_size = self.trace_commitment.len() * 32;
        let composition_size = 32;
        let fri_size = self.fri_proof.layer_commitments.len() * 36
            + self.fri_proof.final_poly.len() * 4;
        let query_size = self.query_proofs.len() * 100; // Approximate

        trace_size + composition_size + fri_size + query_size
    }
}

/// Public inputs to the STARK
#[derive(Clone, Debug, Default)]
pub struct PublicInputs {
    /// Initial state values
    pub initial_state: Vec<M31>,
    /// Final state values
    pub final_state: Vec<M31>,
}

impl PublicInputs {
    /// Create new public inputs
    pub fn new(initial_state: Vec<M31>, final_state: Vec<M31>) -> Self {
        Self {
            initial_state,
            final_state,
        }
    }

    /// Create empty public inputs
    pub fn empty() -> Self {
        Self::default()
    }

    /// Check if public inputs are empty
    pub fn is_empty(&self) -> bool {
        self.initial_state.is_empty() && self.final_state.is_empty()
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::new();

        bytes.extend_from_slice(&(self.initial_state.len() as u32).to_le_bytes());
        for val in &self.initial_state {
            bytes.extend_from_slice(&val.to_le_bytes());
        }

        bytes.extend_from_slice(&(self.final_state.len() as u32).to_le_bytes());
        for val in &self.final_state {
            bytes.extend_from_slice(&val.to_le_bytes());
        }

        bytes
    }

    /// Hash the public inputs
    pub fn hash(&self) -> Hash {
        crate::merkle::hash_bytes(&self.to_bytes())
    }
}

/// Private witness for a proof
#[derive(Clone, Debug)]
pub struct Witness {
    /// Witness values (private inputs)
    pub values: Vec<M31>,
    /// Optional auxiliary data
    pub aux_data: Option<Vec<u8>>,
}

impl Witness {
    /// Create a new witness
    pub fn new(values: Vec<M31>) -> Self {
        Self {
            values,
            aux_data: None,
        }
    }

    /// Create witness with auxiliary data
    pub fn with_aux(values: Vec<M31>, aux_data: Vec<u8>) -> Self {
        Self {
            values,
            aux_data: Some(aux_data),
        }
    }

    /// Create empty witness
    pub fn empty() -> Self {
        Self::new(vec![])
    }

    /// Check if witness is empty
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Get value at index
    pub fn get(&self, index: usize) -> Option<M31> {
        self.values.get(index).copied()
    }
}

impl Default for Witness {
    fn default() -> Self {
        Self::empty()
    }
}

/// Proof generation/verification errors
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProofError {
    /// Invalid witness
    InvalidWitness(String),
    /// Constraint violation
    ConstraintViolation(String),
    /// Invalid trace
    InvalidTrace(String),
    /// FRI error
    FriError(String),
    /// Merkle error
    MerkleError(String),
    /// Serialization error
    SerializationError(String),
    /// Other error
    Other(String),
}

impl ProofError {
    /// Create an invalid witness error
    pub fn invalid_witness(msg: impl Into<String>) -> Self {
        Self::InvalidWitness(msg.into())
    }

    /// Create a constraint violation error
    pub fn constraint_violation(msg: impl Into<String>) -> Self {
        Self::ConstraintViolation(msg.into())
    }

    /// Create an invalid trace error
    pub fn invalid_trace(msg: impl Into<String>) -> Self {
        Self::InvalidTrace(msg.into())
    }
}

impl core::fmt::Display for ProofError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::InvalidWitness(msg) => write!(f, "Invalid witness: {}", msg),
            Self::ConstraintViolation(msg) => write!(f, "Constraint violation: {}", msg),
            Self::InvalidTrace(msg) => write!(f, "Invalid trace: {}", msg),
            Self::FriError(msg) => write!(f, "FRI error: {}", msg),
            Self::MerkleError(msg) => write!(f, "Merkle error: {}", msg),
            Self::SerializationError(msg) => write!(f, "Serialization error: {}", msg),
            Self::Other(msg) => write!(f, "Error: {}", msg),
        }
    }
}

#[cfg(feature = "std")]
impl std::error::Error for ProofError {}

/// Murkl-specific types for privacy protocol

/// Murkl claim (for Merkle membership proofs)
#[derive(Clone, Debug)]
pub struct MurklClaim {
    /// Public inputs
    pub public_inputs: MurklPublicInputs,
    /// Private witness
    pub witness: MurklWitness,
}

/// Public inputs for Murkl proofs
#[derive(Clone, Debug)]
pub struct MurklPublicInputs {
    /// Merkle tree root
    pub merkle_root: M31,
    /// Nullifier (prevents double-spend)
    pub nullifier: M31,
    /// Recipient address
    pub recipient: M31,
}

impl MurklPublicInputs {
    /// Convert to generic PublicInputs
    pub fn to_public_inputs(&self) -> PublicInputs {
        PublicInputs {
            initial_state: vec![self.merkle_root],
            final_state: vec![self.nullifier, self.recipient],
        }
    }
}

/// Private witness for Murkl proofs
#[derive(Clone, Debug)]
pub struct MurklWitness {
    /// Leaf commitment
    pub leaf: M31,
    /// Secret value
    pub secret: M31,
    /// Identifier hash
    pub identifier: M31,
    /// Leaf index in tree
    pub leaf_index: u32,
    /// Merkle path siblings
    pub siblings: Vec<M31>,
    /// Path bits (0 = left, 1 = right)
    pub path_bits: Vec<bool>,
}

impl MurklWitness {
    /// Create from tree depth
    pub fn new(tree_depth: usize) -> Self {
        Self {
            leaf: M31::ZERO,
            secret: M31::ZERO,
            identifier: M31::ZERO,
            leaf_index: 0,
            siblings: vec![M31::ZERO; tree_depth],
            path_bits: vec![false; tree_depth],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fri::{FriLayerCommitment, FriProof, FriQueryProof};

    #[test]
    fn test_public_inputs() {
        let inputs = PublicInputs::new(
            vec![M31::new(1), M31::new(2)],
            vec![M31::new(3)],
        );

        assert!(!inputs.is_empty());
        assert_eq!(inputs.initial_state.len(), 2);
        assert_eq!(inputs.final_state.len(), 1);
    }

    #[test]
    fn test_public_inputs_empty() {
        let inputs = PublicInputs::empty();
        assert!(inputs.is_empty());
    }

    #[test]
    fn test_public_inputs_serialization() {
        let inputs = PublicInputs::new(
            vec![M31::new(100), M31::new(200)],
            vec![M31::new(300)],
        );

        let bytes = inputs.to_bytes();
        assert!(!bytes.is_empty());

        // Check structure: 4 bytes length + 2*4 bytes initial + 4 bytes length + 1*4 bytes final
        assert_eq!(bytes.len(), 4 + 8 + 4 + 4);
    }

    #[test]
    fn test_witness() {
        let witness = Witness::new(vec![M31::new(1), M31::new(2), M31::new(3)]);

        assert!(!witness.is_empty());
        assert_eq!(witness.get(0), Some(M31::new(1)));
        assert_eq!(witness.get(1), Some(M31::new(2)));
        assert_eq!(witness.get(99), None);
    }

    #[test]
    fn test_witness_with_aux() {
        let witness = Witness::with_aux(
            vec![M31::new(1)],
            vec![0xDE, 0xAD, 0xBE, 0xEF],
        );

        assert!(witness.aux_data.is_some());
        assert_eq!(witness.aux_data.as_ref().unwrap().len(), 4);
    }

    #[test]
    fn test_proof_size() {
        let proof = Proof {
            trace_commitment: vec![[0u8; 32]; 5],
            composition_root: [0u8; 32],
            fri_proof: FriProof {
                layer_commitments: vec![
                    FriLayerCommitment { root: [0u8; 32], log_size: 10 },
                    FriLayerCommitment { root: [0u8; 32], log_size: 8 },
                ],
                query_proofs: vec![],
                final_poly: vec![M31::ONE; 4],
            },
            query_proofs: vec![],
            public_inputs: PublicInputs::empty(),
        };

        let size = proof.size();
        assert!(size > 0);
    }

    #[test]
    fn test_proof_serialization() {
        let proof = Proof {
            trace_commitment: vec![[1u8; 32]],
            composition_root: [2u8; 32],
            fri_proof: FriProof {
                layer_commitments: vec![],
                query_proofs: vec![],
                final_poly: vec![M31::new(42)],
            },
            query_proofs: vec![],
            public_inputs: PublicInputs::new(vec![M31::new(1)], vec![]),
        };

        let bytes = proof.to_bytes();
        assert!(!bytes.is_empty());
    }

    #[test]
    fn test_murkl_claim() {
        let claim = MurklClaim {
            public_inputs: MurklPublicInputs {
                merkle_root: M31::new(12345),
                nullifier: M31::new(67890),
                recipient: M31::new(11111),
            },
            witness: MurklWitness::new(16),
        };

        assert_eq!(claim.witness.siblings.len(), 16);
        assert_eq!(claim.witness.path_bits.len(), 16);
    }

    #[test]
    fn test_murkl_public_inputs_conversion() {
        let murkl_inputs = MurklPublicInputs {
            merkle_root: M31::new(100),
            nullifier: M31::new(200),
            recipient: M31::new(300),
        };

        let generic = murkl_inputs.to_public_inputs();
        assert_eq!(generic.initial_state.len(), 1);
        assert_eq!(generic.final_state.len(), 2);
    }

    #[test]
    fn test_proof_error_display() {
        let err = ProofError::invalid_witness("test error");
        assert!(err.to_string().contains("Invalid witness"));

        let err = ProofError::constraint_violation("bad constraint");
        assert!(err.to_string().contains("Constraint violation"));
    }
}
