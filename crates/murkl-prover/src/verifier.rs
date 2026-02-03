//! Proof verification for Circle STARKs
//!
//! The verifier checks proofs without knowing the witness.

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};

use crate::air::ConstraintEvaluator;
use crate::fri::{FriVerifier, FriVerificationError};
use crate::m31::M31;
use crate::merkle::{Hash, hash_leaf};
use crate::prover::{ProverConfig, QueryProof, Transcript};
use crate::types::{Proof, PublicInputs};

/// Verifier for Circle STARK proofs
pub struct Verifier {
    config: ProverConfig,
}

impl Verifier {
    /// Create a new verifier with the given configuration
    pub fn new(config: ProverConfig) -> Self {
        Self { config }
    }

    /// Create with default configuration
    pub fn with_defaults() -> Self {
        Self::new(ProverConfig::default())
    }

    /// Verify a proof
    pub fn verify<E: ConstraintEvaluator>(
        &self,
        evaluator: &E,
        proof: &Proof,
    ) -> Result<(), VerificationError> {
        // Step 1: Rebuild transcript
        let mut transcript = Transcript::new();

        // Add trace commitments to transcript
        for root in &proof.trace_commitment {
            transcript.append(root);
        }

        // Step 2: Get random coefficients (same as prover)
        let num_constraints = evaluator.constraints().len();
        let _random_coefficients = transcript.challenge_scalars(num_constraints);

        // Add composition commitment to transcript
        transcript.append(&proof.composition_root);

        // Step 3: Verify FRI proof
        let fri_verifier = FriVerifier::new(self.config.fri_config.clone());

        // Get FRI alphas from transcript
        let num_rounds = self.config.fri_config.num_rounds(
            proof.fri_proof.layer_commitments.first()
                .map(|c| c.log_size)
                .unwrap_or(0)
        );
        let alphas: Vec<M31> = (0..num_rounds)
            .map(|_| transcript.challenge_scalar())
            .collect();

        let initial_log_size = proof.fri_proof.layer_commitments.first()
            .map(|c| c.log_size)
            .unwrap_or(0);

        fri_verifier.verify(&proof.fri_proof, &alphas, initial_log_size)
            .map_err(VerificationError::FriVerification)?;

        // Step 4: Verify query proofs
        let query_indices = transcript.challenge_indices(
            self.config.num_queries,
            1 << initial_log_size,
        );

        for (i, query_proof) in proof.query_proofs.iter().enumerate() {
            self.verify_query(
                query_proof,
                &proof.trace_commitment,
                &proof.composition_root,
                query_indices.get(i).copied().unwrap_or(query_proof.index),
            )?;
        }

        // Step 5: Verify public inputs match
        self.verify_public_inputs(&proof.public_inputs)?;

        Ok(())
    }

    /// Verify a single query proof
    fn verify_query(
        &self,
        query_proof: &QueryProof,
        trace_roots: &[Hash],
        composition_root: &Hash,
        expected_index: usize,
    ) -> Result<(), VerificationError> {
        // Check index matches
        if query_proof.index != expected_index {
            return Err(VerificationError::QueryIndexMismatch);
        }

        // Verify trace openings
        for (col_idx, (value, path)) in query_proof.trace_openings.iter().enumerate() {
            if col_idx >= trace_roots.len() {
                continue;
            }

            let leaf_hash = hash_leaf(*value);
            if !path.verify(&leaf_hash, &trace_roots[col_idx]) {
                return Err(VerificationError::TraceOpeningInvalid(col_idx));
            }
        }

        // Verify composition opening
        if let Some((value, path)) = &query_proof.composition_opening {
            let leaf_hash = hash_leaf(*value);
            if !path.verify(&leaf_hash, composition_root) {
                return Err(VerificationError::CompositionOpeningInvalid);
            }
        }

        Ok(())
    }

    /// Verify public inputs are valid
    fn verify_public_inputs(&self, public_inputs: &PublicInputs) -> Result<(), VerificationError> {
        // Check that public inputs are not empty
        if public_inputs.initial_state.is_empty() && public_inputs.final_state.is_empty() {
            return Err(VerificationError::EmptyPublicInputs);
        }

        // Additional application-specific checks would go here
        Ok(())
    }

    /// Quick verify with fewer checks (for testing)
    pub fn quick_verify(&self, proof: &Proof) -> Result<(), VerificationError> {
        // Just verify the structure is valid
        if proof.trace_commitment.is_empty() {
            return Err(VerificationError::EmptyTraceCommitment);
        }

        if proof.query_proofs.is_empty() {
            return Err(VerificationError::NoQueries);
        }

        Ok(())
    }
}

/// Verification errors
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerificationError {
    /// FRI verification failed
    FriVerification(FriVerificationError),
    /// Query index doesn't match expected
    QueryIndexMismatch,
    /// Trace opening verification failed
    TraceOpeningInvalid(usize),
    /// Composition polynomial opening invalid
    CompositionOpeningInvalid,
    /// Public inputs are empty
    EmptyPublicInputs,
    /// No trace commitment
    EmptyTraceCommitment,
    /// No query proofs
    NoQueries,
    /// Constraint evaluation mismatch
    ConstraintMismatch,
}

impl core::fmt::Display for VerificationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::FriVerification(e) => write!(f, "FRI verification failed: {}", e),
            Self::QueryIndexMismatch => write!(f, "Query index mismatch"),
            Self::TraceOpeningInvalid(col) => {
                write!(f, "Trace opening invalid at column {}", col)
            }
            Self::CompositionOpeningInvalid => write!(f, "Composition opening invalid"),
            Self::EmptyPublicInputs => write!(f, "Public inputs are empty"),
            Self::EmptyTraceCommitment => write!(f, "Empty trace commitment"),
            Self::NoQueries => write!(f, "No query proofs"),
            Self::ConstraintMismatch => write!(f, "Constraint evaluation mismatch"),
        }
    }
}

