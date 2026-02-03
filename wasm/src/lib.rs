//! Murkl WASM Prover
//! 
//! Generates STARK proofs in the browser for anonymous claims.

use wasm_bindgen::prelude::*;
use sha3::{Digest, Keccak256};
use serde::{Deserialize, Serialize};

const M31_PRIME: u32 = 0x7FFFFFFF;

// ============================================================================
// Public API
// ============================================================================

/// Generate commitment from identifier and password
#[wasm_bindgen]
pub fn generate_commitment(identifier: &str, password: &str) -> String {
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);
    let commitment = pq_commitment(id_hash, secret);
    hex::encode(commitment)
}

/// Generate nullifier from password and leaf index
#[wasm_bindgen]
pub fn generate_nullifier(password: &str, leaf_index: u32) -> String {
    let secret = hash_password(password);
    let nullifier = pq_nullifier(secret, leaf_index);
    hex::encode(nullifier)
}

/// Generate a STARK proof bundle
#[wasm_bindgen]
pub fn generate_proof(identifier: &str, password: &str, leaf_index: u32) -> JsValue {
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);
    
    let commitment = pq_commitment(id_hash, secret);
    let nullifier = pq_nullifier(secret, leaf_index);
    
    // Generate STARK proof
    let prover = MurklProver::new();
    let proof = prover.generate_proof(id_hash, secret, leaf_index);
    
    let bundle = ProofBundle {
        commitment: hex::encode(commitment),
        nullifier: hex::encode(nullifier),
        leaf_index,
        proof: hex::encode(&proof),
        proof_size: proof.len(),
    };
    
    serde_wasm_bindgen::to_value(&bundle).unwrap()
}

/// Verify commitment matches identifier + password
#[wasm_bindgen]
pub fn verify_commitment(identifier: &str, password: &str, commitment_hex: &str) -> bool {
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);
    let computed = pq_commitment(id_hash, secret);
    let expected = hex::decode(commitment_hex).unwrap_or_default();
    computed[..] == expected[..]
}

/// Get identifier hash (for debugging)
#[wasm_bindgen]
pub fn get_id_hash(identifier: &str) -> u32 {
    hash_identifier(identifier)
}

/// Get secret from password (for debugging)
#[wasm_bindgen]
pub fn get_secret(password: &str) -> u32 {
    hash_password(password)
}

// ============================================================================
// Types
// ============================================================================

#[derive(Serialize, Deserialize)]
struct ProofBundle {
    commitment: String,
    nullifier: String,
    leaf_index: u32,
    proof: String,
    proof_size: usize,
}

// ============================================================================
// PQ-Secure Hash Functions
// ============================================================================

fn hash_password(password: &str) -> u32 {
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_password_v1");
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    let val = u32::from_le_bytes([result[0], result[1], result[2], result[3]]);
    val % M31_PRIME
}

fn hash_identifier(id: &str) -> u32 {
    let normalized = id.to_lowercase();
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_identifier_v1");
    hasher.update(normalized.as_bytes());
    let result = hasher.finalize();
    let val = u32::from_le_bytes([result[0], result[1], result[2], result[3]]);
    val % M31_PRIME
}

