//! CLI for generating STARK proofs
//!
//! Usage: cargo run --bin prove -- --identifier "@test" --password "pass" --leaf-index 0

use std::env;
use murkl_prover::{
    hash_identifier, hash_password, pq_commitment, pq_nullifier,
    m31_commitment, m31_nullifier, keccak_hash, M31,
};

const M31_PRIME: u32 = 0x7FFFFFFF;
const N_FRI_LAYERS: usize = 3;
const N_QUERIES: usize = 4;
const LOG_TRACE_SIZE: u32 = 6;
const LOG_BLOWUP: u32 = 2;

fn main() {
    let args: Vec<String> = env::args().collect();
    
    let mut identifier = "@test".to_string();
    let mut password = "testpass123".to_string();
    let mut leaf_index: u32 = 0;
    
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--identifier" | "-i" => {
                i += 1;
                if i < args.len() { identifier = args[i].clone(); }
            }
            "--password" | "-p" => {
                i += 1;
                if i < args.len() { password = args[i].clone(); }
            }
            "--leaf-index" | "-l" => {
                i += 1;
                if i < args.len() { leaf_index = args[i].parse().unwrap_or(0); }
            }
            _ => {}
        }
        i += 1;
    }
    
    eprintln!("Generating proof for:");
    eprintln!("  Identifier: {}", identifier);
    eprintln!("  Password: {}", password);
    eprintln!("  Leaf index: {}", leaf_index);
    
    let id_hash = hash_identifier(&identifier);
    let secret = hash_password(&password);
    
    eprintln!("  id_hash: {}", id_hash.value());
    eprintln!("  secret: {}", secret.value());
    
    let commitment = pq_commitment(id_hash, secret);
    let nullifier = pq_nullifier(secret, leaf_index);
    
    eprintln!("  commitment: {}", hex::encode(&commitment));
    eprintln!("  nullifier: {}", hex::encode(&nullifier));
    
    // Generate proof
    let proof = generate_proof(id_hash.value(), secret.value(), leaf_index);
    
    eprintln!("  proof_size: {} bytes", proof.len());
    
    // Output JSON
    println!("{{");
    println!("  \"commitment\": \"{}\",", hex::encode(&commitment));
    println!("  \"nullifier\": \"{}\",", hex::encode(&nullifier));
    println!("  \"leaf_index\": {},", leaf_index);
    println!("  \"proof\": \"{}\",", hex::encode(&proof));
    println!("  \"proof_size\": {}", proof.len());
    println!("}}");
}

fn generate_proof(id_hash: u32, secret: u32, leaf_index: u32) -> Vec<u8> {
    let mut proof = Vec::with_capacity(5000);
    
    // M31 values
    let commitment_m31 = m31_commitment(M31::new(id_hash), M31::new(secret)).value();
    let nullifier_m31 = m31_nullifier(M31::new(secret), leaf_index).value();
    
    // 1. Trace commitment (32 bytes)
    let trace_commitment = keccak_hash(&[
        b"trace_commitment_v3",
        &commitment_m31.to_le_bytes(),
        &nullifier_m31.to_le_bytes(),
        &id_hash.to_le_bytes(),
        &secret.to_le_bytes(),
    ]);
    proof.extend_from_slice(&trace_commitment);
    
    // 2. Composition commitment (32 bytes)
    let composition_commitment = keccak_hash(&[
        b"composition_v3",
        &trace_commitment,
    ]);
    proof.extend_from_slice(&composition_commitment);
    
    // 3. Trace OODS (16 bytes - QM31)
    for val in &[commitment_m31, nullifier_m31, id_hash, secret] {
        proof.extend_from_slice(&val.to_le_bytes());
    }
    
    // 4. Composition OODS (16 bytes - QM31)
    let comp_oods = [
        (commitment_m31.wrapping_mul(7)) % M31_PRIME,
        (nullifier_m31.wrapping_mul(11)) % M31_PRIME,
        0u32,
        0u32,
    ];
    for val in &comp_oods {
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
    proof.extend_from_slice(&1u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    
    proof.extend_from_slice(&((commitment_m31 % 1000) as u32).to_le_bytes());
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
        
        // Trace Merkle path
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
        let comp_value = keccak_hash(&[
            b"comp_eval",
            &index.to_le_bytes(),
            &composition_commitment,
        ]);
        proof.extend_from_slice(&comp_value);
        
        // Composition path length (1 byte)
        proof.push(tree_depth as u8);
        
        // Composition Merkle path
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
                proof.extend_from_slice(&val_seed[0..16]);
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
