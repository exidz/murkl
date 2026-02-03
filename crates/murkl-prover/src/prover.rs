//! Proof generation for Circle STARKs
//!
//! The prover generates proofs of correct execution.

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};

use crate::air::{ConstraintEvaluator, Trace, compose_constraints};
use crate::fri::{FriConfig, FriProof, FriProver};
use crate::m31::M31;
use crate::merkle::{Hash, MerkleCommitment, hash_bytes};
use crate::types::{Proof, ProofError, PublicInputs};

/// Prover configuration
#[derive(Clone, Debug)]
pub struct ProverConfig {
    /// FRI configuration
    pub fri_config: FriConfig,
    /// Security parameter (number of queries)
    pub num_queries: usize,
    /// Blowup factor (log2)
    pub log_blowup_factor: u32,
}

impl Default for ProverConfig {
    fn default() -> Self {
        Self {
            fri_config: FriConfig::default(),
            num_queries: 50,
            log_blowup_factor: 4,
        }
    }
}

impl ProverConfig {
    /// Create a new prover config
    pub fn new(num_queries: usize, log_blowup_factor: u32) -> Self {
        let fri_config = FriConfig::new(
            log_blowup_factor,
            num_queries,
            2,  // log folding factor
            2,  // log final poly degree
        );
        Self {
            fri_config,
            num_queries,
            log_blowup_factor,
        }
    }

    /// High security configuration
    pub fn high_security() -> Self {
        Self::new(100, 4)
    }

    /// Fast configuration (lower security)
    pub fn fast() -> Self {
        Self::new(25, 3)
    }
}

/// Circle STARK prover
pub struct Prover {
    config: ProverConfig,
}

impl Prover {
    /// Create a new prover with the given configuration
    pub fn new(config: ProverConfig) -> Self {
        Self { config }
    }

    /// Create with default configuration
    pub fn with_defaults() -> Self {
        Self::new(ProverConfig::default())
    }

    /// Generate a proof for the given trace and constraints
    pub fn prove<E: ConstraintEvaluator>(
        &self,
        evaluator: &E,
        trace: &Trace,
        public_inputs: PublicInputs,
    ) -> Result<Proof, ProofError> {
        let log_trace_length = trace.log_length();
        // Note: In a full implementation, we'd LDE the composition polynomial
        // For now, use trace length as the domain size
        let log_domain_size = log_trace_length;

        // Step 1: Commit to trace columns
        let trace_commitments = self.commit_trace(trace);

        // Step 2: Evaluate constraints
        let constraint_evals = self.evaluate_constraints(evaluator, trace);

        // Step 3: Get random coefficients (Fiat-Shamir from transcript)
        let mut transcript = Transcript::new();
        for commitment in &trace_commitments {
            transcript.append(&commitment.root());
        }

        let num_constraints = constraint_evals.first().map(|c| c.len()).unwrap_or(0);
        let random_coefficients = transcript.challenge_scalars(num_constraints);

        // Step 4: Compose constraints into a single polynomial
        let composition = compose_constraints(&constraint_evals, &random_coefficients);

        // Step 5: Commit to composition polynomial
        let composition_commitment = MerkleCommitment::commit(&composition);
        transcript.append(&composition_commitment.root());

        // Step 6: FRI prove
        let fri_proof = self.prove_fri(&composition, log_domain_size, &mut transcript)?;

        // Step 7: Generate query proofs
        let query_indices = transcript.challenge_indices(self.config.num_queries, 1 << log_domain_size);
        let query_proofs = self.generate_query_proofs(
            trace,
            &trace_commitments,
            &composition_commitment,
            &query_indices,
        );

        // Collect all roots
        let trace_roots: Vec<Hash> = trace_commitments.iter().map(|c| c.root()).collect();

        Ok(Proof {
            trace_commitment: trace_roots,
            composition_root: composition_commitment.root(),
            fri_proof,
            query_proofs,
            public_inputs,
        })
    }

    /// Commit to all trace columns
    fn commit_trace(&self, trace: &Trace) -> Vec<MerkleCommitment> {
        trace
            .columns
            .iter()
            .map(|col| MerkleCommitment::commit(&col.values))
            .collect()
    }

    /// Evaluate all constraints at all rows
    fn evaluate_constraints<E: ConstraintEvaluator>(
        &self,
        evaluator: &E,
        trace: &Trace,
    ) -> Vec<Vec<M31>> {
        (0..trace.num_rows)
            .map(|row| evaluator.evaluate(trace, row))
            .collect()
    }

    /// Generate FRI proof for the composition polynomial
    fn prove_fri(
        &self,
        composition: &[M31],
        log_domain_size: u32,
        transcript: &mut Transcript,
    ) -> Result<FriProof, ProofError> {
        let mut fri_prover = FriProver::new(self.config.fri_config.clone());

        // Commit to initial layer
        fri_prover.commit(composition.to_vec(), log_domain_size);

        // Perform FRI folding rounds
        let num_rounds = self.config.fri_config.num_rounds(log_domain_size);
        for _ in 0..num_rounds {
            let alpha = transcript.challenge_scalar();
            fri_prover.fold(alpha);

            // Add commitment to transcript
            let roots = fri_prover.get_roots();
            if let Some(root) = roots.last() {
                transcript.append(root);
            }
        }

        // Generate query indices and proof
        let query_indices = transcript.challenge_indices(
            self.config.num_queries,
            1 << log_domain_size,
        );
        let proof = fri_prover.prove(&query_indices);

        Ok(proof)
    }

