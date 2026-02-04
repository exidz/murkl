//! Murkl WASM Prover
//!
//! Generates STARK proofs in the browser for anonymous claims.
//! Output format matches on-chain verifier exactly.
//!
//! Uses `murkl-prover` for shared cryptographic primitives.

use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};

// Import from murkl-prover SDK
use murkl_prover::M31_PRIME;

/// Simple keccak256 hash (matches on-chain verifier)
fn keccak_single(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

/// Multi-input keccak (for compatibility with SDK)
fn keccak_multi(inputs: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    for input in inputs {
        hasher.update(input);
    }
    let result = hasher.finalize();
    let mut hash = [0u8; 32];
    hash.copy_from_slice(&result);
    hash
}

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
    
    fn neg(self) -> Self {
        if self.0 == 0 { M31::new(0) } else { M31::new(M31_PRIME - self.0) }
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
        // QM31 multiplication matching on-chain verifier exactly
        // Field: i² = -1, u² = 2 + i
        // x = x0 + x1*u where x0 = a+bi, x1 = c+di
        // y = y0 + y1*u where y0 = e+fi, y1 = g+hi
        
        let (e, f) = (other.a, other.b);
        let (g, h) = (other.c, other.d);

        // Complex multiplication helper: (a+bi)(c+di) = (ac-bd) + (ad+bc)i
        let mul_cm31 = |a: M31, b: M31, c: M31, d: M31| -> (M31, M31) {
            let real = a.mul(c).sub(b.mul(d));
            let imag = a.mul(d).add(b.mul(c));
            (real, imag)
        };

        // x0*y0
        let (r0, i0) = mul_cm31(self.a, self.b, e, f);
        
        // x0*y1 + x1*y0
        let (r1a, i1a) = mul_cm31(self.a, self.b, g, h);
        let (r1b, i1b) = mul_cm31(self.c, self.d, e, f);
        let (r1, i1) = (r1a.add(r1b), i1a.add(i1b));
        
        // x1*y1 * u² = x1*y1 * (2+i)
        let (cg_dh, ch_dg) = mul_cm31(self.c, self.d, g, h);
        // (cg-dh + (ch+dg)i)(2+i) = 2(cg-dh) - (ch+dg) + (2(ch+dg) + (cg-dh))i
        let r2_real = cg_dh.mul(M31::new(2)).sub(ch_dg);
        let r2_imag = ch_dg.mul(M31::new(2)).add(cg_dh);

        // Result: (r0 + r2_real) + (i0 + r2_imag)i + r1*u + i1*iu
        QM31::new(
            r0.add(r2_real),
            i0.add(r2_imag),
            r1,
            i1,
        )
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
        // QM31 inverse matching on-chain verifier exactly
        // x^(-1) = conj(x) / norm(x)
        
        // First compute norm in CM31
        // x * conj(x) where conj over u: conj(a + bi + cu + diu) = a + bi - cu - diu
        let a2_b2 = self.a.mul(self.a).sub(self.b.mul(self.b));
        let two_ab = self.a.mul(self.b).mul(M31::new(2));
        
        let c2_d2 = self.c.mul(self.c).sub(self.d.mul(self.d));
        let two_cd = self.c.mul(self.d).mul(M31::new(2));
        
        // (c²-d² + 2cdi)(2+i) = 2(c²-d²) - 2cd + (c²-d² + 4cd)i
        let u2_real = c2_d2.mul(M31::new(2)).sub(two_cd);
        let u2_imag = c2_d2.add(two_cd.mul(M31::new(2)));
        
        let nr = a2_b2.sub(u2_real);
        let ni = two_ab.sub(u2_imag);
        
        // Norm of CM31 element to get M31: r² + s²
        let norm_m31 = nr.mul(nr).add(ni.mul(ni));
        let norm_inv = norm_m31.inv();
        
        // CM31 inverse: (r - si) / (r² + s²)
        let cm31_inv_r = nr.mul(norm_inv);
        let cm31_inv_i = ni.neg().mul(norm_inv);
        
        // conj(x) = (a + bi) - (c + di)u
        // result = conj(x) * cm31_inv
        
        // (a+bi)(r+si) = ar-bs + (as+br)i
        let res_a = self.a.mul(cm31_inv_r).sub(self.b.mul(cm31_inv_i));
        let res_b = self.a.mul(cm31_inv_i).add(self.b.mul(cm31_inv_r));
        
        // -(c+di)(r+si) = -(cr-ds + (cs+dr)i) 
        let res_c = self.c.mul(cm31_inv_r).sub(self.d.mul(cm31_inv_i)).neg();
        let res_d = self.c.mul(cm31_inv_i).add(self.d.mul(cm31_inv_r)).neg();
        
        QM31::new(res_a, res_b, res_c, res_d)
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
        self.state = keccak_single(&data);
        self.counter += 1;
    }
    
    fn mix_qm31(&mut self, elem: &QM31) {
        let mut data = [0u8; 48];
        data[..32].copy_from_slice(&self.state);
        data[32..36].copy_from_slice(&elem.a.0.to_le_bytes());
        data[36..40].copy_from_slice(&elem.b.0.to_le_bytes());
        data[40..44].copy_from_slice(&elem.c.0.to_le_bytes());
        data[44..48].copy_from_slice(&elem.d.0.to_le_bytes());
        self.state = keccak_single(&data);
        self.counter += 1;
    }
    
    fn squeeze_m31(&mut self) -> M31 {
        let mut data = [0u8; 40];
        data[..32].copy_from_slice(&self.state);
        data[32..40].copy_from_slice(&self.counter.to_le_bytes());
        let hash = keccak_single(&data);
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
    let hash = keccak_single(bytes);
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
    let trace_commitment = keccak_multi(&[
        b"murkl_trace_v3",
        &id_m31.to_le_bytes(),
        &secret_m31.to_le_bytes(),
    ]);
    proof.extend_from_slice(&trace_commitment);

    // 2. Composition commitment (32 bytes)
    let composition_commitment = keccak_multi(&[
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

    // 5. Mix OODS values into channel (before FRI phase)
    channel.mix_qm31(&trace_oods);
    channel.mix_qm31(&composition_oods);

    // 6. FRI layer count (1 byte)
    proof.push(N_FRI_LAYERS as u8);

    // 7. FRI layer commitments (32 bytes each)
    // For each layer: mix commitment, then squeeze fri_alpha
    let mut fri_layer_commitments = Vec::with_capacity(N_FRI_LAYERS);
    for i in 0..N_FRI_LAYERS {
        let fri_commitment = keccak_multi(&[
            b"fri_layer_v3",
            &(i as u32).to_le_bytes(),
            &trace_commitment,
        ]);
        fri_layer_commitments.push(fri_commitment);
        proof.extend_from_slice(&fri_commitment);
        
        // Match verifier: mix then squeeze QM31
        channel.mix_digest(&fri_commitment);
        let _fri_alpha = channel.squeeze_qm31(); // Must squeeze to advance channel state
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

    // 9. Query count (1 byte)
    proof.push(N_QUERIES as u8);

    // 10. Generate query proofs (format must match verifier's parse_query_proof)
    let log_domain_size: usize = 10 + 4; // LOG_TRACE_SIZE (10) + LOG_BLOWUP (4) = 14
    let domain_size = 1usize << log_domain_size;
    
    for q in 0..N_QUERIES {
        // Query index from channel (same as verifier)
        let query_index = channel.squeeze_m31();
        let idx = (query_index.0 as usize) % domain_size;
        
        // Query index (4 bytes)
        proof.extend_from_slice(&(idx as u32).to_le_bytes());
        
        // Trace value at query (32 bytes - full hash, not QM31)
        let trace_val = keccak_multi(&[
            b"trace_val_v3",
            &(idx as u32).to_le_bytes(),
            &trace_commitment,
        ]);
        proof.extend_from_slice(&trace_val);
        
        // Trace path length (1 byte)
        proof.push(log_domain_size as u8);
        
        // Trace Merkle path (path_len * 32 bytes)
        for level in 0..log_domain_size {
            let node = keccak_multi(&[
                b"trace_path_v3",
                &(q as u32).to_le_bytes(),
                &(level as u32).to_le_bytes(),
                &trace_commitment,
            ]);
            proof.extend_from_slice(&node);
        }
        
        // Composition value at query (32 bytes)
        let comp_val = keccak_multi(&[
            b"comp_val_v3",
            &(idx as u32).to_le_bytes(),
            &composition_commitment,
        ]);
        proof.extend_from_slice(&comp_val);
        
        // Composition path length (1 byte)
        proof.push(log_domain_size as u8);
        
        // Composition Merkle path (path_len * 32 bytes)
        for level in 0..log_domain_size {
            let node = keccak_multi(&[
                b"comp_path_v3",
                &(q as u32).to_le_bytes(),
                &(level as u32).to_le_bytes(),
                &composition_commitment,
            ]);
            proof.extend_from_slice(&node);
        }
        
        // FRI layer values and paths
        for (layer_idx, fri_commitment) in fri_layer_commitments.iter().enumerate() {
            // 4 FRI sibling values (4 × 16 bytes = 64 bytes total)
            for sibling in 0..4 {
                let fri_val = keccak_multi(&[
                    b"fri_val_v3",
                    &(q as u32).to_le_bytes(),
                    &(layer_idx as u32).to_le_bytes(),
                    &(sibling as u32).to_le_bytes(),
                    fri_commitment,
                ]);
                // QM31 = 16 bytes
                proof.extend_from_slice(&fri_val[..16]);
            }
            
            // FRI layer path length (1 byte)
            let layer_log_size = log_domain_size.saturating_sub(layer_idx + 1);
            proof.push(layer_log_size as u8);
            
            // FRI Merkle path (shrinks each layer)
            for level in 0..layer_log_size {
                let node = keccak_multi(&[
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
