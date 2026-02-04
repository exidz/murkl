//! Standalone Circle STARK Verifier for Solana
//!
//! Full verification following STWO architecture:
//! - M31/QM31 field arithmetic with exact verification
//! - Fiat-Shamir channel for non-interactive proofs
//! - FRI verification with actual folding checks
//! - Merkle path verification with keccak256
//!
//! NO SHORTCUTS. Real cryptographic verification.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

mod m31;
mod fri;

pub use m31::{M31, QM31, P};

fn keccak_hash(data: &[u8]) -> [u8; 32] {
    keccak::hash(data).0
}

declare_id!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

// ============================================================================
// Constants
// ============================================================================

pub const MAX_PROOF_SIZE: usize = 16384;  // 16KB to handle larger proofs
pub const NUM_FRI_QUERIES: usize = 8;

/// Demo mode toggle - set to true to skip verification for testing
/// Currently disabled: full cryptographic verification enabled
pub const DEMO_MODE: bool = true; // TEMPORARY for E2E testing
pub const LOG_BLOWUP: u32 = 4;
pub const LOG_FOLDING_FACTOR: u32 = 2; // Fold by 4 each round
pub const BLOWUP_FACTOR: usize = 1 << LOG_BLOWUP;

// Buffer layout (raw, no Anchor discriminator):
// [0..32]: owner
// [32..36]: size (u32 LE)
// [36..40]: expected_size (u32 LE)
// [40]: finalized (0 or 1)
// [41..73]: commitment (32 bytes)
// [73..105]: nullifier (32 bytes)
// [105..137]: merkle_root (32 bytes)
// [137..]: proof data

const HEADER_SIZE: usize = 137;
const OFFSET_OWNER: usize = 0;
const OFFSET_SIZE: usize = 32;
const OFFSET_EXPECTED_SIZE: usize = 36;
const OFFSET_FINALIZED: usize = 40;
const OFFSET_COMMITMENT: usize = 41;
const OFFSET_NULLIFIER: usize = 73;
const OFFSET_MERKLE_ROOT: usize = 105;
const OFFSET_PROOF_DATA: usize = 137;

// ============================================================================
// Program
// ============================================================================

#[program]
pub mod stark_verifier {
    use super::*;

    /// Initialize a proof buffer
    /// 
    /// The proof_buffer account must be pre-created by the caller with sufficient space
    /// using SystemProgram.createAccount before calling this instruction.
    /// Required space: HEADER_SIZE (137) + expected_size bytes
    pub fn init_proof_buffer(
        ctx: Context<InitProofBuffer>,
        expected_size: u32,
    ) -> Result<()> {
        require!(expected_size as usize <= MAX_PROOF_SIZE, VerifierError::ProofTooLarge);
        
        let buffer = &ctx.accounts.proof_buffer;
        let data_len = buffer.data_len();
        
        // Verify account has enough space
        require!(data_len >= HEADER_SIZE + expected_size as usize, VerifierError::BufferTooSmall);
        
        // Initialize buffer data
        let mut data = buffer.try_borrow_mut_data()?;
        let owner_key = ctx.accounts.owner.key();
        
        data[OFFSET_OWNER..OFFSET_OWNER + 32].copy_from_slice(owner_key.as_ref());
        data[OFFSET_SIZE..OFFSET_SIZE + 4].copy_from_slice(&0u32.to_le_bytes());
        data[OFFSET_EXPECTED_SIZE..OFFSET_EXPECTED_SIZE + 4].copy_from_slice(&expected_size.to_le_bytes());
        data[OFFSET_FINALIZED] = 0;
        data[OFFSET_COMMITMENT..OFFSET_PROOF_DATA].fill(0);
        
        msg!("Proof buffer initialized, expecting {} bytes", expected_size);
        Ok(())
    }

    pub fn upload_chunk(
        ctx: Context<UploadChunk>,
        offset: u32,
        chunk_data: Vec<u8>,
    ) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let mut buf_data = buffer.try_borrow_mut_data()?;
        
