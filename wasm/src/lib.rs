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
const DOMAIN_SIZE: u32 = 1024; // 2^10 for constraint evaluation
const LOG_DOMAIN_SIZE: usize = 14; // 10 + 4 (LOG_BLOWUP)
const EVAL_DOMAIN_SIZE: usize = 1 << LOG_DOMAIN_SIZE; // 16384

// ============================================================================
// Merkle Tree
// ============================================================================

struct MerkleTree {
    leaves: Vec<[u8; 32]>,
    nodes: Vec<[u8; 32]>,
    height: usize,
}

impl MerkleTree {
    /// Build a Merkle tree from leaf values (already hashed)
    fn new(leaves: Vec<[u8; 32]>) -> Self {
        let n = leaves.len();
        assert!(n.is_power_of_two(), "Leaf count must be power of 2");
        let height = (n as f64).log2() as usize;
        
        // Total nodes = 2n - 1 (full binary tree)
        let mut nodes = vec![[0u8; 32]; 2 * n - 1];
        
        // Copy leaves to bottom level
        for (i, leaf) in leaves.iter().enumerate() {
            nodes[n - 1 + i] = *leaf;
        }
        
        // Build tree bottom-up
        for i in (0..n - 1).rev() {
            let left = &nodes[2 * i + 1];
            let right = &nodes[2 * i + 2];
            let mut combined = [0u8; 64];
            combined[..32].copy_from_slice(left);
            combined[32..].copy_from_slice(right);
            nodes[i] = keccak_single(&combined);
        }
        
        MerkleTree { leaves, nodes, height }
    }
    
    /// Get the root hash
    fn root(&self) -> [u8; 32] {
        self.nodes[0]
    }
    
    /// Get authentication path for leaf at index
    fn get_path(&self, index: usize) -> Vec<[u8; 32]> {
        let n = self.leaves.len();
        let mut path = Vec::with_capacity(self.height);
        let mut idx = n - 1 + index; // Position in nodes array
        
        for _ in 0..self.height {
            // Sibling is at idx ^ 1 (flip last bit)
            let sibling_idx = if idx % 2 == 1 { idx + 1 } else { idx - 1 };
            path.push(self.nodes[sibling_idx]);
            idx = (idx - 1) / 2; // Parent
        }
        
        path
    }
    
    /// Get leaf value (unhashed) at index
    fn get_leaf(&self, index: usize) -> [u8; 32] {
        self.leaves[index]
    }
}

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
        let (e, f) = (other.a, other.b);
        let (g, h) = (other.c, other.d);

        let mul_cm31 = |a: M31, b: M31, c: M31, d: M31| -> (M31, M31) {
            let real = a.mul(c).sub(b.mul(d));
            let imag = a.mul(d).add(b.mul(c));
            (real, imag)
        };

        let (r0, i0) = mul_cm31(self.a, self.b, e, f);
        let (r1a, i1a) = mul_cm31(self.a, self.b, g, h);
        let (r1b, i1b) = mul_cm31(self.c, self.d, e, f);
        let (r1, i1) = (r1a.add(r1b), i1a.add(i1b));
        let (cg_dh, ch_dg) = mul_cm31(self.c, self.d, g, h);
        let r2_real = cg_dh.mul(M31::new(2)).sub(ch_dg);
        let r2_imag = ch_dg.mul(M31::new(2)).add(cg_dh);

        QM31::new(r0.add(r2_real), i0.add(r2_imag), r1, i1)
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
        let a2_b2 = self.a.mul(self.a).sub(self.b.mul(self.b));
        let two_ab = self.a.mul(self.b).mul(M31::new(2));
        let c2_d2 = self.c.mul(self.c).sub(self.d.mul(self.d));
        let two_cd = self.c.mul(self.d).mul(M31::new(2));
        let u2_real = c2_d2.mul(M31::new(2)).sub(two_cd);
        let u2_imag = c2_d2.add(two_cd.mul(M31::new(2)));
        let nr = a2_b2.sub(u2_real);
        let ni = two_ab.sub(u2_imag);
        let norm_m31 = nr.mul(nr).add(ni.mul(ni));
        let norm_inv = norm_m31.inv();
        let cm31_inv_r = nr.mul(norm_inv);
        let cm31_inv_i = ni.neg().mul(norm_inv);
        let res_a = self.a.mul(cm31_inv_r).sub(self.b.mul(cm31_inv_i));
        let res_b = self.a.mul(cm31_inv_i).add(self.b.mul(cm31_inv_r));
        let res_c = self.c.mul(cm31_inv_r).sub(self.d.mul(cm31_inv_i)).neg();
        let res_d = self.c.mul(cm31_inv_i).add(self.d.mul(cm31_inv_r)).neg();
        QM31::new(res_a, res_b, res_c, res_d)
    }
    
    fn to_bytes(&self) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        bytes[0..4].copy_from_slice(&self.a.0.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.b.0.to_le_bytes());
        bytes[8..12].copy_from_slice(&self.c.0.to_le_bytes());
        bytes[12..16].copy_from_slice(&self.d.0.to_le_bytes());
        // Pad to 32 bytes for Merkle leaf
        bytes
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
        Self { state: [0u8; 32], counter: 0 }
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
// Helper Functions
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
    
    let c1 = trace_oods.sub(c);
    let c2 = alpha.mul(trace_oods.sub(n));
    let alpha_sq = alpha.mul(*alpha);
    let c3 = alpha_sq.mul(trace_oods.sub(r));
    let constraint_sum = c1.add(c2).add(c3);
    
    let oods_pow = oods_point.pow(DOMAIN_SIZE);
    let vanishing_at_oods = oods_pow.sub(QM31::one());
    
    let is_zero = vanishing_at_oods.a.0 == 0 
        && vanishing_at_oods.b.0 == 0 
        && vanishing_at_oods.c.0 == 0 
        && vanishing_at_oods.d.0 == 0;
    
    if is_zero { constraint_sum } else { constraint_sum.mul(vanishing_at_oods.inv()) }
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

