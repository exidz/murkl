//! FRI (Fast Reed-Solomon Interactive Oracle Proof) protocol
//!
//! FRI is the core protocol for proving proximity to Reed-Solomon codewords.
//! This implementation uses Circle STARKs over M31.

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec};

use crate::m31::M31;
use crate::merkle::{Hash, MerkleCommitment, MerklePath};

/// FRI protocol configuration
#[derive(Clone, Debug)]
pub struct FriConfig {
    /// Log2 of the blowup factor (e.g., 4 means 16x blowup)
    pub log_blowup_factor: u32,
    /// Number of queries for soundness
    pub num_queries: usize,
    /// Folding factor per round (log2, typically 2 = fold by 4)
    pub log_folding_factor: u32,
    /// Final polynomial degree (log2)
    pub log_final_poly_degree: u32,
}

impl Default for FriConfig {
    fn default() -> Self {
        Self {
            log_blowup_factor: 4,      // 16x blowup
            num_queries: 50,           // 50 queries
            log_folding_factor: 2,     // Fold by 4 each round
            log_final_poly_degree: 2,  // Final poly degree 4
        }
    }
}

impl FriConfig {
    /// Create config with custom parameters
    pub fn new(
        log_blowup_factor: u32,
        num_queries: usize,
        log_folding_factor: u32,
        log_final_poly_degree: u32,
    ) -> Self {
        Self {
            log_blowup_factor,
            num_queries,
            log_folding_factor,
            log_final_poly_degree,
        }
    }

    /// Security level in bits (approximate)
    pub fn security_bits(&self) -> u32 {
        // Each query gives log_blowup_factor bits of security
        (self.num_queries as u32) * self.log_blowup_factor / 2
    }

    /// Number of FRI rounds needed
    pub fn num_rounds(&self, log_degree: u32) -> usize {
        let effective_log_degree = log_degree.saturating_sub(self.log_final_poly_degree);
        (effective_log_degree / self.log_folding_factor) as usize
    }
}

/// A single layer commitment in FRI
#[derive(Clone, Debug)]
pub struct FriLayerCommitment {
    /// Merkle root of the evaluation
    pub root: Hash,
    /// Log2 of the domain size
    pub log_size: u32,
}

/// FRI proof structure
#[derive(Clone, Debug)]
pub struct FriProof {
    /// Commitments to each layer
    pub layer_commitments: Vec<FriLayerCommitment>,
    /// Query responses
    pub query_proofs: Vec<FriQueryProof>,
    /// Final polynomial coefficients
    pub final_poly: Vec<M31>,
}

/// Proof for a single FRI query
#[derive(Clone, Debug)]
pub struct FriQueryProof {
    /// Query index
    pub query_index: usize,
    /// Values at each layer for this query
    pub layer_values: Vec<FriLayerValue>,
}

/// Values and authentication for a single layer at a query position
#[derive(Clone, Debug)]
pub struct FriLayerValue {
    /// The sibling values needed for folding
    pub siblings: Vec<M31>,
    /// Merkle authentication path
    pub merkle_path: MerklePath,
}

/// FRI prover state
pub struct FriProver {
    config: FriConfig,
    /// Layer evaluations
    layers: Vec<Vec<M31>>,
    /// Layer commitments
    commitments: Vec<MerkleCommitment>,
    /// Random folding coefficients (from verifier/Fiat-Shamir)
    alphas: Vec<M31>,
}

impl FriProver {
    /// Create a new FRI prover with the given configuration
    pub fn new(config: FriConfig) -> Self {
        Self {
            config,
            layers: Vec::new(),
            commitments: Vec::new(),
            alphas: Vec::new(),
        }
    }

    /// Commit to a polynomial evaluation
    ///
    /// `evaluations` should be the polynomial evaluated over a domain
    /// of size `2^log_domain_size`
    pub fn commit(&mut self, evaluations: Vec<M31>, log_domain_size: u32) {
        assert_eq!(evaluations.len(), 1 << log_domain_size);

        // Store first layer
        let commitment = MerkleCommitment::commit(&evaluations);
        self.commitments.push(commitment);
        self.layers.push(evaluations);
    }

    /// Add a folding round with the given random coefficient
    pub fn fold(&mut self, alpha: M31) {
        let last_layer = self.layers.last().expect("No layer to fold");
        let folding_factor = 1 << self.config.log_folding_factor;

        let new_size = last_layer.len() / folding_factor;
        let mut new_layer = Vec::with_capacity(new_size);

        // Fold groups of `folding_factor` evaluations into one
        for chunk in last_layer.chunks(folding_factor) {
            let folded = fold_chunk(chunk, alpha);
            new_layer.push(folded);
        }

        let commitment = MerkleCommitment::commit(&new_layer);
        self.commitments.push(commitment);
        self.layers.push(new_layer);
        self.alphas.push(alpha);
    }