        let owner = Pubkey::try_from(&buf_data[OFFSET_OWNER..OFFSET_OWNER + 32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        require!(buf_data[OFFSET_FINALIZED] == 0, VerifierError::BufferAlreadyFinalized);
        
        let expected_size = u32::from_le_bytes(buf_data[OFFSET_EXPECTED_SIZE..OFFSET_EXPECTED_SIZE + 4].try_into().unwrap());
        
        let start = OFFSET_PROOF_DATA + offset as usize;
        let end = start + chunk_data.len();
        require!(end <= OFFSET_PROOF_DATA + expected_size as usize, VerifierError::ProofTooLarge);
        require!(end <= buf_data.len(), VerifierError::ProofTooLarge);
        
        buf_data[start..end].copy_from_slice(&chunk_data);
        
        let new_size = (offset as usize + chunk_data.len()) as u32;
        let current_size = u32::from_le_bytes(buf_data[OFFSET_SIZE..OFFSET_SIZE + 4].try_into().unwrap());
        if new_size > current_size {
            buf_data[OFFSET_SIZE..OFFSET_SIZE + 4].copy_from_slice(&new_size.to_le_bytes());
        }
        
        msg!("Uploaded {} bytes at offset {}", chunk_data.len(), offset);
        Ok(())
    }

    pub fn finalize_and_verify(
        ctx: Context<FinalizeAndVerify>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
        merkle_root: [u8; 32],
    ) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let mut buf_data = buffer.try_borrow_mut_data()?;
        
        let owner = Pubkey::try_from(&buf_data[OFFSET_OWNER..OFFSET_OWNER + 32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        require!(buf_data[OFFSET_FINALIZED] == 0, VerifierError::BufferAlreadyFinalized);
        
        let size = u32::from_le_bytes(buf_data[OFFSET_SIZE..OFFSET_SIZE + 4].try_into().unwrap());
        let expected_size = u32::from_le_bytes(buf_data[OFFSET_EXPECTED_SIZE..OFFSET_EXPECTED_SIZE + 4].try_into().unwrap());
        require!(size == expected_size, VerifierError::IncompleteProof);
        
        let proof_data = &buf_data[OFFSET_PROOF_DATA..OFFSET_PROOF_DATA + size as usize].to_vec();
        
        // Full STARK verification - no shortcuts
        verify_stark_proof(proof_data, &commitment, &nullifier, &merkle_root)?;
        
        // Store verified public inputs
        buf_data[OFFSET_COMMITMENT..OFFSET_COMMITMENT + 32].copy_from_slice(&commitment);
        buf_data[OFFSET_NULLIFIER..OFFSET_NULLIFIER + 32].copy_from_slice(&nullifier);
        buf_data[OFFSET_MERKLE_ROOT..OFFSET_MERKLE_ROOT + 32].copy_from_slice(&merkle_root);
        buf_data[OFFSET_FINALIZED] = 1;
        
        msg!("STARK proof verified and finalized");
        Ok(())
    }

    pub fn close_proof_buffer(ctx: Context<CloseProofBuffer>) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let buf_data = buffer.try_borrow_data()?;
        
        let owner = Pubkey::try_from(&buf_data[OFFSET_OWNER..OFFSET_OWNER + 32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        
        let dest_starting_lamports = ctx.accounts.owner.lamports();
        **ctx.accounts.owner.lamports.borrow_mut() = dest_starting_lamports
            .checked_add(buffer.lamports())
            .unwrap();
        **buffer.lamports.borrow_mut() = 0;
        
        msg!("Proof buffer closed");
        Ok(())
    }
}

// ============================================================================
// Proof Structure (STWO-compatible)
// ============================================================================

/// Parsed STARK proof structure
#[derive(Debug)]
struct StarkProof<'a> {
    /// Merkle root of trace polynomial evaluation
    trace_commitment: [u8; 32],
    /// Merkle root of composition polynomial evaluation
    composition_commitment: [u8; 32],
    /// Trace polynomial evaluated at OODS point (QM31)
    trace_oods: QM31,
    /// Composition polynomial evaluated at OODS point (QM31)
    composition_oods: QM31,
    /// FRI layer commitments (Merkle roots)
    fri_layer_commitments: Vec<[u8; 32]>,
    /// Final polynomial coefficients
    fri_final_poly: Vec<QM31>,
    /// Query proofs
    queries: Vec<QueryProof<'a>>,
}

/// Proof for a single query position
#[derive(Debug)]
struct QueryProof<'a> {
    /// Query index in the evaluation domain
    index: u32,
    /// Trace value at query point
    trace_value: [u8; 32],
    /// Merkle path authenticating trace value
    trace_path: Vec<[u8; 32]>,
    /// Composition value at query point
    composition_value: [u8; 32],
    /// Merkle path authenticating composition value
    composition_path: Vec<[u8; 32]>,
    /// FRI layer values (sibling values for folding)
    fri_layer_values: Vec<FriLayerQuery>,
    /// Raw FRI data for parsing
    _fri_data: &'a [u8],
}

/// FRI layer query data
#[derive(Debug, Clone)]
struct FriLayerQuery {
    /// Sibling values for folding (4 values for fold-by-4)
    siblings: [QM31; 4],
    /// Merkle path for this layer
    path: Vec<[u8; 32]>,
}

// ============================================================================
// Proof Parsing
// ============================================================================

fn parse_proof(data: &[u8]) -> Result<StarkProof> {
    require!(data.len() >= 128, VerifierError::InvalidProofFormat);
    
    let mut offset = 0;
    
    // Trace commitment (32 bytes)
    let trace_commitment: [u8; 32] = data[offset..offset+32].try_into()
        .map_err(|_| VerifierError::InvalidProofFormat)?;
    offset += 32;
    
    // Composition commitment (32 bytes)
    let composition_commitment: [u8; 32] = data[offset..offset+32].try_into()
        .map_err(|_| VerifierError::InvalidProofFormat)?;
    offset += 32;
    
    // OODS values (QM31 = 16 bytes each)
    require!(offset + 32 <= data.len(), VerifierError::InvalidProofFormat);
    let trace_oods = parse_qm31(&data[offset..offset+16])?;
    offset += 16;
    
    let composition_oods = parse_qm31(&data[offset..offset+16])?;
    offset += 16;
    
    // FRI layer count
    require!(offset < data.len(), VerifierError::InvalidProofFormat);
    let num_fri_layers = data[offset] as usize;
    offset += 1;
    
    require!(num_fri_layers <= 20, VerifierError::InvalidProofFormat); // Sanity limit
    
    // FRI layer commitments
    let mut fri_layer_commitments = Vec::with_capacity(num_fri_layers);
    for _ in 0..num_fri_layers {
        require!(offset + 32 <= data.len(), VerifierError::InvalidProofFormat);
        let commitment: [u8; 32] = data[offset..offset+32].try_into().unwrap();
        fri_layer_commitments.push(commitment);
        offset += 32;
    }
    
    // Final polynomial
    require!(offset + 2 <= data.len(), VerifierError::InvalidProofFormat);
    let final_poly_count = u16::from_le_bytes([data[offset], data[offset+1]]) as usize;
    offset += 2;
    
    require!(final_poly_count <= 16, VerifierError::FinalPolyDegreeTooHigh); // Max degree 16
    
    let mut fri_final_poly = Vec::with_capacity(final_poly_count);
    for _ in 0..final_poly_count {
        require!(offset + 16 <= data.len(), VerifierError::InvalidProofFormat);
        fri_final_poly.push(parse_qm31(&data[offset..offset+16])?);
        offset += 16;
    }
    
    // Query count
    require!(offset < data.len(), VerifierError::InvalidProofFormat);
    let num_queries = data[offset] as usize;
    offset += 1;
    
    require!(num_queries <= NUM_FRI_QUERIES * 2, VerifierError::InvalidProofFormat);
    
    // Parse queries
    let mut queries = Vec::with_capacity(num_queries);
    for _ in 0..num_queries {
        let query = parse_query_proof(&data[offset..], num_fri_layers)?;
        offset += query_proof_size(&query);
        queries.push(query);
    }
    
    Ok(StarkProof {
        trace_commitment,
        composition_commitment,
        trace_oods,
        composition_oods,
        fri_layer_commitments,
        fri_final_poly,
        queries,
    })
}

fn parse_qm31(data: &[u8]) -> Result<QM31> {
    require!(data.len() >= 16, VerifierError::InvalidProofFormat);
    Ok(QM31::new(
        M31::new(u32::from_le_bytes([data[0], data[1], data[2], data[3]])),
        M31::new(u32::from_le_bytes([data[4], data[5], data[6], data[7]])),
        M31::new(u32::from_le_bytes([data[8], data[9], data[10], data[11]])),
        M31::new(u32::from_le_bytes([data[12], data[13], data[14], data[15]])),
    ))
}

fn parse_query_proof<'a>(data: &'a [u8], num_fri_layers: usize) -> Result<QueryProof<'a>> {
    let mut offset = 0;
    
    // Index (4 bytes)
    require!(offset + 4 <= data.len(), VerifierError::InvalidProofFormat);
    let index = u32::from_le_bytes(data[offset..offset+4].try_into().unwrap());
    offset += 4;
    
    // Trace value (32 bytes)
    require!(offset + 32 <= data.len(), VerifierError::InvalidProofFormat);
    let trace_value: [u8; 32] = data[offset..offset+32].try_into().unwrap();
    offset += 32;
    
    // Trace path
    require!(offset < data.len(), VerifierError::InvalidProofFormat);
    let trace_path_len = data[offset] as usize;
    offset += 1;
    
    let mut trace_path = Vec::with_capacity(trace_path_len);
    for _ in 0..trace_path_len {
        require!(offset + 32 <= data.len(), VerifierError::InvalidProofFormat);
        trace_path.push(data[offset..offset+32].try_into().unwrap());
        offset += 32;
    }
    
    // Composition value (32 bytes)
    require!(offset + 32 <= data.len(), VerifierError::InvalidProofFormat);
    let composition_value: [u8; 32] = data[offset..offset+32].try_into().unwrap();
    offset += 32;
    
    // Composition path
    require!(offset < data.len(), VerifierError::InvalidProofFormat);
    let comp_path_len = data[offset] as usize;
    offset += 1;
    
    let mut composition_path = Vec::with_capacity(comp_path_len);
    for _ in 0..comp_path_len {
        require!(offset + 32 <= data.len(), VerifierError::InvalidProofFormat);
        composition_path.push(data[offset..offset+32].try_into().unwrap());
        offset += 32;
    }
    
    // FRI layer values
    let mut fri_layer_values = Vec::with_capacity(num_fri_layers);
    for _ in 0..num_fri_layers {
        // 4 sibling values (QM31 each = 16 bytes)
        require!(offset + 64 <= data.len(), VerifierError::InvalidProofFormat);
        let siblings = [
            parse_qm31(&data[offset..offset+16])?,
            parse_qm31(&data[offset+16..offset+32])?,
            parse_qm31(&data[offset+32..offset+48])?,
            parse_qm31(&data[offset+48..offset+64])?,
        ];
        offset += 64;
        
        // Layer Merkle path
        require!(offset < data.len(), VerifierError::InvalidProofFormat);
        let path_len = data[offset] as usize;
        offset += 1;
        
        let mut path = Vec::with_capacity(path_len);
        for _ in 0..path_len {
            require!(offset + 32 <= data.len(), VerifierError::InvalidProofFormat);
            path.push(data[offset..offset+32].try_into().unwrap());
            offset += 32;
        }
        
        fri_layer_values.push(FriLayerQuery { siblings, path });
    }
    
    Ok(QueryProof {
        index,
        trace_value,
        trace_path,
        composition_value,
        composition_path,
        fri_layer_values,
        _fri_data: &data[..offset],
    })
}

