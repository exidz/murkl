//! On-chain STARK Verifier for Murkl
//!
//! Minimal Circle STARK verifier optimized for Solana BPF.
//! Uses keccak256 for Merkle/channel, M31 field ops for constraints.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

/// M31 prime: p = 2^31 - 1
pub const P: u32 = 0x7FFFFFFF;

/// QM31 extension field element (4 M31 components)
#[derive(Clone, Copy, Debug, Default, AnchorSerialize, AnchorDeserialize)]
pub struct QM31 {
    pub a: u32, // real part of first complex
    pub b: u32, // imag part of first complex
    pub c: u32, // real part of second complex
    pub d: u32, // imag part of second complex
}

/// Circle point in QM31
#[derive(Clone, Copy, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct CirclePoint {
    pub x: QM31,
    pub y: QM31,
}

/// FRI layer proof
#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct FriLayerProof {
    pub commitment: [u8; 32],
    pub evaluations: Vec<QM31>,
    pub merkle_paths: Vec<Vec<[u8; 32]>>,
}

/// Complete STARK proof
#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct StarkProof {
    /// Trace commitment
    pub trace_commitment: [u8; 32],
    /// Composition polynomial commitment  
    pub composition_commitment: [u8; 32],
    /// OODS (out-of-domain sampling) evaluations
    pub oods_values: Vec<QM31>,
    /// FRI layers
    pub fri_layers: Vec<FriLayerProof>,
    /// Last layer polynomial coefficients
    pub last_layer_poly: Vec<QM31>,
    /// Query positions
    pub query_positions: Vec<u32>,
    /// Merkle proofs for trace queries
    pub trace_decommitments: Vec<Vec<[u8; 32]>>,
}

/// Verifier configuration
#[derive(Clone, Debug)]
pub struct VerifierConfig {
    pub log_trace_size: u32,
    pub log_blowup_factor: u32,
    pub n_queries: usize,
    pub log_last_layer_degree: u32,
}

impl Default for VerifierConfig {
    fn default() -> Self {
        Self {
            log_trace_size: 8,        // 256 rows
            log_blowup_factor: 2,     // 4x blowup
            n_queries: 3,             // 3 queries
            log_last_layer_degree: 2, // degree 4 final poly
        }
    }
}

// ============================================================================
// M31 Field Operations
// ============================================================================

#[inline(always)]
pub fn m31_add(a: u32, b: u32) -> u32 {
    let sum = (a as u64) + (b as u64);
    let result = if sum >= P as u64 { sum - P as u64 } else { sum };
    result as u32
}

#[inline(always)]
pub fn m31_sub(a: u32, b: u32) -> u32 {
    if a >= b {
        a - b
    } else {
        P - (b - a)
    }
}

#[inline(always)]
pub fn m31_mul(a: u32, b: u32) -> u32 {
    let prod = (a as u64) * (b as u64);
    // Reduce mod 2^31 - 1 using: x mod p = (x & p) + (x >> 31)
    let lo = (prod & (P as u64)) as u32;
    let hi = (prod >> 31) as u32;
    let sum = lo + hi;
    if sum >= P { sum - P } else { sum }
}

#[inline(always)]
pub fn m31_neg(a: u32) -> u32 {
    if a == 0 { 0 } else { P - a }
}

/// Extended Euclidean algorithm for inverse
pub fn m31_inv(a: u32) -> u32 {
    if a == 0 { return 0; }
    
    let mut t: i64 = 0;
    let mut newt: i64 = 1;
    let mut r: i64 = P as i64;
    let mut newr: i64 = a as i64;
    
    while newr != 0 {
        let quotient = r / newr;
        (t, newt) = (newt, t - quotient * newt);
        (r, newr) = (newr, r - quotient * newr);
    }
    
    if t < 0 { t += P as i64; }
    t as u32
}

// ============================================================================
// QM31 Extension Field Operations
// ============================================================================

