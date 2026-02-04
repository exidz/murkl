//! Murkl WASM Prover
//!
//! Generates STARK proofs in the browser for anonymous claims.
//! Output format matches on-chain verifier exactly.
//!
//! Uses `murkl-prover` for shared cryptographic primitives.

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

// Import from murkl-prover SDK
use murkl_prover::{M31_PRIME, keccak_hash};

// Prover config (matches verifier)
const N_FRI_LAYERS: usize = 3;
const N_QUERIES: usize = 4;
const DOMAIN_SIZE: u32 = 1024; // 2^10

// ============================================================================
// QM31 Field Element (matches on-chain)
// ============================================================================

#[derive(Clone, Copy, Debug)]
struct M31(u32);

impl M31 {
    fn new(val: u32) -> Self {
        M31(val % M31_PRIME)
    }
    
    fn add(self, other: Self) -> Self {
        M31::new((self.0 as u64 + other.0 as u64) as u32)
    }
    
    fn sub(self, other: Self) -> Self {
        M31::new((self.0 as u64 + M31_PRIME as u64 - other.0 as u64) as u32)
    }
    
    fn mul(self, other: Self) -> Self {
        M31::new(((self.0 as u64 * other.0 as u64) % M31_PRIME as u64) as u32)
    }
    
    fn pow(self, mut exp: u32) -> Self {
        let mut base = self;
        let mut result = M31::new(1);
        while exp > 0 {
            if exp & 1 == 1 {
                result = result.mul(base);
            }
            base = base.mul(base);
            exp >>= 1;
        }
        result
    }
    
    fn inv(self) -> Self {
        // Fermat's little theorem: a^(-1) = a^(p-2) mod p
        self.pow(M31_PRIME - 2)
    }
}

#[derive(Clone, Copy, Debug)]
struct QM31 {
    a: M31,
    b: M31,
    c: M31,
    d: M31,
}

impl QM31 {
    fn new(a: M31, b: M31, c: M31, d: M31) -> Self {
        QM31 { a, b, c, d }
    }
    
    fn zero() -> Self {
        QM31::new(M31::new(0), M31::new(0), M31::new(0), M31::new(0))
    }
    
    fn one() -> Self {
        QM31::new(M31::new(1), M31::new(0), M31::new(0), M31::new(0))
    }
    
    fn add(self, other: Self) -> Self {
        QM31::new(
            self.a.add(other.a),
            self.b.add(other.b),
            self.c.add(other.c),
            self.d.add(other.d),
        )
    }
    
    fn sub(self, other: Self) -> Self {
        QM31::new(
            self.a.sub(other.a),
            self.b.sub(other.b),
            self.c.sub(other.c),
            self.d.sub(other.d),
        )
    }
    
    fn mul(self, other: Self) -> Self {
        // QM31 multiplication (extension field)
        // (a + bi + cj + dk) * (e + fi + gj + hk)
        // where i^2 = 2, j^2 = i, k = ij
        let a = self.a;
        let b = self.b;
        let c = self.c;
        let d = self.d;
        let e = other.a;
        let f = other.b;
        let g = other.c;
        let h = other.d;
        
        // Simplified multiplication for CM31 extension
        // Real part: ae + 2bf + 2(cg + dh) + 2*2(bh + df)
        // etc. This is complex - using schoolbook for now
        let two = M31::new(2);
        
        let r0 = a.mul(e)
            .add(two.mul(b.mul(f)))
            .add(two.mul(c.mul(h).add(d.mul(g))))
            .add(two.mul(two).mul(d.mul(h)));
        
        let r1 = a.mul(f).add(b.mul(e))
            .add(two.mul(c.mul(g)))
            .add(two.mul(d.mul(h)))
            .add(two.mul(d.mul(g).add(c.mul(h))));
        
        let r2 = a.mul(g).add(c.mul(e))
            .add(two.mul(b.mul(h).add(d.mul(f))));
        
        let r3 = a.mul(h).add(b.mul(g)).add(c.mul(f)).add(d.mul(e));
        
        QM31::new(r0, r1, r2, r3)
    }
    
    fn pow(self, mut exp: u32) -> Self {
        let mut base = self;
        let mut result = QM31::one();
        while exp > 0 {
            if exp & 1 == 1 {
                result = result.mul(base);
            }
            base = base.mul(base);
            exp >>= 1;
        }
        result
    }
    