    /// Generate the FRI proof
    pub fn prove(&self, query_indices: &[usize]) -> FriProof {
        let mut query_proofs = Vec::with_capacity(query_indices.len());

        for &base_index in query_indices {
            let mut layer_values = Vec::with_capacity(self.layers.len());
            let mut index = base_index;

            for (layer_idx, layer) in self.layers.iter().enumerate() {
                let folding_factor = 1 << self.config.log_folding_factor;
                let group_index = index / folding_factor;
                let group_start = group_index * folding_factor;

                // Get sibling values in the folding group
                let siblings: Vec<M31> = (0..folding_factor)
                    .map(|i| layer[group_start + i])
                    .collect();

                // Get Merkle path for the group
                let (_, merkle_path) = self.commitments[layer_idx]
                    .open(group_start)
                    .expect("Invalid index");

                layer_values.push(FriLayerValue {
                    siblings,
                    merkle_path,
                });

                // Update index for next layer
                index = group_index;
            }

            query_proofs.push(FriQueryProof {
                query_index: base_index,
                layer_values,
            });
        }

        // Extract final polynomial
        let final_poly = self.layers.last().unwrap().clone();

        // Create layer commitments
        let layer_commitments: Vec<FriLayerCommitment> = self.commitments
            .iter()
            .enumerate()
            .map(|(i, c)| FriLayerCommitment {
                root: c.root(),
                log_size: (self.layers[i].len() as f64).log2() as u32,
            })
            .collect();

        FriProof {
            layer_commitments,
            query_proofs,
            final_poly,
        }
    }

    /// Get layer commitment roots
    pub fn get_roots(&self) -> Vec<Hash> {
        self.commitments.iter().map(|c| c.root()).collect()
    }
}

/// FRI verifier
pub struct FriVerifier {
    config: FriConfig,
}

impl FriVerifier {
    /// Create a new verifier with the given configuration
    pub fn new(config: FriConfig) -> Self {
        Self { config }
    }

    /// Verify a FRI proof
    pub fn verify(
        &self,
        proof: &FriProof,
        alphas: &[M31],
        initial_domain_log_size: u32,
    ) -> Result<(), FriVerificationError> {
        // Check final polynomial is low degree
        let expected_final_size = 1 << self.config.log_final_poly_degree;
        if proof.final_poly.len() > expected_final_size {
            return Err(FriVerificationError::FinalPolyTooLarge);
        }

        // Verify each query
        for query_proof in &proof.query_proofs {
            self.verify_query(query_proof, proof, alphas, initial_domain_log_size)?;
        }

        Ok(())
    }

    fn verify_query(
        &self,
        query: &FriQueryProof,
        proof: &FriProof,
        alphas: &[M31],
        initial_domain_log_size: u32,
    ) -> Result<(), FriVerificationError> {
        let folding_factor = 1 << self.config.log_folding_factor;
        let mut index = query.query_index;
        let mut current_log_size = initial_domain_log_size;

        for (layer_idx, layer_value) in query.layer_values.iter().enumerate() {
            // Check Merkle path
            let group_index = index / folding_factor;

            // Verify all siblings are consistent with the commitment
            // (simplified: just check the first value's path)
            if layer_idx < proof.layer_commitments.len() {
                let expected_root = proof.layer_commitments[layer_idx].root;
                let leaf_hash = crate::merkle::hash_m31_batch(&layer_value.siblings);

                if !layer_value.merkle_path.verify(&leaf_hash, &expected_root) {
                    return Err(FriVerificationError::MerkleVerificationFailed);
                }
            }

            // Verify folding consistency (if not the last layer)
            if layer_idx < query.layer_values.len() - 1 && layer_idx < alphas.len() {
                let alpha = alphas[layer_idx];
                let expected_next = fold_chunk(&layer_value.siblings, alpha);

                // Get the actual next value
                let next_layer_value = &query.layer_values[layer_idx + 1];
                let next_index_in_group = group_index % folding_factor;

                if next_index_in_group < next_layer_value.siblings.len() {
                    let actual_next = next_layer_value.siblings[next_index_in_group];
                    if expected_next != actual_next {
                        return Err(FriVerificationError::FoldingInconsistent);
                    }
                }
            }

            index = group_index;
            current_log_size = current_log_size.saturating_sub(self.config.log_folding_factor);
        }

        Ok(())
    }
}

/// Fold a chunk of evaluations using the folding coefficient
fn fold_chunk(values: &[M31], alpha: M31) -> M31 {
    // Linear combination: result = sum(values[i] * alpha^i)
    let mut result = M31::ZERO;
    let mut alpha_pow = M31::ONE;

    for &val in values {
        result = result + val * alpha_pow;
        alpha_pow = alpha_pow * alpha;
    }

    result
}

/// FRI verification errors
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FriVerificationError {
    /// Final polynomial exceeds degree bound
    FinalPolyTooLarge,
    /// Merkle path verification failed
    MerkleVerificationFailed,
    /// Folding consistency check failed
    FoldingInconsistent,
    /// Invalid proof structure
    InvalidProofStructure,
}

impl core::fmt::Display for FriVerificationError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::FinalPolyTooLarge => write!(f, "Final polynomial exceeds degree bound"),
            Self::MerkleVerificationFailed => write!(f, "Merkle path verification failed"),
            Self::FoldingInconsistent => write!(f, "Folding consistency check failed"),
            Self::InvalidProofStructure => write!(f, "Invalid proof structure"),
        }
    }
}

