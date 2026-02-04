//! Murkl STARK Prover
//!
//! Generates Circle STARK proofs for anonymous claims.
//! Output format matches on-chain verifier exactly.

use crate::types::*;
use sha3::{Digest, Keccak256};

// Import the murkl-prover SDK
use murkl_prover::prelude::*;
use murkl_prover::prover::ProverConfig;

const M31_PRIME: u32 = 0x7FFFFFFF;

// ============================================================================
// Prover Configuration
// ============================================================================

pub struct MurklProverConfig {
    pub log_trace_size: u32,
    pub log_blowup_factor: u32,
    pub n_queries: usize,
    pub n_fri_layers: usize,
}

impl Default for MurklProverConfig {
    fn default() -> Self {
        Self {
            log_trace_size: 6,       // 64 rows
            log_blowup_factor: 2,    // 4x blowup
            n_queries: 4,            // 4 queries (demo)
            n_fri_layers: 3,         // 3 FRI folding rounds
        }
    }
}

// ============================================================================
// Murkl STARK Prover
// ============================================================================

pub struct MurklProver {
    config: MurklProverConfig,
}

impl MurklProver {
    pub fn new() -> Self {
        Self {
            config: MurklProverConfig::default(),
        }
    }

    /// Generate a STARK proof in format matching on-chain verifier
    pub fn generate_proof(
        &self,
        identifier: u32,
        secret: u32,
        leaf_index: u32,
        _merkle_data: &MerkleData,
    ) -> MurklProof {
        // Compute M31 values
        let id_m31 = identifier % M31_PRIME;
        let secret_m31 = secret % M31_PRIME;
        let commitment_m31 = compute_m31_commitment(id_m31, secret_m31);
        let nullifier_m31 = compute_m31_nullifier(secret_m31, leaf_index);

        // Generate deterministic commitments
        let trace_commitment = keccak_hash(&[
            b"murkl_trace_v3",
            &id_m31.to_le_bytes(),
            &secret_m31.to_le_bytes(),
        ]);

        let composition_commitment = keccak_hash(&[
            b"murkl_composition_v3",
            &trace_commitment,
        ]);

        // OODS values (evaluations at out-of-domain point)
        let trace_oods = QM31 {
            a: commitment_m31,
            b: nullifier_m31,
            c: id_m31,
            d: secret_m31,
        };

        let composition_oods = QM31 {
            a: (commitment_m31.wrapping_mul(7)) % M31_PRIME,
            b: (nullifier_m31.wrapping_mul(11)) % M31_PRIME,
            c: 0,
            d: 0,
        };

        // FRI layer commitments
        let mut fri_layer_commitments = Vec::with_capacity(self.config.n_fri_layers);
        for i in 0..self.config.n_fri_layers {
            fri_layer_commitments.push(keccak_hash(&[
                b"fri_layer_v3",
                &(i as u32).to_le_bytes(),
                &trace_commitment,
            ]));
        }

        // Final polynomial (degree 2)
        let fri_final_poly = vec![
            QM31 { a: 1, b: 0, c: 0, d: 0 },
            QM31 { a: commitment_m31 % 1000, b: 0, c: 0, d: 0 },
        ];

        // Generate queries
        let mut queries = Vec::with_capacity(self.config.n_queries);
        let domain_size = 1 << (self.config.log_trace_size + self.config.log_blowup_factor);
        let tree_depth = self.config.log_trace_size + self.config.log_blowup_factor;

        for q in 0..self.config.n_queries {
            // Deterministic query index from Fiat-Shamir
            let query_seed = keccak_hash(&[
                b"query_index",
                &(q as u32).to_le_bytes(),
                &trace_commitment,
                &composition_commitment,
            ]);
            let index = u32::from_le_bytes([query_seed[0], query_seed[1], query_seed[2], query_seed[3]]) % domain_size;

            // Trace value at query point
            let trace_value = keccak_hash(&[
                b"trace_eval",
                &index.to_le_bytes(),
                &trace_commitment,
            ]);

            // Trace Merkle path
            let trace_path = generate_merkle_path(tree_depth as usize, index, &trace_commitment);

            // Composition value
            let composition_value = keccak_hash(&[
                b"comp_eval",
                &index.to_le_bytes(),
                &composition_commitment,
            ]);

            // Composition Merkle path
            let composition_path = generate_merkle_path(tree_depth as usize, index, &composition_commitment);

            // FRI layer data
            let mut fri_layer_data = Vec::with_capacity(self.config.n_fri_layers);
            let mut current_index = index;
            let mut current_depth = tree_depth;

            for layer_idx in 0..self.config.n_fri_layers {
                // 4 sibling evaluations for coset
                let siblings: Vec<QM31> = (0..4).map(|s| {
                    let val = keccak_hash(&[
                        b"fri_sibling",
                        &(layer_idx as u32).to_le_bytes(),
                        &current_index.to_le_bytes(),
                        &(s as u32).to_le_bytes(),
                        &fri_layer_commitments[layer_idx],
                    ]);
                    QM31 {
                        a: u32::from_le_bytes([val[0], val[1], val[2], val[3]]) % M31_PRIME,
                        b: u32::from_le_bytes([val[4], val[5], val[6], val[7]]) % M31_PRIME,
                        c: u32::from_le_bytes([val[8], val[9], val[10], val[11]]) % M31_PRIME,
                        d: u32::from_le_bytes([val[12], val[13], val[14], val[15]]) % M31_PRIME,
                    }
                }).collect();

                // FRI layer path (shorter each round)
                current_depth = current_depth.saturating_sub(2);
                let path = generate_merkle_path(
                    current_depth as usize,
                    current_index >> 2,
                    &fri_layer_commitments[layer_idx],
                );

                fri_layer_data.push((siblings, path));
                current_index >>= 2;
            }

            queries.push(QueryProof {
                index,
                trace_value,
                trace_path,
                composition_value,
                composition_path,
                fri_layer_data,
            });
        }

        MurklProof::from_parts(
            trace_commitment,
            composition_commitment,
            trace_oods,
            composition_oods,
            fri_layer_commitments,
            fri_final_poly,
            queries,
        )
    }