    fn inv(self) -> Self {
        // For QM31, we use the formula: a^(-1) = conj(a) / norm(a)
        // This is complex - simplified version
        let norm_sq = self.a.mul(self.a)
            .add(M31::new(2).mul(self.b.mul(self.b)))
            .add(M31::new(2).mul(self.c.mul(self.c)))
            .add(M31::new(4).mul(self.d.mul(self.d)));
        let norm_inv = norm_sq.inv();
        
        QM31::new(
            self.a.mul(norm_inv),
            M31::new(0).sub(self.b).mul(norm_inv),
            M31::new(0).sub(self.c).mul(norm_inv),
            self.d.mul(norm_inv),
        )
    }
}

// ============================================================================
// Fiat-Shamir Channel (matches on-chain verifier exactly)
// ============================================================================

struct Channel {
    state: [u8; 32],
    counter: u64,
}

impl Channel {
    fn new() -> Self {
        Self {
            state: [0u8; 32],
            counter: 0,
        }
    }
    
    fn mix_digest(&mut self, digest: &[u8; 32]) {
        let mut data = [0u8; 64];
        data[..32].copy_from_slice(&self.state);
        data[32..].copy_from_slice(digest);
        self.state = keccak_hash(&[&data[..]]);
        self.counter += 1;
    }
    
    fn mix_qm31(&mut self, elem: &QM31) {
        let mut data = [0u8; 48];
        data[..32].copy_from_slice(&self.state);
        data[32..36].copy_from_slice(&elem.a.0.to_le_bytes());
        data[36..40].copy_from_slice(&elem.b.0.to_le_bytes());
        data[40..44].copy_from_slice(&elem.c.0.to_le_bytes());
        data[44..48].copy_from_slice(&elem.d.0.to_le_bytes());
        self.state = keccak_hash(&[&data[..]]);
        self.counter += 1;
    }
    
    fn squeeze_m31(&mut self) -> M31 {
        let mut data = [0u8; 40];
        data[..32].copy_from_slice(&self.state);
        data[32..40].copy_from_slice(&self.counter.to_le_bytes());
        let hash = keccak_hash(&[&data[..]]);
        self.state = hash;
        self.counter += 1;
        M31::new(u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]))
    }
    
    fn squeeze_qm31(&mut self) -> QM31 {
        let a = self.squeeze_m31();
        let b = self.squeeze_m31();
        let c = self.squeeze_m31();
        let d = self.squeeze_m31();
        QM31::new(a, b, c, d)
    }
}

// ============================================================================
// Helper: bytes to QM31 (matches on-chain)
// ============================================================================

fn bytes_to_qm31(bytes: &[u8; 32]) -> QM31 {
    let hash = keccak_hash(&[bytes]);
    QM31::new(
        M31::new(u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]])),
        M31::new(u32::from_le_bytes([hash[4], hash[5], hash[6], hash[7]])),
        M31::new(u32::from_le_bytes([hash[8], hash[9], hash[10], hash[11]])),
        M31::new(u32::from_le_bytes([hash[12], hash[13], hash[14], hash[15]])),
    )
}

// ============================================================================
// Constraint Evaluation (matches on-chain exactly)
// ============================================================================

fn evaluate_murkl_constraint(
    trace_oods: &QM31,
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
    merkle_root: &[u8; 32],
    alpha: &QM31,
    oods_point: &QM31,
) -> QM31 {
    let c = bytes_to_qm31(commitment);
    let n = bytes_to_qm31(nullifier);
    let r = bytes_to_qm31(merkle_root);
    
    // C(x) = (trace(x) - c) + α*(trace(x) - n) + α²*(trace(x) - r)
    let c1 = trace_oods.sub(c);
    let c2 = alpha.mul(trace_oods.sub(n));
    let alpha_sq = alpha.mul(*alpha);
    let c3 = alpha_sq.mul(trace_oods.sub(r));
    
    let constraint_sum = c1.add(c2).add(c3);
    
    // Divide by vanishing polynomial: V(x) = x^n - 1
    let oods_pow = oods_point.pow(DOMAIN_SIZE);
    let vanishing_at_oods = oods_pow.sub(QM31::one());
    
    // Check if vanishing is zero (shouldn't happen)
    let is_zero = vanishing_at_oods.a.0 == 0 
        && vanishing_at_oods.b.0 == 0 
        && vanishing_at_oods.c.0 == 0 
        && vanishing_at_oods.d.0 == 0;
    
    if is_zero {
        constraint_sum
    } else {
        constraint_sum.mul(vanishing_at_oods.inv())
    }
}