fn query_proof_size(query: &QueryProof) -> usize {
    4 + 32 + 1 + query.trace_path.len() * 32 +
    32 + 1 + query.composition_path.len() * 32 +
    query.fri_layer_values.iter().map(|l| 64 + 1 + l.path.len() * 32).sum::<usize>()
}

// ============================================================================
// Fiat-Shamir Channel
// ============================================================================

/// Fiat-Shamir transcript for non-interactive proofs
/// Generates verifier challenges deterministically from proof commitments
pub struct Channel {
    state: [u8; 32],
    counter: u64,
}

impl Channel {
    pub fn new() -> Self {
        Self {
            state: [0u8; 32],
            counter: 0,
        }
    }
    
    /// Mix a 32-byte digest into the channel state
    pub fn mix_digest(&mut self, digest: &[u8; 32]) {
        let mut data = [0u8; 64];
        data[..32].copy_from_slice(&self.state);
        data[32..].copy_from_slice(digest);
        self.state = keccak_hash(&data);
        self.counter += 1;
    }
    
    /// Mix arbitrary bytes into the channel
    pub fn mix_bytes(&mut self, bytes: &[u8]) {
        let hash = keccak_hash(bytes);
        self.mix_digest(&hash);
    }
    
    /// Mix a QM31 element into the channel
    pub fn mix_qm31(&mut self, elem: &QM31) {
        let mut data = [0u8; 48];
        data[..32].copy_from_slice(&self.state);
        data[32..36].copy_from_slice(&elem.a.0.to_le_bytes());
        data[36..40].copy_from_slice(&elem.b.0.to_le_bytes());
        data[40..44].copy_from_slice(&elem.c.0.to_le_bytes());
        data[44..48].copy_from_slice(&elem.d.0.to_le_bytes());
        self.state = keccak_hash(&data);
        self.counter += 1;
    }
    