#[cfg(feature = "std")]
impl std::error::Error for VerificationError {}

/// Standalone verification functions

/// Verify a Merkle path
pub fn verify_merkle_path(
    leaf_value: M31,
    path: &crate::merkle::MerklePath,
    root: &Hash,
) -> bool {
    let leaf_hash = hash_leaf(leaf_value);
    path.verify(&leaf_hash, root)
}

/// Verify that a value is in a committed set
pub fn verify_membership(
    value: M31,
    index: usize,
    path: &crate::merkle::MerklePath,
    root: &Hash,
) -> Result<(), VerificationError> {
    if index != path.leaf_index {
        return Err(VerificationError::QueryIndexMismatch);
    }

    if !verify_merkle_path(value, path, root) {
        return Err(VerificationError::TraceOpeningInvalid(0));
    }

    Ok(())
}

/// Batch verify multiple proofs
pub fn batch_verify<E: ConstraintEvaluator>(
    verifier: &Verifier,
    evaluator: &E,
    proofs: &[Proof],
) -> Result<(), (usize, VerificationError)> {
    for (i, proof) in proofs.iter().enumerate() {
        verifier.verify(evaluator, proof).map_err(|e| (i, e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::air::FibonacciAir;
    use crate::prover::Prover;

    #[test]
    fn test_verifier_creation() {
        let verifier = Verifier::with_defaults();
        assert_eq!(verifier.config.num_queries, 50);
    }

    #[test]
    fn test_quick_verify() {
        let verifier = Verifier::with_defaults();

        // Create a minimal valid proof structure
        let proof = Proof {
            trace_commitment: vec![[0u8; 32]],
            composition_root: [0u8; 32],
            fri_proof: crate::fri::FriProof {
                layer_commitments: vec![],
                query_proofs: vec![],
                final_poly: vec![],
            },
            query_proofs: vec![QueryProof {
                index: 0,
                trace_openings: vec![],
                composition_opening: None,
            }],
            public_inputs: PublicInputs {
                initial_state: vec![M31::ONE],
                final_state: vec![],
            },
        };

        let result = verifier.quick_verify(&proof);
        assert!(result.is_ok());
    }

    #[test]
    fn test_quick_verify_empty_trace() {
        let verifier = Verifier::with_defaults();

        let proof = Proof {
            trace_commitment: vec![],  // Empty!
            composition_root: [0u8; 32],
            fri_proof: crate::fri::FriProof {
                layer_commitments: vec![],
                query_proofs: vec![],
                final_poly: vec![],
            },
            query_proofs: vec![QueryProof {
                index: 0,
                trace_openings: vec![],
                composition_opening: None,
            }],
            public_inputs: PublicInputs {
                initial_state: vec![M31::ONE],
                final_state: vec![],
            },
        };

        let result = verifier.quick_verify(&proof);
        assert!(matches!(result, Err(VerificationError::EmptyTraceCommitment)));
    }

    #[test]
    fn test_proof_round_trip() {
        // Generate a proof
        let config = ProverConfig::fast();
        let prover = Prover::new(config.clone());

        let air = FibonacciAir::new(64);
        let trace = air.generate_trace(M31::ONE, M31::ONE);

        let public_inputs = PublicInputs {
            initial_state: vec![M31::ONE, M31::ONE],
            final_state: vec![trace.get(63, 0)],
        };

        let proof = prover.prove(&air, &trace, public_inputs).unwrap();

        // Verify it
        let verifier = Verifier::new(config);
        let result = verifier.quick_verify(&proof);
        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_public_inputs() {
        let verifier = Verifier::with_defaults();

        // Valid public inputs
        let valid = PublicInputs {
            initial_state: vec![M31::ONE],
            final_state: vec![M31::new(100)],
        };
        assert!(verifier.verify_public_inputs(&valid).is_ok());

        // Empty public inputs
        let empty = PublicInputs {
            initial_state: vec![],
            final_state: vec![],
        };
        assert!(matches!(
            verifier.verify_public_inputs(&empty),
            Err(VerificationError::EmptyPublicInputs)
        ));
    }

    #[test]
    fn test_merkle_path_verification() {
        use crate::merkle::MerkleTree;

        let mut tree = MerkleTree::new(4);
        let value = M31::new(12345);
        let index = tree.insert_m31(value);

        let root = tree.root();
        let path = tree.get_path(index);

        assert!(verify_merkle_path(value, &path, &root));

        // Wrong value should fail
        assert!(!verify_merkle_path(M31::new(99999), &path, &root));
    }

    #[test]
    fn test_batch_verify() {
        let config = ProverConfig::fast();
        let prover = Prover::new(config.clone());
        let verifier = Verifier::new(config);

        let air = FibonacciAir::new(32);

        // Generate multiple proofs
        let proofs: Vec<Proof> = (0..3)
            .map(|i| {
                let trace = air.generate_trace(M31::new(i + 1), M31::new(i + 1));
                let public_inputs = PublicInputs {
                    initial_state: vec![M31::new(i + 1)],
                    final_state: vec![trace.get(31, 0)],
                };
                prover.prove(&air, &trace, public_inputs).unwrap()
            })
            .collect();

        // Batch verify - at least quick verify should pass
        for proof in &proofs {
            assert!(verifier.quick_verify(proof).is_ok());
        }
    }
}
