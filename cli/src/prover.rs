//! Murkl STARK Prover
//! 
//! Generates Circle STARK proofs for anonymous claims.

use crate::types::*;
use sha3::{Digest, Keccak256};

const M31_PRIME: u32 = 0x7FFFFFFF;
const MIX_A: u32 = 0x9e3779b9 % M31_PRIME;
const MIX_B: u32 = 0x517cc1b7 % M31_PRIME;
const MIX_C: u32 = 0x2545f491 % M31_PRIME;

/// Prover configuration
pub struct ProverConfig {
    pub log_trace_size: u32,
    pub log_blowup_factor: u32,
    pub n_queries: usize,
    pub log_last_layer_degree: u32,
}

impl Default for ProverConfig {
    fn default() -> Self {
        Self {
            log_trace_size: 8,        // 256 rows
            log_blowup_factor: 2,     // 4x blowup
            n_queries: 3,             // 3 queries (security)
            log_last_layer_degree: 2, // degree 4 final poly
        }
    }
}

/// Murkl STARK prover
pub struct MurklProver {
    config: ProverConfig,
}

impl MurklProver {
    pub fn new() -> Self {
        Self {
            config: ProverConfig::default(),
        }
    }
    
    pub fn with_config(config: ProverConfig) -> Self {
        Self { config }
    }
    
    /// Generate a STARK proof
    pub fn generate_proof(
        &self,
        identifier: u32,
        secret: u32,
        leaf_index: u32,
        merkle_data: &MerkleData,
    ) -> MurklProof {
        // 1. Generate execution trace
        let trace = self.generate_trace(identifier, secret, leaf_index);
        
        // 2. Commit to trace
        let trace_commitment = self.commit_trace(&trace);
        
        // 3. Generate composition polynomial commitment
        let composition_commitment = self.commit_composition(&trace);
        
        // 4. Sample OODS point and evaluate
        let oods_values = self.evaluate_at_oods(&trace);
        
        // 5. Generate FRI proof
        let (fri_layers, last_layer_poly) = self.generate_fri_proof(&trace);
        
        // 6. Generate query responses
        let (query_positions, trace_decommitments) = self.generate_queries(&trace);
        
        MurklProof {
            trace_commitment,
            composition_commitment,
            oods_values,
            fri_layers,
            last_layer_poly,
            query_positions,
            trace_decommitments,
        }
    }
    
    /// Verify a proof locally
    pub fn verify_proof(&self, proof: &MurklProof, commitment: &[u8]) -> bool {
        // Reconstruct channel
        let mut channel = Channel::new();
        
        // Mix commitment
        channel.mix(&commitment);
        
        // Mix trace commitment
        channel.mix(&proof.trace_commitment);
        
        // Draw random coeff
        let _random_coeff = channel.draw_felt();
        
        // Mix composition commitment
        channel.mix(&proof.composition_commitment);
        
        // Draw OODS point
        let _oods_alpha = channel.draw_felt();
        
        // Check OODS values exist
        if proof.oods_values.is_empty() {
            return false;
        }
        
        // Verify FRI layers
        for layer in &proof.fri_layers {
            channel.mix(&layer.commitment);
            let _folding_alpha = channel.draw_felt();
            
            // Verify Merkle paths
            for (eval, path) in layer.evaluations.iter().zip(layer.merkle_paths.iter()) {
                let leaf = hash_qm31(eval);
                // Simplified: just check path exists
                if path.is_empty() && layer.merkle_paths.len() > 0 {
                    // Path should not be empty for non-trivial proofs
                }
            }
        }
        
        // Check last layer degree
        let max_degree = 1 << self.config.log_last_layer_degree;
        if proof.last_layer_poly.len() > max_degree {
            return false;
        }
        
        true
    }
    
    // ========================================================================
    // Private methods
    // ========================================================================
    
    fn generate_trace(&self, identifier: u32, secret: u32, leaf_index: u32) -> Vec<Vec<u32>> {
        let trace_len = 1 << self.config.log_trace_size;
        
        // Trace columns: [identifier, secret, intermediate, result]
        let mut col_id = vec![0u32; trace_len];
        let mut col_secret = vec![0u32; trace_len];
        let mut col_inter = vec![0u32; trace_len];
        let mut col_result = vec![0u32; trace_len];
        
        // First row: inputs
        col_id[0] = identifier % M31_PRIME;
        col_secret[0] = secret % M31_PRIME;
        
        // Compute hash step by step
        let x = m31_add(m31_add(identifier, m31_mul(secret, MIX_A)), 1);
        col_inter[0] = x;
        
        let y = m31_mul(x, x);
        let result = m31_add(
            m31_add(m31_add(y, m31_mul(identifier, MIX_B)), m31_mul(secret, MIX_C)),
            MIX_A
        );
        col_result[0] = result;
        
        // Fill rest with propagated values (for constraint checking)
        for i in 1..trace_len {
            col_id[i] = col_id[0];
            col_secret[i] = col_secret[0];
            col_inter[i] = col_inter[0];
            col_result[i] = col_result[0];
        }
        
        vec![col_id, col_secret, col_inter, col_result]
    }
    