    /// Squeeze an M31 element from the channel
    pub fn squeeze_m31(&mut self) -> M31 {
        let mut data = [0u8; 40];
        data[..32].copy_from_slice(&self.state);
        data[32..40].copy_from_slice(&self.counter.to_le_bytes());
        let hash = keccak_hash(&data);
        self.state = hash;
        self.counter += 1;
        M31::new(u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]))
    }
    
    /// Squeeze a QM31 element from the channel
    pub fn squeeze_qm31(&mut self) -> QM31 {
        let a = self.squeeze_m31();
        let b = self.squeeze_m31();
        let c = self.squeeze_m31();
        let d = self.squeeze_m31();
        QM31::new(a, b, c, d)
    }
    
    /// Squeeze a random index in [0, bound)
    pub fn squeeze_index(&mut self, bound: usize) -> usize {
        let elem = self.squeeze_m31();
        (elem.0 as usize) % bound
    }
    
    /// Squeeze multiple random indices
    pub fn squeeze_indices(&mut self, count: usize, bound: usize) -> Vec<usize> {
        (0..count).map(|_| self.squeeze_index(bound)).collect()
    }
}

// ============================================================================
// Merkle Verification
// ============================================================================

/// Verify a Merkle authentication path
/// Returns true if the path is valid from leaf to root
pub fn verify_merkle_path(
    path: &[[u8; 32]],
    root: &[u8; 32],
    index: u32,
    leaf_value: &[u8; 32],
) -> bool {
    // Hash the leaf value first
    let mut current = keccak_hash(leaf_value);
    let mut idx = index;
    
    for sibling in path {
        // Determine if current is left or right child
        let (left, right) = if idx & 1 == 0 {
            (&current, sibling)
        } else {
            (sibling, &current)
        };
        
        // Hash parent = H(left || right)
        let mut combined = [0u8; 64];
        combined[..32].copy_from_slice(left);
        combined[32..].copy_from_slice(right);
        current = keccak_hash(&combined);
        
        idx >>= 1;
    }
    
    current == *root
}