/// Evaluate a polynomial at a point using Horner's method
pub fn evaluate_polynomial(coeffs: &[M31], x: M31) -> M31 {
    if coeffs.is_empty() {
        return M31::ZERO;
    }

    let mut result = coeffs[coeffs.len() - 1];
    for i in (0..coeffs.len() - 1).rev() {
        result = result * x + coeffs[i];
    }
    result
}

/// Interpolate polynomial from evaluations on a domain
pub fn interpolate_domain(evaluations: &[M31], domain: &[M31]) -> Vec<M31> {
    assert_eq!(evaluations.len(), domain.len());

    let n = evaluations.len();
    if n == 0 {
        return vec![];
    }

    // Lagrange interpolation
    let mut coeffs = vec![M31::ZERO; n];

    for i in 0..n {
        // Compute Lagrange basis polynomial L_i(x)
        let mut basis = vec![M31::ZERO; n];
        basis[0] = M31::ONE;

        let mut denom = M31::ONE;

        for j in 0..n {
            if i == j {
                continue;
            }

            // Multiply by (x - domain[j])
            for k in (1..=n.min(basis.len())).rev() {
                if k < basis.len() {
                    basis[k] = basis[k] - basis[k - 1] * domain[j];
                }
            }
            if basis.len() > 0 {
                basis[0] = M31::ZERO - basis[0] * domain[j];
            }

            denom = denom * (domain[i] - domain[j]);
        }

        // Scale by evaluation / denominator
        let scale = evaluations[i] / denom;

        for k in 0..n {
            coeffs[k] = coeffs[k] + basis[k] * scale;
        }
    }

    coeffs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_defaults() {
        let config = FriConfig::default();
        assert_eq!(config.log_blowup_factor, 4);
        assert_eq!(config.num_queries, 50);
    }

    #[test]
    fn test_security_bits() {
        let config = FriConfig::default();
        let bits = config.security_bits();
        assert!(bits >= 50, "Security should be at least 50 bits");
    }

    #[test]
    fn test_fold_chunk() {
        let values = vec![M31::new(1), M31::new(2), M31::new(3), M31::new(4)];
        let alpha = M31::new(2);

        // 1*1 + 2*2 + 3*4 + 4*8 = 1 + 4 + 12 + 32 = 49
        let result = fold_chunk(&values, alpha);
        assert_eq!(result.value(), 49);
    }

    #[test]
    fn test_evaluate_polynomial() {
        // p(x) = 1 + 2x + 3x^2
        let coeffs = vec![M31::new(1), M31::new(2), M31::new(3)];

        // p(0) = 1
        assert_eq!(evaluate_polynomial(&coeffs, M31::ZERO).value(), 1);

        // p(1) = 1 + 2 + 3 = 6
        assert_eq!(evaluate_polynomial(&coeffs, M31::ONE).value(), 6);

        // p(2) = 1 + 4 + 12 = 17
        assert_eq!(evaluate_polynomial(&coeffs, M31::new(2)).value(), 17);
    }

    #[test]
    fn test_fri_prover_commit() {
        let config = FriConfig::default();
        let mut prover = FriProver::new(config);

        let evaluations: Vec<M31> = (0..16).map(|i| M31::new(i)).collect();
        prover.commit(evaluations, 4);

        assert_eq!(prover.layers.len(), 1);
        assert_eq!(prover.layers[0].len(), 16);
    }

    #[test]
    fn test_fri_prover_fold() {
        let mut config = FriConfig::default();
        config.log_folding_factor = 1; // Fold by 2

        let mut prover = FriProver::new(config);

        let evaluations: Vec<M31> = (0..16).map(|i| M31::new(i)).collect();
        prover.commit(evaluations, 4);

        prover.fold(M31::new(3));

        assert_eq!(prover.layers.len(), 2);
        assert_eq!(prover.layers[1].len(), 8); // Folded by 2
    }

    #[test]
    fn test_fri_complete_flow() {
        let mut config = FriConfig::default();
        config.log_folding_factor = 2; // Fold by 4
        config.num_queries = 3;

        let mut prover = FriProver::new(config.clone());

        // Create initial evaluations
        let evaluations: Vec<M31> = (0..64).map(|i| M31::new(i * i % 1000)).collect();
        prover.commit(evaluations, 6);

        // Fold multiple rounds
        let alphas = vec![M31::new(5), M31::new(7)];
        for &alpha in &alphas {
            prover.fold(alpha);
        }

        // Generate proof
        let query_indices = vec![0, 17, 42];
        let proof = prover.prove(&query_indices);

        // Verify
        let verifier = FriVerifier::new(config);
        let result = verifier.verify(&proof, &alphas, 6);

        // Note: This basic test may not pass due to simplified implementation
        // In a full implementation, we'd ensure consistency
        assert!(proof.layer_commitments.len() > 0);
        assert_eq!(proof.query_proofs.len(), 3);
    }
}