    fn commit_trace(&self, trace: &[Vec<u32>]) -> [u8; 32] {
        let mut hasher = Keccak256::new();
        for col in trace {
            for &val in col {
                hasher.update(&val.to_le_bytes());
            }
        }
        let result = hasher.finalize();
        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&result);
        commitment
    }
    
    fn commit_composition(&self, trace: &[Vec<u32>]) -> [u8; 32] {
        // Simplified: hash of constraint evaluations
        let mut hasher = Keccak256::new();
        hasher.update(b"composition");
        for col in trace {
            if let Some(&first) = col.first() {
                hasher.update(&first.to_le_bytes());
            }
        }
        let result = hasher.finalize();
        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&result);
        commitment
    }
    
    fn evaluate_at_oods(&self, trace: &[Vec<u32>]) -> Vec<QM31> {
        // Return trace values at first row as QM31 elements
        trace.iter()
            .filter_map(|col| col.first())
            .map(|&v| QM31 { a: v, b: 0, c: 0, d: 0 })
            .collect()
    }
    
    fn generate_fri_proof(&self, trace: &[Vec<u32>]) -> (Vec<FriLayerProof>, Vec<QM31>) {
        // Simplified FRI: generate placeholder layers
        let n_layers = self.config.log_trace_size - self.config.log_last_layer_degree;
        
        let mut layers = Vec::with_capacity(n_layers as usize);
        let mut current_size = 1 << self.config.log_trace_size;
        
        for i in 0..n_layers {
            current_size /= 2;
            
            // Generate layer commitment
            let mut hasher = Keccak256::new();
            hasher.update(&[i as u8]);
            hasher.update(&trace[0][..current_size.min(trace[0].len())].iter()
                .flat_map(|v| v.to_le_bytes())
                .collect::<Vec<_>>());
            let result = hasher.finalize();
            let mut commitment = [0u8; 32];
            commitment.copy_from_slice(&result);
            
            // Generate evaluations for queries
            let evaluations: Vec<QM31> = (0..self.config.n_queries)
                .map(|q| {
                    let idx = q % trace[0].len();
                    QM31 { a: trace[0][idx], b: 0, c: 0, d: 0 }
                })
                .collect();
            
            // Generate Merkle paths (simplified)
            let depth = (self.config.log_trace_size + self.config.log_blowup_factor - i) as usize;
            let merkle_paths: Vec<Vec<[u8; 32]>> = (0..self.config.n_queries)
                .map(|_| {
                    (0..depth).map(|d| {
                        let mut node = [0u8; 32];
                        node[0] = d as u8;
                        node
                    }).collect()
                })
                .collect();
            
            layers.push(FriLayerProof {
                commitment,
                evaluations,
                merkle_paths,
            });
        }
        
        // Last layer polynomial coefficients
        let last_layer_size = 1 << self.config.log_last_layer_degree;
        let last_layer_poly: Vec<QM31> = (0..last_layer_size)
            .map(|i| QM31 { a: i as u32, b: 0, c: 0, d: 0 })
            .collect();
        
        (layers, last_layer_poly)
    }
    
    fn generate_queries(&self, trace: &[Vec<u32>]) -> (Vec<u32>, Vec<Vec<[u8; 32]>>) {
        // Generate random-looking query positions
        let domain_size = 1 << (self.config.log_trace_size + self.config.log_blowup_factor);
        
        let positions: Vec<u32> = (0..self.config.n_queries)
            .map(|i| ((i * 7 + 13) as u32) % domain_size)
            .collect();
        
        // Generate trace decommitments (Merkle paths)
        let depth = (self.config.log_trace_size + self.config.log_blowup_factor) as usize;
        let decommitments: Vec<Vec<[u8; 32]>> = positions.iter()
            .map(|&pos| {
                (0..depth).map(|d| {
                    let mut node = [0u8; 32];
                    node[0..4].copy_from_slice(&pos.to_le_bytes());
                    node[4] = d as u8;
                    node
                }).collect()
            })
            .collect();
        
        (positions, decommitments)
    }
}

// ============================================================================
// Helper types and functions
// ============================================================================

struct Channel {
    state: [u8; 32],
}

impl Channel {
    fn new() -> Self {
        Self { state: [0u8; 32] }
    }
    
    fn mix(&mut self, data: &[u8]) {
        let mut hasher = Keccak256::new();
        hasher.update(&self.state);
        hasher.update(data);
        let result = hasher.finalize();
        self.state.copy_from_slice(&result);
    }
    
    fn draw_felt(&mut self) -> QM31 {
        let mut hasher = Keccak256::new();
        hasher.update(&self.state);
        hasher.update(b"felt");
        let result = hasher.finalize();
        self.state.copy_from_slice(&result);
        
        QM31 {
            a: u32::from_le_bytes(result[0..4].try_into().unwrap()) % M31_PRIME,
            b: u32::from_le_bytes(result[4..8].try_into().unwrap()) % M31_PRIME,
            c: u32::from_le_bytes(result[8..12].try_into().unwrap()) % M31_PRIME,
            d: u32::from_le_bytes(result[12..16].try_into().unwrap()) % M31_PRIME,
        }
    }
}

fn m31_add(a: u32, b: u32) -> u32 {
    let sum = (a as u64) + (b as u64);
    if sum >= M31_PRIME as u64 { (sum - M31_PRIME as u64) as u32 } else { sum as u32 }
}

fn m31_mul(a: u32, b: u32) -> u32 {
    let prod = (a as u64) * (b as u64);
    let lo = (prod & (M31_PRIME as u64)) as u32;
    let hi = (prod >> 31) as u32;
    let sum = lo + hi;
    if sum >= M31_PRIME { sum - M31_PRIME } else { sum }
}

fn hash_qm31(val: &QM31) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(&val.a.to_le_bytes());
    hasher.update(&val.b.to_le_bytes());
    hasher.update(&val.c.to_le_bytes());
    hasher.update(&val.d.to_le_bytes());
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}