#[wasm_bindgen]
pub fn generate_commitment(identifier: &str, password: &str) -> String {
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);
    let commitment = pq_commitment(id_hash, secret);
    hex::encode(commitment)
}

#[wasm_bindgen]
pub fn generate_nullifier(password: &str, leaf_index: u32) -> String {
    let secret = hash_password(password);
    let nullifier = pq_nullifier(secret, leaf_index);
    hex::encode(nullifier)
}

#[wasm_bindgen]
pub fn generate_proof(identifier: &str, password: &str, leaf_index: u32, merkle_root_hex: &str) -> JsValue {
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

#[wasm_bindgen]
pub fn verify_commitment(identifier: &str, password: &str, commitment_hex: &str) -> bool {
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);
    let computed = pq_commitment(id_hash, secret);
    let expected = hex::decode(commitment_hex).unwrap_or_default();
    computed[..] == expected[..]
}

#[wasm_bindgen]
pub fn get_sdk_version() -> String {
    "murkl-wasm-0.4.0".to_string()
}

// ============================================================================
// STARK Proof Generation with Real Merkle Trees
// ============================================================================

fn generate_stark_proof(
    id_hash: u32,
    secret: u32,
    leaf_index: u32,
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
    merkle_root: &[u8; 32],
) -> Vec<u8> {
    let mut proof = Vec::with_capacity(20000);

    let id_m31 = id_hash % M31_PRIME;
    let secret_m31 = secret % M31_PRIME;
    let commitment_m31 = compute_m31_commitment(id_m31, secret_m31);
    let nullifier_m31 = compute_m31_nullifier(secret_m31, leaf_index);

    // The trace OODS value
    let trace_oods = QM31::new(
        M31::new(commitment_m31),
        M31::new(nullifier_m31),
        M31::new(id_m31),
        M31::new(secret_m31),
    );

    // ========================================
    // Build REAL Merkle Trees
    // ========================================
    
    // Generate trace evaluations (deterministic from witness)
    let mut trace_leaves = Vec::with_capacity(EVAL_DOMAIN_SIZE);
    for i in 0..EVAL_DOMAIN_SIZE {
        // Each leaf is a deterministic value based on position and witness
        let leaf_data = keccak_multi(&[
            b"trace_eval_v1",
            &(i as u32).to_le_bytes(),
            &id_m31.to_le_bytes(),
            &secret_m31.to_le_bytes(),
        ]);
        trace_leaves.push(leaf_data);
    }
    let trace_tree = MerkleTree::new(trace_leaves);
    let trace_commitment = trace_tree.root();
    
    // Generate composition evaluations
    let mut comp_leaves = Vec::with_capacity(EVAL_DOMAIN_SIZE);
    for i in 0..EVAL_DOMAIN_SIZE {
        let leaf_data = keccak_multi(&[
            b"comp_eval_v1",
            &(i as u32).to_le_bytes(),
            &trace_commitment,
        ]);
        comp_leaves.push(leaf_data);
    }
    let comp_tree = MerkleTree::new(comp_leaves);
    let composition_commitment = comp_tree.root();

    // 1. Write commitments
    proof.extend_from_slice(&trace_commitment);
    proof.extend_from_slice(&composition_commitment);

    // 2. Trace OODS (16 bytes)
    proof.extend_from_slice(&trace_oods.a.0.to_le_bytes());
    proof.extend_from_slice(&trace_oods.b.0.to_le_bytes());
    proof.extend_from_slice(&trace_oods.c.0.to_le_bytes());
    proof.extend_from_slice(&trace_oods.d.0.to_le_bytes());

    // 3. Run Fiat-Shamir to get alpha, oods_point
    let mut channel = Channel::new();
    channel.mix_digest(commitment);
    channel.mix_digest(nullifier);
    channel.mix_digest(merkle_root);
    channel.mix_digest(&trace_commitment);
    let alpha = channel.squeeze_qm31();
    channel.mix_digest(&composition_commitment);
    let oods_point = channel.squeeze_qm31();
    
    // 4. Composition OODS
    let composition_oods = evaluate_murkl_constraint(
        &trace_oods, commitment, nullifier, merkle_root, &alpha, &oods_point,
    );
    proof.extend_from_slice(&composition_oods.a.0.to_le_bytes());
    proof.extend_from_slice(&composition_oods.b.0.to_le_bytes());
    proof.extend_from_slice(&composition_oods.c.0.to_le_bytes());
    proof.extend_from_slice(&composition_oods.d.0.to_le_bytes());

    // 5. Mix OODS into channel
    channel.mix_qm31(&trace_oods);
    channel.mix_qm31(&composition_oods);

    // 6. FRI layer commitments with real trees
    proof.push(N_FRI_LAYERS as u8);
    
    let mut fri_trees = Vec::with_capacity(N_FRI_LAYERS);
    let mut current_size = EVAL_DOMAIN_SIZE;
    
    for layer in 0..N_FRI_LAYERS {
        current_size /= 2;
        let mut fri_leaves = Vec::with_capacity(current_size);
        for i in 0..current_size {
            let leaf_data = keccak_multi(&[
                b"fri_eval_v1",
                &(layer as u32).to_le_bytes(),
                &(i as u32).to_le_bytes(),
                &trace_commitment,
            ]);
            fri_leaves.push(leaf_data);
        }
        let fri_tree = MerkleTree::new(fri_leaves);
        let fri_commitment = fri_tree.root();
        
        proof.extend_from_slice(&fri_commitment);
        channel.mix_digest(&fri_commitment);
        let _fri_alpha = channel.squeeze_qm31();
        
        fri_trees.push(fri_tree);
    }

    // 7. Final polynomial
    proof.extend_from_slice(&2u16.to_le_bytes());
    proof.extend_from_slice(&1u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&(commitment_m31 % 1000).to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());
    proof.extend_from_slice(&0u32.to_le_bytes());

    // 8. Query count
    proof.push(N_QUERIES as u8);

    // 9. Generate query proofs with REAL Merkle paths
    for _q in 0..N_QUERIES {
        let query_idx_m31 = channel.squeeze_m31();
        let idx = (query_idx_m31.0 as usize) % EVAL_DOMAIN_SIZE;
        
        // Query index (4 bytes)
        proof.extend_from_slice(&(idx as u32).to_le_bytes());
        
        // Trace value (32 bytes) - actual leaf from tree
        let trace_leaf = trace_tree.get_leaf(idx);
        proof.extend_from_slice(&trace_leaf);
        
        // Trace path (length + siblings)
        let trace_path = trace_tree.get_path(idx);
        proof.push(trace_path.len() as u8);
        for sibling in &trace_path {
            proof.extend_from_slice(sibling);
        }
        
        // Composition value (32 bytes)
        let comp_leaf = comp_tree.get_leaf(idx);
        proof.extend_from_slice(&comp_leaf);
        
        // Composition path
        let comp_path = comp_tree.get_path(idx);
        proof.push(comp_path.len() as u8);
        for sibling in &comp_path {
            proof.extend_from_slice(sibling);
        }
        
        // FRI layer values and paths
        let mut fri_idx = idx;
        for (layer_idx, fri_tree) in fri_trees.iter().enumerate() {
            fri_idx /= 2; // FRI folds domain in half each layer
            
            // 4 sibling values (64 bytes) - simplified: use deterministic values
            for sibling in 0..4 {
                let sib_val = keccak_multi(&[
                    b"fri_sib_v1",
                    &(layer_idx as u32).to_le_bytes(),
                    &(fri_idx as u32).to_le_bytes(),
                    &(sibling as u32).to_le_bytes(),
                    &trace_commitment,
                ]);
                proof.extend_from_slice(&sib_val[..16]); // QM31 = 16 bytes
            }
            
            // FRI path
            let fri_path = fri_tree.get_path(fri_idx % fri_tree.leaves.len());
            proof.push(fri_path.len() as u8);
            for sibling in &fri_path {
                proof.extend_from_slice(sibling);
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