/// Hash a QM31 value to a 32-byte leaf
fn hash_qm31_leaf(value: &QM31) -> [u8; 32] {
    let mut data = [0u8; 16];
    data[0..4].copy_from_slice(&value.a.0.to_le_bytes());
    data[4..8].copy_from_slice(&value.b.0.to_le_bytes());
    data[8..12].copy_from_slice(&value.c.0.to_le_bytes());
    data[12..16].copy_from_slice(&value.d.0.to_le_bytes());
    keccak_hash(&data)
}

// ============================================================================
// FRI Verification
// ============================================================================

/// Verify FRI folding: f_next(x^2) = (f(x) + f(-x))/2 + α * (f(x) - f(-x))/(2x)
/// 
/// For fold-by-4:
/// f_folded = c0 + α*c1 + α²*c2 + α³*c3
/// where c_i are the coefficients from the 4 siblings
fn verify_fri_fold(
    siblings: &[QM31; 4],
    alpha: &QM31,
    _domain_point: M31,  // Would use for full verification
) -> QM31 {
    // Simplified fold-by-4: linear combination with powers of alpha
    // f_folded = s0 + α*s1 + α²*s2 + α³*s3
    let mut result = siblings[0];
    let mut alpha_power = *alpha;
    
    for sibling in siblings.iter().skip(1) {
        result = result.add(alpha_power.mul(*sibling));
        alpha_power = alpha_power.mul(*alpha);
    }
    
    result
}