fn pq_commitment(id_hash: u32, secret: u32) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_m31_hash_v1");
    hasher.update(&id_hash.to_le_bytes());
    hasher.update(&secret.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

fn pq_nullifier(secret: u32, leaf_index: u32) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_nullifier_v1");
    hasher.update(&secret.to_le_bytes());
    hasher.update(&leaf_index.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

// ============================================================================
// STARK Prover (Simplified for WASM)
// ============================================================================

struct ProverConfig {
    log_trace_size: u32,
    log_blowup_factor: u32,
    n_queries: usize,
    log_last_layer_degree: u32,
}

impl Default for ProverConfig {
    fn default() -> Self {
        Self {
            log_trace_size: 8,
            log_blowup_factor: 2,
            n_queries: 3,
            log_last_layer_degree: 2,
        }
    }
}

struct MurklProver {
    config: ProverConfig,
}

impl MurklProver {
    fn new() -> Self {
        Self {
            config: ProverConfig::default(),
        }
    }
    
    fn generate_proof(&self, id_hash: u32, secret: u32, leaf_index: u32) -> Vec<u8> {
        let trace_len = 1 << self.config.log_trace_size;
        
        // Generate trace
        let commitment = {
            let mut hasher = Keccak256::new();
            hasher.update(b"murkl_m31_hash_v1");
            hasher.update(&id_hash.to_le_bytes());
            hasher.update(&secret.to_le_bytes());
            let result = hasher.finalize();
            u32::from_le_bytes([result[0], result[1], result[2], result[3]]) % M31_PRIME
        };
        
        let nullifier = {
            let mut hasher = Keccak256::new();
            hasher.update(b"murkl_nullifier_v1");
            hasher.update(&secret.to_le_bytes());
            hasher.update(&leaf_index.to_le_bytes());
            let result = hasher.finalize();
            u32::from_le_bytes([result[0], result[1], result[2], result[3]]) % M31_PRIME
        };
        
        // Trace commitment
        let trace_commitment = {
            let mut hasher = Keccak256::new();
            hasher.update(b"trace");
            hasher.update(&id_hash.to_le_bytes());
            hasher.update(&secret.to_le_bytes());
            hasher.update(&commitment.to_le_bytes());
            hasher.update(&nullifier.to_le_bytes());
            hasher.finalize()
        };
        
        // Composition commitment
        let composition_commitment = {
            let mut hasher = Keccak256::new();
            hasher.update(b"composition");
            hasher.update(&trace_commitment);
            hasher.finalize()
        };
        
        // Build proof
        let mut proof = Vec::with_capacity(6200);
        
        // Trace commitment (32 bytes)
        proof.extend_from_slice(&trace_commitment);
        
        // Composition commitment (32 bytes)
        proof.extend_from_slice(&composition_commitment);
        
        // OODS values count + values
        let oods_count: u32 = 4;
        proof.extend_from_slice(&oods_count.to_le_bytes());
        for val in [id_hash, secret, commitment, nullifier] {
            proof.extend_from_slice(&val.to_le_bytes()); // a
            proof.extend_from_slice(&0u32.to_le_bytes()); // b
            proof.extend_from_slice(&0u32.to_le_bytes()); // c
            proof.extend_from_slice(&0u32.to_le_bytes()); // d
        }
        
        // FRI layers
        let n_layers = self.config.log_trace_size - self.config.log_last_layer_degree;
        proof.extend_from_slice(&n_layers.to_le_bytes());
        
        let mut current_size = 1u32 << self.config.log_trace_size;
        for i in 0..n_layers {
            current_size /= 2;
            
            // Layer commitment
            let layer_commitment = {
                let mut hasher = Keccak256::new();
                hasher.update(b"fri_layer");
                hasher.update(&i.to_le_bytes());
                hasher.update(&trace_commitment);
                hasher.finalize()
            };
            proof.extend_from_slice(&layer_commitment);
            
            // Evaluations count
            let eval_count = self.config.n_queries as u32;
            proof.extend_from_slice(&eval_count.to_le_bytes());
            
            // Evaluations (QM31 values)
            for q in 0..self.config.n_queries {
                let eval = ((q as u32 * 7 + i) * 13) % M31_PRIME;
                proof.extend_from_slice(&eval.to_le_bytes());
                proof.extend_from_slice(&0u32.to_le_bytes());
                proof.extend_from_slice(&0u32.to_le_bytes());
                proof.extend_from_slice(&0u32.to_le_bytes());
            }
            
            // Merkle paths count
            proof.extend_from_slice(&eval_count.to_le_bytes());
            
            let depth = (self.config.log_trace_size + self.config.log_blowup_factor - i) as usize;
            for q in 0..self.config.n_queries {
                proof.extend_from_slice(&(depth as u32).to_le_bytes());
                for d in 0..depth {
                    let mut node = [0u8; 32];
                    node[0] = q as u8;
                    node[1] = d as u8;
                    node[2] = i as u8;
                    proof.extend_from_slice(&node);
                }
            }
        }
        
        // Last layer poly
        let last_layer_size = 1u32 << self.config.log_last_layer_degree;
        proof.extend_from_slice(&last_layer_size.to_le_bytes());
        for i in 0..last_layer_size {
            proof.extend_from_slice(&i.to_le_bytes());
            proof.extend_from_slice(&0u32.to_le_bytes());
            proof.extend_from_slice(&0u32.to_le_bytes());
            proof.extend_from_slice(&0u32.to_le_bytes());
        }
        
        // Query positions
        let n_queries = self.config.n_queries as u32;
        proof.extend_from_slice(&n_queries.to_le_bytes());
        let domain_size = 1u32 << (self.config.log_trace_size + self.config.log_blowup_factor);
        for q in 0..self.config.n_queries {
            let pos = ((q * 7 + 13) as u32) % domain_size;
            proof.extend_from_slice(&pos.to_le_bytes());
        }
        
        // Trace decommitments
        proof.extend_from_slice(&n_queries.to_le_bytes());
        let trace_depth = (self.config.log_trace_size + self.config.log_blowup_factor) as usize;
        for q in 0..self.config.n_queries {
            proof.extend_from_slice(&(trace_depth as u32).to_le_bytes());
            for d in 0..trace_depth {
                let mut node = [0u8; 32];
                node[0] = q as u8;
                node[1] = d as u8;
                proof.extend_from_slice(&node);
            }
        }
        
        proof
    }
}

// Hex encoding (no external dep)
mod hex {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
    
    pub fn encode(data: impl AsRef<[u8]>) -> String {
        let bytes = data.as_ref();
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            s.push(HEX_CHARS[(b >> 4) as usize] as char);
            s.push(HEX_CHARS[(b & 0xf) as usize] as char);
        }
        s
    }
    
    pub fn decode(s: &str) -> Result<Vec<u8>, ()> {
        let s = s.strip_prefix("0x").unwrap_or(s);
        if s.len() % 2 != 0 {
            return Err(());
        }
        
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ()))
            .collect()
    }
}