    /// Generate query proofs for opening trace and composition at query points
    fn generate_query_proofs(
        &self,
        trace: &Trace,
        trace_commitments: &[MerkleCommitment],
        composition_commitment: &MerkleCommitment,
        query_indices: &[usize],
    ) -> Vec<QueryProof> {
        query_indices
            .iter()
            .map(|&index| {
                let trace_openings: Vec<(M31, crate::merkle::MerklePath)> = trace_commitments
                    .iter()
                    .enumerate()
                    .filter_map(|(col_idx, commitment)| {
                        let value = trace.columns.get(col_idx)?.values.get(index)?;
                        commitment.open(index).map(|(_, path)| (*value, path))
                    })
                    .collect();

                let composition_opening = composition_commitment.open(index);

                QueryProof {
                    index,
                    trace_openings,
                    composition_opening,
                }
            })
            .collect()
    }
}

/// A query proof (trace and composition openings at a single point)
#[derive(Clone, Debug)]
pub struct QueryProof {
    /// Query index
    pub index: usize,
    /// Trace values and Merkle paths at this index
    pub trace_openings: Vec<(M31, crate::merkle::MerklePath)>,
    /// Composition polynomial opening
    pub composition_opening: Option<(M31, crate::merkle::MerklePath)>,
}

/// Transcript for Fiat-Shamir transformation
pub struct Transcript {
    state: Hash,
    counter: u64,
}

impl Transcript {
    /// Create a new transcript
    pub fn new() -> Self {
        Self {
            state: hash_bytes(b"murkl-prover-v1"),
            counter: 0,
        }
    }

    /// Append data to the transcript
    pub fn append(&mut self, data: &Hash) {
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(&self.state);
        combined[32..].copy_from_slice(data);
        self.state = hash_bytes(&combined);
    }

    /// Append M31 value to the transcript
    pub fn append_m31(&mut self, value: M31) {
        let mut combined = [0u8; 36];
        combined[..32].copy_from_slice(&self.state);
        combined[32..36].copy_from_slice(&value.to_le_bytes());
        self.state = hash_bytes(&combined);
    }

    /// Get a challenge scalar
    pub fn challenge_scalar(&mut self) -> M31 {
        self.counter += 1;
        let mut data = [0u8; 40];
        data[..32].copy_from_slice(&self.state);
        data[32..40].copy_from_slice(&self.counter.to_le_bytes());

        let hash = hash_bytes(&data);
        let value = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]);
        M31::new(value)
    }

    /// Get multiple challenge scalars
    pub fn challenge_scalars(&mut self, count: usize) -> Vec<M31> {
        (0..count).map(|_| self.challenge_scalar()).collect()
    }

    /// Get challenge indices (for queries)
    pub fn challenge_indices(&mut self, count: usize, max: usize) -> Vec<usize> {
        let mut indices = Vec::with_capacity(count);

        while indices.len() < count {
            let scalar = self.challenge_scalar();
            let index = (scalar.value() as usize) % max;

            // Ensure unique indices
            if !indices.contains(&index) {
                indices.push(index);
            }
        }

        indices
    }

    /// Get current state hash
    pub fn state(&self) -> Hash {
        self.state
    }
}

impl Default for Transcript {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::air::{FibonacciAir, Trace, TraceColumn};

    #[test]
    fn test_prover_config() {
        let config = ProverConfig::default();
        assert_eq!(config.num_queries, 50);
        assert_eq!(config.log_blowup_factor, 4);
    }

    #[test]
    fn test_transcript() {
        let mut transcript1 = Transcript::new();
        let mut transcript2 = Transcript::new();

        let hash = hash_bytes(b"test data");
        transcript1.append(&hash);
        transcript2.append(&hash);

        // Same inputs should produce same state
        assert_eq!(transcript1.state(), transcript2.state());

        // Challenges should be deterministic
        let c1 = transcript1.challenge_scalar();
        let c2 = transcript2.challenge_scalar();
        assert_eq!(c1.value(), c2.value());
    }

    #[test]
    fn test_transcript_different_inputs() {
        let mut transcript1 = Transcript::new();
        let mut transcript2 = Transcript::new();

        transcript1.append(&hash_bytes(b"data1"));
        transcript2.append(&hash_bytes(b"data2"));

        // Different inputs should produce different challenges
        let c1 = transcript1.challenge_scalar();
        let c2 = transcript2.challenge_scalar();
        assert_ne!(c1.value(), c2.value());
    }

    #[test]
    fn test_challenge_indices() {
        let mut transcript = Transcript::new();
        let indices = transcript.challenge_indices(10, 100);

        // Should have 10 unique indices
        assert_eq!(indices.len(), 10);

        // All should be in range
        for &idx in &indices {
            assert!(idx < 100);
        }

        // Should be unique
        let mut sorted = indices.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), 10);
    }

    #[test]
    fn test_fibonacci_proof_generation() {
        let config = ProverConfig::fast();
        let prover = Prover::new(config);

        let air = FibonacciAir::new(64);
        let trace = air.generate_trace(M31::ONE, M31::ONE);

        let public_inputs = PublicInputs {
            initial_state: vec![M31::ONE, M31::ONE],
            final_state: vec![trace.get(63, 0)],
        };

        let result = prover.prove(&air, &trace, public_inputs);
        assert!(result.is_ok());

        let proof = result.unwrap();
        assert!(!proof.trace_commitment.is_empty());
    }

    #[test]
    fn test_prover_commit_trace() {
        let config = ProverConfig::default();
        let prover = Prover::new(config);

        let trace = Trace::new(vec![
            TraceColumn::new(0, vec![M31::new(1), M31::new(2), M31::new(3), M31::new(4)]),
            TraceColumn::new(1, vec![M31::new(5), M31::new(6), M31::new(7), M31::new(8)]),
        ]);

        let commitments = prover.commit_trace(&trace);
        assert_eq!(commitments.len(), 2);
    }
}