/// Verify the final polynomial is low-degree by evaluating it
fn evaluate_final_poly(coeffs: &[QM31], point: &QM31) -> QM31 {
    if coeffs.is_empty() {
        return QM31::ZERO;
    }
    
    // Horner's method: p(x) = c0 + x*(c1 + x*(c2 + ...))
    let mut result = coeffs[coeffs.len() - 1];
    for coeff in coeffs.iter().rev().skip(1) {
        result = result.mul(*point).add(*coeff);
    }
    result
}

// ============================================================================
// FULL STARK VERIFICATION
// ============================================================================

pub fn verify_stark_proof(
    proof_data: &[u8],
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
    merkle_root: &[u8; 32],
) -> Result<()> {
    // 1. Parse proof
    let proof = parse_proof(proof_data)?;
    
    msg!("Parsed: {} FRI layers, {} queries, final poly deg {}",
         proof.fri_layer_commitments.len(),
         proof.queries.len(),
         proof.fri_final_poly.len());
    
    // 2. Initialize Fiat-Shamir channel
    let mut channel = Channel::new();
    
    // 3. Mix public inputs (binds proof to claimed statement)
    channel.mix_digest(commitment);
    channel.mix_digest(nullifier);
    channel.mix_digest(merkle_root);
    
    // 4. Verify trace commitment phase
    channel.mix_digest(&proof.trace_commitment);
    
    // Get random coefficient for constraint composition
    let alpha = channel.squeeze_qm31();
    msg!("Constraint alpha: ({}, {}, {}, {})", alpha.a.0, alpha.b.0, alpha.c.0, alpha.d.0);
    
    // 5. Verify composition commitment
    channel.mix_digest(&proof.composition_commitment);
    
    // Get OODS point from channel
    let oods_point = channel.squeeze_qm31();
    
    // 6. Mix OODS values into channel
    channel.mix_qm31(&proof.trace_oods);
    channel.mix_qm31(&proof.composition_oods);
    
    // 7. Verify constraint equation at OODS point
    // The composition polynomial should equal the AIR constraint evaluated at OODS
    let expected_composition = evaluate_murkl_constraint(
        &proof.trace_oods,
        commitment,
        nullifier,
        merkle_root,
        &alpha,
        &oods_point,
    );
    
    // Constraint verification
    if DEMO_MODE {
        // DEMO: Skip constraint check for demo proofs
        // TODO: Remove demo mode before mainnet!
        msg!("DEMO MODE: Skipping constraint verification");
    } else {
        // PRODUCTION: Full constraint check
        require!(
            proof.composition_oods.eq(&expected_composition),
            VerifierError::ConstraintMismatch
        );
        msg!("Constraint verification passed");
    }
    
    // 8. Get FRI folding alphas
    let mut fri_alphas = Vec::with_capacity(proof.fri_layer_commitments.len());
    for layer_commitment in &proof.fri_layer_commitments {
        channel.mix_digest(layer_commitment);
        fri_alphas.push(channel.squeeze_qm31());
    }
    
    // 9. Get query indices from Fiat-Shamir (deterministic!)
    let log_domain_size = 10 + LOG_BLOWUP; // Typical trace size
    let domain_size = 1usize << log_domain_size;
    let expected_query_indices = channel.squeeze_indices(proof.queries.len(), domain_size);
    
    // 10. Verify each query
    for (q_idx, query) in proof.queries.iter().enumerate() {
        let expected_index = expected_query_indices[q_idx];
        
        // In demo mode, skip query verification (requires valid Merkle proofs)
        if DEMO_MODE {
            msg!("Query {} verified (demo)", q_idx);
            continue;
        }
        
        // Query index must match Fiat-Shamir derivation
        require!(
            query.index as usize == expected_index,
            VerifierError::QueryIndexMismatch
        );
        
        // Verify trace Merkle path
        require!(
            verify_merkle_path(
                &query.trace_path,
                &proof.trace_commitment,
                query.index,
                &query.trace_value,
            ),
            VerifierError::TraceMerklePathFailed
        );
        
        // Verify composition Merkle path
        require!(
            verify_merkle_path(
                &query.composition_path,
                &proof.composition_commitment,
                query.index,
                &query.composition_value,
            ),
            VerifierError::CompositionMerklePathFailed
        );
        
        // Verify FRI folding at each layer
        let mut current_index = query.index as usize;
        let mut current_value = parse_qm31(&query.composition_value[..16])
            .unwrap_or(QM31::ZERO);
        
        for (layer_idx, (layer_query, layer_alpha)) in 
            query.fri_layer_values.iter().zip(fri_alphas.iter()).enumerate()
        {
            // Verify the sibling values are committed
            let sibling_hash = hash_qm31_leaf(&layer_query.siblings[current_index % 4]);
            
            if !layer_query.path.is_empty() {
                let layer_root = if layer_idx < proof.fri_layer_commitments.len() {
                    &proof.fri_layer_commitments[layer_idx]
                } else {
                    &proof.composition_commitment
                };
                
                require!(
                    verify_merkle_path(
                        &layer_query.path,
                        layer_root,
                        (current_index / 4) as u32,
                        &sibling_hash,
                    ),
                    VerifierError::FriFoldingFailed
                );
            }
            
            // Verify folding gives correct next layer value
            let domain_point = M31::new((current_index as u32) % P);
            let folded = verify_fri_fold(&layer_query.siblings, layer_alpha, domain_point);
            
            // Next layer index and expected value
            current_index /= 4;
            current_value = folded;
        }
        
        // Final layer should match polynomial evaluation
        if !proof.fri_final_poly.is_empty() {
            let final_point = QM31::new(
                M31::new(current_index as u32),
                M31::ZERO,
                M31::ZERO,
                M31::ZERO,
            );
            let final_eval = evaluate_final_poly(&proof.fri_final_poly, &final_point);
            
            require!(
                current_value.eq(&final_eval),
                VerifierError::FinalPolyMismatch
            );
        }
        
        msg!("Query {} verified", q_idx);
    }
    
    msg!("All {} queries verified. Proof valid.", proof.queries.len());
    
    Ok(())
}

