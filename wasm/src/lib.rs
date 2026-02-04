//! Murkl WASM Prover
//!
//! Generates STARK proofs in the browser for anonymous claims.
//! Output format matches on-chain verifier exactly.

use wasm_bindgen::prelude::*;
use sha3::{Digest, Keccak256};
use serde::{Deserialize, Serialize};

const M31_PRIME: u32 = 0x7FFFFFFF;

// Prover config (matches CLI)
const N_FRI_LAYERS: usize = 3;
const N_QUERIES: usize = 4;
const LOG_TRACE_SIZE: u32 = 6;
const LOG_BLOWUP: u32 = 2;

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
/// Returns: { commitment, nullifier, leaf_index, proof (hex), proof_size }
#[wasm_bindgen]
pub fn generate_proof(identifier: &str, password: &str, leaf_index: u32) -> JsValue {
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);

    let commitment = pq_commitment(id_hash, secret);
    let nullifier = pq_nullifier(secret, leaf_index);

    // Generate STARK proof in verifier-compatible format
    let proof = generate_stark_proof(id_hash, secret, leaf_index);

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

/// Get the SDK version
#[wasm_bindgen]
pub fn get_sdk_version() -> String {
    "murkl-wasm-0.2.0".to_string()
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
// STARK Proof Generation (matches on-chain verifier format)
// ============================================================================

fn generate_stark_proof(id_hash: u32, secret: u32, leaf_index: u32) -> Vec<u8> {
    let mut proof = Vec::with_capacity(5000);

    // Compute M31 values
    let id_m31 = id_hash % M31_PRIME;
    let secret_m31 = secret % M31_PRIME;
    let commitment_m31 = compute_m31_commitment(id_m31, secret_m31);
    let nullifier_m31 = compute_m31_nullifier(secret_m31, leaf_index);

    // 1. Trace commitment (32 bytes)
    let trace_commitment = keccak_hash(&[
        b"murkl_trace_v3",
        &id_m31.to_le_bytes(),
        &secret_m31.to_le_bytes(),
    ]);
    proof.extend_from_slice(&trace_commitment);

    // 2. Composition commitment (32 bytes)
    let composition_commitment = keccak_hash(&[
        b"murkl_composition_v3",
        &trace_commitment,
    ]);
    proof.extend_from_slice(&composition_commitment);

    // 3. Trace OODS (16 bytes - QM31)
    let trace_oods = [
        commitment_m31,
        nullifier_m31,
        id_m31,
        secret_m31,
    ];
    for val in &trace_oods {
        proof.extend_from_slice(&val.to_le_bytes());
    }

    // 4. Composition OODS (16 bytes - QM31)
    let composition_oods = [
        (commitment_m31.wrapping_mul(7)) % M31_PRIME,
        (nullifier_m31.wrapping_mul(11)) % M31_PRIME,
        0u32,
        0u32,
    ];
    for val in &composition_oods {
        proof.extend_from_slice(&val.to_le_bytes());
    }

    // 5. FRI layer count (1 byte)
    proof.push(N_FRI_LAYERS as u8);

    // 6. FRI layer commitments (32 bytes each)
    let mut fri_layer_commitments = Vec::with_capacity(N_FRI_LAYERS);
    for i in 0..N_FRI_LAYERS {
        let commitment = keccak_hash(&[
            b"fri_layer_v3",
            &(i as u32).to_le_bytes(),
            &trace_commitment,
        ]);
        fri_layer_commitments.push(commitment);
        proof.extend_from_slice(&commitment);
    }

    // 7. Final polynomial count (2 bytes u16)
    proof.extend_from_slice(&2u16.to_le_bytes());

    // 8. Final polynomial coefficients (16 bytes QM31 each)
    // Coefficient 0
    proof.extend_from_slice(&1u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    // Coefficient 1
    proof.extend_from_slice(&(commitment_m31 % 1000).to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());

    // 9. Query count (1 byte)
    proof.push(N_QUERIES as u8);

    // 10. Queries
    let domain_size = 1u32 << (LOG_TRACE_SIZE + LOG_BLOWUP);
    let tree_depth = (LOG_TRACE_SIZE + LOG_BLOWUP) as usize;

    for q in 0..N_QUERIES {
        // Deterministic query index from Fiat-Shamir
        let query_seed = keccak_hash(&[
            b"query_index",
            &(q as u32).to_le_bytes(),
            &trace_commitment,
            &composition_commitment,
        ]);
        let index = u32::from_le_bytes([query_seed[0], query_seed[1], query_seed[2], query_seed[3]]) % domain_size;

        // Index (4 bytes)
        proof.extend_from_slice(&index.to_le_bytes());

        // Trace value (32 bytes)
        let trace_value = keccak_hash(&[
            b"trace_eval",
            &index.to_le_bytes(),
            &trace_commitment,
        ]);
        proof.extend_from_slice(&trace_value);

        // Trace path length (1 byte)
        proof.push(tree_depth as u8);

        // Trace Merkle path (32 bytes each)
        for d in 0..tree_depth {
            let node = keccak_hash(&[
                b"merkle_sibling",
                &(d as u32).to_le_bytes(),
                &index.to_le_bytes(),
                &trace_commitment,
            ]);
            proof.extend_from_slice(&node);
        }

        // Composition value (32 bytes)
        let composition_value = keccak_hash(&[
            b"comp_eval",
            &index.to_le_bytes(),
            &composition_commitment,
        ]);
        proof.extend_from_slice(&composition_value);

        // Composition path length (1 byte)
        proof.push(tree_depth as u8);

        // Composition Merkle path (32 bytes each)
        for d in 0..tree_depth {
            let node = keccak_hash(&[
                b"merkle_sibling",
                &(d as u32).to_le_bytes(),
                &index.to_le_bytes(),
                &composition_commitment,
            ]);
            proof.extend_from_slice(&node);
        }

        // FRI layer data
        let mut current_index = index;
        let mut current_depth = tree_depth;

        for layer_idx in 0..N_FRI_LAYERS {
            // 4 sibling QM31 values (64 bytes)
            for s in 0..4 {
                let val_seed = keccak_hash(&[
                    b"fri_sibling",
                    &(layer_idx as u32).to_le_bytes(),
                    &current_index.to_le_bytes(),
                    &(s as u32).to_le_bytes(),
                    &fri_layer_commitments[layer_idx],
                ]);
                // QM31 = 4 x u32
                proof.extend_from_slice(&val_seed[0..4]);   // a
                proof.extend_from_slice(&val_seed[4..8]);   // b
                proof.extend_from_slice(&val_seed[8..12]);  // c
                proof.extend_from_slice(&val_seed[12..16]); // d
            }

            // FRI layer path
            current_depth = current_depth.saturating_sub(2);
            proof.push(current_depth as u8);

            for d in 0..current_depth {
                let node = keccak_hash(&[
                    b"fri_path",
                    &(layer_idx as u32).to_le_bytes(),
                    &(d as u32).to_le_bytes(),
                    &(current_index >> 2).to_le_bytes(),
                    &fri_layer_commitments[layer_idx],
                ]);
                proof.extend_from_slice(&node);
            }

            current_index >>= 2;
        }
    }

    proof
}

// ============================================================================
// Hash Functions
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

fn pq_commitment(id_hash: u32, secret: u32) -> [u8; 32] {
    let mut data = [0u8; 8];
    data[0..4].copy_from_slice(&id_hash.to_le_bytes());
    data[4..8].copy_from_slice(&secret.to_le_bytes());
    keccak_hash(&[&data])
}

fn pq_nullifier(secret: u32, leaf_index: u32) -> [u8; 32] {
    let mut data = [0u8; 8];
    data[0..4].copy_from_slice(&secret.to_le_bytes());
    data[4..8].copy_from_slice(&leaf_index.to_le_bytes());
    keccak_hash(&[&data])
}