impl QM31 {
    pub fn zero() -> Self {
        Self { a: 0, b: 0, c: 0, d: 0 }
    }
    
    pub fn one() -> Self {
        Self { a: 1, b: 0, c: 0, d: 0 }
    }
    
    pub fn from_m31(v: u32) -> Self {
        Self { a: v % P, b: 0, c: 0, d: 0 }
    }
    
    pub fn add(&self, other: &Self) -> Self {
        Self {
            a: m31_add(self.a, other.a),
            b: m31_add(self.b, other.b),
            c: m31_add(self.c, other.c),
            d: m31_add(self.d, other.d),
        }
    }
    
    pub fn sub(&self, other: &Self) -> Self {
        Self {
            a: m31_sub(self.a, other.a),
            b: m31_sub(self.b, other.b),
            c: m31_sub(self.c, other.c),
            d: m31_sub(self.d, other.d),
        }
    }
    
    /// QM31 multiplication
    /// QM31 = CM31[u] / (u^2 - 2 - i) where CM31 = M31[i] / (i^2 + 1)
    pub fn mul(&self, other: &Self) -> Self {
        let (a0, a1, a2, a3) = (self.a, self.b, self.c, self.d);
        let (b0, b1, b2, b3) = (other.a, other.b, other.c, other.d);
        
        let a0b0 = m31_mul(a0, b0);
        let a1b1 = m31_mul(a1, b1);
        let a2b2 = m31_mul(a2, b2);
        let a3b3 = m31_mul(a3, b3);
        let a0b1 = m31_mul(a0, b1);
        let a1b0 = m31_mul(a1, b0);
        let a2b3 = m31_mul(a2, b3);
        let a3b2 = m31_mul(a3, b2);
        let a0b2 = m31_mul(a0, b2);
        let a1b3 = m31_mul(a1, b3);
        let a2b0 = m31_mul(a2, b0);
        let a3b1 = m31_mul(a3, b1);
        let a0b3 = m31_mul(a0, b3);
        let a1b2 = m31_mul(a1, b2);
        let a2b1 = m31_mul(a2, b1);
        let a3b0 = m31_mul(a3, b0);
        
        let t1 = m31_sub(a2b2, a3b3);
        let t2 = m31_add(a2b3, a3b2);
        
        Self {
            a: m31_sub(m31_add(m31_sub(a0b0, a1b1), m31_add(t1, t1)), t2),
            b: m31_add(m31_add(m31_add(a0b1, a1b0), m31_add(t2, t2)), t1),
            c: m31_sub(m31_add(a0b2, a2b0), m31_add(a1b3, a3b1)),
            d: m31_add(m31_add(a0b3, a3b0), m31_add(a1b2, a2b1)),
        }
    }
}

// ============================================================================
// Channel (Fiat-Shamir)
// ============================================================================

pub struct Channel {
    state: [u8; 32],
}

impl Channel {
    pub fn new() -> Self {
        Self { state: [0u8; 32] }
    }
    
    pub fn mix(&mut self, data: &[u8]) {
        let hash = keccak::hashv(&[&self.state, data]);
        self.state = hash.0;
    }
    
    pub fn mix_commitment(&mut self, commitment: &[u8; 32]) {
        self.mix(commitment);
    }
    
    pub fn draw_felt(&mut self) -> QM31 {
        let hash = keccak::hashv(&[&self.state, b"felt"]);
        self.state = hash.0;
        
        QM31 {
            a: u32::from_le_bytes([hash.0[0], hash.0[1], hash.0[2], hash.0[3]]) % P,
            b: u32::from_le_bytes([hash.0[4], hash.0[5], hash.0[6], hash.0[7]]) % P,
            c: u32::from_le_bytes([hash.0[8], hash.0[9], hash.0[10], hash.0[11]]) % P,
            d: u32::from_le_bytes([hash.0[12], hash.0[13], hash.0[14], hash.0[15]]) % P,
        }
    }
}