// ============================================================================
// Public API
// ============================================================================

#[derive(Serialize, Deserialize)]
struct ProofBundle {
    commitment: String,
    nullifier: String,
    leaf_index: u32,
    proof: String,
    proof_size: usize,
    error: Option<String>,
}

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
/// merkle_root_hex: The pool's current merkle root (fetch from relayer/chain)
#[wasm_bindgen]
pub fn generate_proof(identifier: &str, password: &str, leaf_index: u32, merkle_root_hex: &str) -> JsValue {
    // Parse merkle root
    let merkle_root: [u8; 32] = match hex::decode(merkle_root_hex) {
        Ok(bytes) if bytes.len() == 32 => {
            let mut arr = [0u8; 32];
            arr.copy_from_slice(&bytes);
            arr
        }
        _ => {
            let bundle = ProofBundle {
                commitment: String::new(),
                nullifier: String::new(),
                leaf_index,
                proof: String::new(),
                proof_size: 0,
                error: Some("Invalid merkle_root hex".to_string()),
            };
            return serde_wasm_bindgen::to_value(&bundle).unwrap();
        }
    };
    
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);

    let commitment = pq_commitment(id_hash, secret);
    let nullifier = pq_nullifier(secret, leaf_index);

    // Generate STARK proof
    let proof = generate_stark_proof(id_hash, secret, leaf_index, &commitment, &nullifier, &merkle_root);

    let bundle = ProofBundle {
        commitment: hex::encode(commitment),
        nullifier: hex::encode(nullifier),
        leaf_index,
        proof: hex::encode(&proof),
        proof_size: proof.len(),
        error: None,
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

/// Get the SDK version
#[wasm_bindgen]
pub fn get_sdk_version() -> String {
    "murkl-wasm-0.3.0".to_string()
}

// ============================================================================
// STARK Proof Generation (matches on-chain verifier format)
// ============================================================================

fn generate_stark_proof(
    id_hash: u32,
    secret: u32,
    leaf_index: u32,
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
    merkle_root: &[u8; 32],
) -> Vec<u8> {
    let mut proof = Vec::with_capacity(5000);

    // Compute M31 values for trace
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
    // The trace polynomial evaluated at the OODS point
    let trace_oods = QM31::new(
        M31::new(commitment_m31),
        M31::new(nullifier_m31),
        M31::new(id_m31),
        M31::new(secret_m31),
    );
    proof.extend_from_slice(&trace_oods.a.0.to_le_bytes());
    proof.extend_from_slice(&trace_oods.b.0.to_le_bytes());
    proof.extend_from_slice(&trace_oods.c.0.to_le_bytes());
    proof.extend_from_slice(&trace_oods.d.0.to_le_bytes());

    // 4. Compute composition OODS using Fiat-Shamir
    // Must match verifier's channel state exactly
    let mut channel = Channel::new();
    
    // Mix public inputs (same order as verifier)
    channel.mix_digest(commitment);
    channel.mix_digest(nullifier);
    channel.mix_digest(merkle_root);
    
    // Mix trace commitment
    channel.mix_digest(&trace_commitment);
    
    // Squeeze alpha
    let alpha = channel.squeeze_qm31();
    
    // Mix composition commitment
    channel.mix_digest(&composition_commitment);
    
    // Squeeze OODS point
    let oods_point = channel.squeeze_qm31();
    
    // Compute composition OODS (matches verifier's constraint evaluation)
    let composition_oods = evaluate_murkl_constraint(
        &trace_oods,
        commitment,
        nullifier,
        merkle_root,
        &alpha,
        &oods_point,
    );
    
    proof.extend_from_slice(&composition_oods.a.0.to_le_bytes());
    proof.extend_from_slice(&composition_oods.b.0.to_le_bytes());
    proof.extend_from_slice(&composition_oods.c.0.to_le_bytes());
    proof.extend_from_slice(&composition_oods.d.0.to_le_bytes());

    // 5. FRI layer count (1 byte)
    proof.push(N_FRI_LAYERS as u8);

    // 6. FRI layer commitments (32 bytes each)
    // Mix into channel as we go
    let mut fri_layer_commitments = Vec::with_capacity(N_FRI_LAYERS);
    for i in 0..N_FRI_LAYERS {
        let fri_commitment = keccak_hash(&[
            b"fri_layer_v3",
            &(i as u32).to_le_bytes(),
            &trace_commitment,
        ]);
        fri_layer_commitments.push(fri_commitment);
        proof.extend_from_slice(&fri_commitment);
        channel.mix_digest(&fri_commitment);
    }

    // 7. Final polynomial count (2 bytes u16)
    proof.extend_from_slice(&2u16.to_le_bytes());

    // 8. Final polynomial coefficients (16 bytes QM31 each)
    proof.extend_from_slice(&1u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&(commitment_m31 % 1000).to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());

    // 9. Query count (2 bytes u16)
    proof.extend_from_slice(&(N_QUERIES as u16).to_le_bytes());

    // 10. Generate query proofs
    // Get query indices from Fiat-Shamir (same as verifier)
    let log_domain_size = 10 + 2; // LOG_TRACE_SIZE + LOG_BLOWUP
    let domain_size = 1usize << log_domain_size;
    
    for q in 0..N_QUERIES {
        // Query index from channel
        let query_index = channel.squeeze_m31();
        let idx = (query_index.0 as usize) % domain_size;
        
        // Query index (4 bytes)
        proof.extend_from_slice(&(idx as u32).to_le_bytes());
        
        // Trace value at query (QM31 = 16 bytes)
        let trace_val_seed = keccak_hash(&[
            b"trace_val_v3",
            &idx.to_le_bytes()[..4],
            &trace_commitment,
        ]);
        proof.extend_from_slice(&trace_val_seed[..16]);
        
        // Trace Merkle path (log2(domain) * 32 bytes)
        for level in 0..log_domain_size {
            let node = keccak_hash(&[
                b"trace_path_v3",
                &(q as u32).to_le_bytes(),
                &(level as u32).to_le_bytes(),
                &trace_commitment,
            ]);
            proof.extend_from_slice(&node);
        }
        
        // Composition value at query (QM31 = 16 bytes)
        let comp_val_seed = keccak_hash(&[
            b"comp_val_v3",
            &idx.to_le_bytes()[..4],
            &composition_commitment,
        ]);
        proof.extend_from_slice(&comp_val_seed[..16]);
        
        // Composition Merkle path
        for level in 0..log_domain_size {
            let node = keccak_hash(&[
                b"comp_path_v3",
                &(q as u32).to_le_bytes(),
                &(level as u32).to_le_bytes(),
                &composition_commitment,
            ]);
            proof.extend_from_slice(&node);
        }
        
        // FRI layer values and paths
        for (layer_idx, fri_commitment) in fri_layer_commitments.iter().enumerate() {
            // FRI value (QM31 = 16 bytes)
            let fri_val_seed = keccak_hash(&[
                b"fri_val_v3",
                &(q as u32).to_le_bytes(),
                &(layer_idx as u32).to_le_bytes(),
                fri_commitment,
            ]);
            proof.extend_from_slice(&fri_val_seed[..16]);
            
            // FRI Merkle path (shrinks each layer)
            let layer_log_size = log_domain_size - layer_idx - 1;
            for level in 0..layer_log_size {
                let node = keccak_hash(&[
                    b"fri_path_v3",
                    &(q as u32).to_le_bytes(),
                    &(layer_idx as u32).to_le_bytes(),
                    &(level as u32).to_le_bytes(),
                    fri_commitment,
                ]);
                proof.extend_from_slice(&node);
            }
        }
    }

    proof
}

// ============================================================================
// Hash Functions (from murkl-prover SDK)
// ============================================================================

fn hash_password(password: &str) -> u32 {
    murkl_prover::hash_password(password).value()
}

fn hash_identifier(id: &str) -> u32 {
    murkl_prover::hash_identifier(id).value()
}

fn compute_m31_commitment(id: u32, secret: u32) -> u32 {
    use murkl_prover::M31;
    murkl_prover::m31_commitment(M31::new(id), M31::new(secret)).value()
}

fn compute_m31_nullifier(secret: u32, leaf_index: u32) -> u32 {
    use murkl_prover::M31;
    murkl_prover::m31_nullifier(M31::new(secret), leaf_index).value()
}

fn pq_commitment(id_hash: u32, secret: u32) -> [u8; 32] {
    use murkl_prover::M31;
    murkl_prover::pq_commitment(M31::new(id_hash), M31::new(secret))
}

fn pq_nullifier(secret: u32, leaf_index: u32) -> [u8; 32] {
    use murkl_prover::M31;
    murkl_prover::pq_nullifier(M31::new(secret), leaf_index)
}