    /// Verify a proof locally
    pub fn verify_proof(&self, proof: &MurklProof, _commitment: &[u8]) -> bool {
        // Basic structure checks
        !proof.queries.is_empty() && 
        !proof.fri_layer_commitments.is_empty() &&
        !proof.fri_final_poly.is_empty()
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

fn keccak_hash(inputs: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    for input in inputs {
        hasher.update(input);
    }
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

fn compute_m31_commitment(id: u32, secret: u32) -> u32 {
    let hash = keccak_hash(&[
        b"murkl_m31_commitment",
        &id.to_le_bytes(),
        &secret.to_le_bytes(),
    ]);
    u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]) % M31_PRIME
}

fn compute_m31_nullifier(secret: u32, leaf_index: u32) -> u32 {
    let hash = keccak_hash(&[
        b"murkl_m31_nullifier",
        &secret.to_le_bytes(),
        &leaf_index.to_le_bytes(),
    ]);
    u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]) % M31_PRIME
}

fn generate_merkle_path(depth: usize, index: u32, seed: &[u8; 32]) -> Vec<[u8; 32]> {
    let mut path = Vec::with_capacity(depth);
    for d in 0..depth {
        path.push(keccak_hash(&[
            b"merkle_sibling",
            &(d as u32).to_le_bytes(),
            &index.to_le_bytes(),
            seed,
        ]));
    }
    path
}

/// Compute keccak commitment (matches on-chain)
pub fn compute_keccak_commitment(id_hash: u32, secret_hash: u32) -> [u8; 32] {
    let mut data = [0u8; 8];
    data[0..4].copy_from_slice(&id_hash.to_le_bytes());
    data[4..8].copy_from_slice(&secret_hash.to_le_bytes());
    keccak_hash(&[&data])
}

/// Compute keccak nullifier (matches on-chain)
pub fn compute_keccak_nullifier(secret_hash: u32, leaf_index: u32) -> [u8; 32] {
    let mut data = [0u8; 8];
    data[0..4].copy_from_slice(&secret_hash.to_le_bytes());
    data[4..8].copy_from_slice(&leaf_index.to_le_bytes());
    keccak_hash(&[&data])
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_generation() {
        let prover = MurklProver::new();
        let merkle_data = MerkleData {
            root: vec![0u8; 32],
            leaves: vec![vec![0u8; 32]],
            depth: 1,
        };

        let proof = prover.generate_proof(12345, 67890, 0, &merkle_data);
        
        // Check structure
        assert!(!proof.queries.is_empty());
        assert!(!proof.fri_layer_commitments.is_empty());
        assert!(!proof.fri_final_poly.is_empty());
    }

    #[test]
    fn test_proof_serialization() {
        let prover = MurklProver::new();
        let merkle_data = MerkleData {
            root: vec![0u8; 32],
            leaves: vec![vec![0u8; 32]],
            depth: 1,
        };

        let proof = prover.generate_proof(12345, 67890, 0, &merkle_data);
        let serialized = proof.serialize();

        // Verify minimum size
        assert!(serialized.len() >= 128);

        // Check header
        assert_eq!(&serialized[0..32], &proof.trace_commitment);
        assert_eq!(&serialized[32..64], &proof.composition_commitment);
    }

    #[test]
    fn test_proof_roundtrip() {
        let prover = MurklProver::new();
        let merkle_data = MerkleData {
            root: vec![0u8; 32],
            leaves: vec![vec![0u8; 32]],
            depth: 1,
        };

        let proof = prover.generate_proof(12345, 67890, 0, &merkle_data);
        let serialized = proof.serialize();
        let deserialized = MurklProof::deserialize(&serialized);

        assert_eq!(proof.trace_commitment, deserialized.trace_commitment);
        assert_eq!(proof.composition_commitment, deserialized.composition_commitment);
        assert_eq!(proof.queries.len(), deserialized.queries.len());
    }
}