// ============================================================================
// Merkle Verification
// ============================================================================

pub fn verify_merkle_path(
    root: &[u8; 32],
    leaf: &[u8; 32],
    index: u32,
    path: &[[u8; 32]],
) -> bool {
    let mut current = *leaf;
    let mut idx = index;
    
    for sibling in path.iter() {
        current = if idx % 2 == 0 {
            keccak::hashv(&[&current, sibling]).0
        } else {
            keccak::hashv(&[sibling, &current]).0
        };
        idx /= 2;
    }
    
    current == *root
}

pub fn hash_qm31(val: &QM31) -> [u8; 32] {
    let mut data = [0u8; 16];
    data[0..4].copy_from_slice(&val.a.to_le_bytes());
    data[4..8].copy_from_slice(&val.b.to_le_bytes());
    data[8..12].copy_from_slice(&val.c.to_le_bytes());
    data[12..16].copy_from_slice(&val.d.to_le_bytes());
    keccak::hashv(&[&data]).0
}

// ============================================================================
// Main Verifier (returns bool for simplicity)
// ============================================================================

/// Verify a STARK proof
/// Returns true if valid, false otherwise
/// 
/// NOTE: For hackathon demo, this does structural validation.
/// Full cryptographic verification requires matching proof format
/// between WASM prover and on-chain verifier.
pub fn verify_stark_proof(
    proof: &StarkProof,
    _config: &VerifierConfig,
    public_input: &[u32],
) -> bool {
    // Basic structural checks
    
    // 1. Check proof has required fields
    if proof.trace_commitment == [0u8; 32] {
        msg!("Invalid: empty trace commitment");
        return false;
    }
    
    if proof.composition_commitment == [0u8; 32] {
        msg!("Invalid: empty composition commitment");
        return false;
    }
    
    // 2. Check public input present
    if public_input.is_empty() {
        msg!("Invalid: no public input");
        return false;
    }
    
    // 3. Mix commitments through channel (Fiat-Shamir binding)
    let mut channel = Channel::new();
    
    for &val in public_input {
        channel.mix(&val.to_le_bytes());
    }
    channel.mix_commitment(&proof.trace_commitment);
    channel.mix_commitment(&proof.composition_commitment);
    
    // 4. Check OODS values present
    if proof.oods_values.is_empty() {
        msg!("Invalid: no OODS values");
        return false;
    }
    
    // 5. Check FRI layers present
    if proof.fri_layers.is_empty() {
        msg!("Invalid: no FRI layers");
        return false;
    }
    
    // 6. Check last layer poly present
    if proof.last_layer_poly.is_empty() {
        msg!("Invalid: no last layer polynomial");
        return false;
    }
    
    msg!("STARK proof structure valid ({} FRI layers, {} OODS values)", 
        proof.fri_layers.len(), proof.oods_values.len());
    
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_m31_ops() {
        assert_eq!(m31_add(P - 1, 2), 1);
        assert_eq!(m31_mul(2, 3), 6);
        assert_eq!(m31_mul(P - 1, 2), P - 2);
        
        let a = 12345u32;
        let a_inv = m31_inv(a);
        assert_eq!(m31_mul(a, a_inv), 1);
    }
    
    #[test]
    fn test_qm31_mul() {
        let one = QM31::one();
        let two = QM31::from_m31(2);
        let result = one.mul(&two);
        assert_eq!(result.a, 2);
        assert_eq!(result.b, 0);
        assert_eq!(result.c, 0);
        assert_eq!(result.d, 0);
    }
    
    #[test]
    fn test_channel() {
        let mut ch = Channel::new();
        ch.mix(b"test");
        let f1 = ch.draw_felt();
        let f2 = ch.draw_felt();
        assert!(f1.a != f2.a || f1.b != f2.b);
    }
}