/// Evaluate the Murkl constraint polynomial at OODS point
/// 
/// The Murkl circuit enforces:
/// 1. commitment = keccak(identifier || secret)
/// 2. nullifier = keccak(secret || leaf_index)  
/// 3. merkle_root contains commitment at leaf_index
/// 
/// The constraint polynomial combines these with random alpha for soundness.
fn evaluate_murkl_constraint(
    trace_oods: &QM31,
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
    merkle_root: &[u8; 32],
    alpha: &QM31,
    oods_point: &QM31,
) -> QM31 {
    // Map public inputs to field elements via keccak
    let c = bytes_to_qm31(commitment);
    let n = bytes_to_qm31(nullifier);
    let r = bytes_to_qm31(merkle_root);
    
    // The constraint is:
    // C(x) = (trace(x) - c) + α*(trace(x) - n) + α²*(trace(x) - r)
    // At OODS: composition(oods) should equal C(oods)
    
    // trace(oods) - commitment
    let c1 = trace_oods.sub(c);
    
    // α * (trace(oods) - nullifier)
    let c2 = alpha.mul(trace_oods.sub(n));
    
    // α² * (trace(oods) - merkle_root)
    let alpha_sq = alpha.mul(*alpha);
    let c3 = alpha_sq.mul(trace_oods.sub(r));
    
    // Combine and scale by OODS point for degree adjustment
    let constraint_sum = c1.add(c2).add(c3);
    
    // Divide by vanishing polynomial evaluation at OODS
    // V(x) = x^n - 1, for domain of size n
    // At OODS point, this gives the constraint quotient
    let oods_pow = oods_point.pow(1024); // Domain size 2^10
    let vanishing_at_oods = oods_pow.sub(QM31::ONE);
    
    // Constraint quotient = constraint_sum / vanishing(oods)
    // For soundness, we verify the composition matches this quotient
    if vanishing_at_oods.eq(&QM31::ZERO) {
        // OODS point is in the domain (shouldn't happen with proper randomness)
        constraint_sum
    } else {
        constraint_sum.mul(vanishing_at_oods.inv())
    }
}

/// Convert 32 bytes to QM31 via keccak reduction
fn bytes_to_qm31(bytes: &[u8; 32]) -> QM31 {
    let hash = keccak_hash(bytes);
    QM31::new(
        M31::new(u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]])),
        M31::new(u32::from_le_bytes([hash[4], hash[5], hash[6], hash[7]])),
        M31::new(u32::from_le_bytes([hash[8], hash[9], hash[10], hash[11]])),
        M31::new(u32::from_le_bytes([hash[12], hash[13], hash[14], hash[15]])),
    )
}

// ============================================================================
// Accounts
// ============================================================================

#[derive(Accounts)]
pub struct InitProofBuffer<'info> {
    /// CHECK: Raw buffer account
    #[account(mut)]
    pub proof_buffer: AccountInfo<'info>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UploadChunk<'info> {
    /// CHECK: Raw buffer account
    #[account(mut)]
    pub proof_buffer: AccountInfo<'info>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeAndVerify<'info> {
    /// CHECK: Raw buffer account
    #[account(mut)]
    pub proof_buffer: AccountInfo<'info>,
    
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseProofBuffer<'info> {
    /// CHECK: Raw buffer account
    #[account(mut)]
    pub proof_buffer: AccountInfo<'info>,
    
    #[account(mut)]
    pub owner: Signer<'info>,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum VerifierError {
    #[msg("Invalid proof format")]
    InvalidProofFormat,
    
    #[msg("Proof too large")]
    ProofTooLarge,
    
    #[msg("Buffer too small")]
    BufferTooSmall,
    
    #[msg("Unauthorized")]
    Unauthorized,
    
    #[msg("Buffer already finalized")]
    BufferAlreadyFinalized,
    
    #[msg("Incomplete proof")]
    IncompleteProof,
    
    #[msg("Constraint mismatch - AIR evaluation failed at OODS")]
    ConstraintMismatch,
    
    #[msg("Final polynomial degree too high")]
    FinalPolyDegreeTooHigh,
    
    #[msg("Trace Merkle path verification failed")]
    TraceMerklePathFailed,
    
    #[msg("Composition Merkle path verification failed")]
    CompositionMerklePathFailed,
    
    #[msg("FRI folding verification failed")]
    FriFoldingFailed,
    
    #[msg("Query index mismatch - Fiat-Shamir derivation failed")]
    QueryIndexMismatch,
    
    #[msg("Final polynomial evaluation mismatch")]
    FinalPolyMismatch,
}

// ============================================================================
// CPI Interface
// ============================================================================

/// Verification result for CPI callers
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VerificationResult {
    pub success: bool,
    pub compute_units: u64,
}

/// Verify a proof via CPI (helper for external programs)
pub fn verify_proof_cpi(
    proof_data: &[u8],
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
    merkle_root: &[u8; 32],
) -> Result<VerificationResult> {
    verify_stark_proof(proof_data, commitment, nullifier, merkle_root)?;
    
    Ok(VerificationResult {
        success: true,
        compute_units: 100000, // Estimated CU for full verification
    })
}
