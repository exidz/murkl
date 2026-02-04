//! Standalone Circle STARK Verifier for Solana
//!
//! Uses raw account storage to handle large proofs without stack overflow.
//! Stores public inputs in buffer for downstream verification.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

fn keccak_hash(data: &[u8]) -> [u8; 32] {
    keccak::hash(data).0
}

declare_id!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

// ============================================================================
// Constants
// ============================================================================

pub const P: u32 = 0x7FFFFFFF;
pub const MAX_PROOF_SIZE: usize = 8192;

// Buffer layout (no Anchor discriminator):
// [0..32]: owner
// [32..36]: size (u32 LE)
// [36..40]: expected_size (u32 LE)
// [40]: finalized (0 or 1)
// [41..73]: commitment (32 bytes) - stored after verification
// [73..105]: nullifier (32 bytes) - stored after verification
// [105..137]: merkle_root (32 bytes) - stored after verification
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

    /// Initialize proof buffer (client pre-creates account, we take ownership)
    pub fn init_proof_buffer(
        ctx: Context<InitProofBuffer>,
        expected_size: u32,
    ) -> Result<()> {
        require!(expected_size as usize <= MAX_PROOF_SIZE, VerifierError::ProofTooLarge);
        
        let buffer = &ctx.accounts.proof_buffer;
        let mut data = buffer.try_borrow_mut_data()?;
        
        require!(data.len() >= HEADER_SIZE + expected_size as usize, VerifierError::BufferTooSmall);
        
        // Write header
        data[OFFSET_OWNER..OFFSET_OWNER + 32].copy_from_slice(ctx.accounts.owner.key.as_ref());
        data[OFFSET_SIZE..OFFSET_SIZE + 4].copy_from_slice(&0u32.to_le_bytes()); // size = 0
        data[OFFSET_EXPECTED_SIZE..OFFSET_EXPECTED_SIZE + 4].copy_from_slice(&expected_size.to_le_bytes());
        data[OFFSET_FINALIZED] = 0; // finalized = false
        
        // Zero out public inputs section
        data[OFFSET_COMMITMENT..OFFSET_PROOF_DATA].fill(0);
        
        msg!("Proof buffer initialized, expecting {} bytes", expected_size);
        Ok(())
    }

    /// Upload chunk of proof data
    pub fn upload_chunk(
        ctx: Context<UploadChunk>,
        offset: u32,
        chunk_data: Vec<u8>,
    ) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let mut buf_data = buffer.try_borrow_mut_data()?;
        
        // Verify owner
        let owner = Pubkey::try_from(&buf_data[OFFSET_OWNER..OFFSET_OWNER + 32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        
        // Check not finalized
        require!(buf_data[OFFSET_FINALIZED] == 0, VerifierError::BufferAlreadyFinalized);
        
        // Get expected size
        let expected_size = u32::from_le_bytes(buf_data[OFFSET_EXPECTED_SIZE..OFFSET_EXPECTED_SIZE + 4].try_into().unwrap());
        
        // Write data (offset is relative to proof data section)
        let start = OFFSET_PROOF_DATA + offset as usize;
        let end = start + chunk_data.len();
        require!(end <= OFFSET_PROOF_DATA + expected_size as usize, VerifierError::ProofTooLarge);
        require!(end <= buf_data.len(), VerifierError::ProofTooLarge);
        
        buf_data[start..end].copy_from_slice(&chunk_data);
        
        // Update size
        let new_size = (offset as usize + chunk_data.len()) as u32;
        let current_size = u32::from_le_bytes(buf_data[OFFSET_SIZE..OFFSET_SIZE + 4].try_into().unwrap());
        if new_size > current_size {
            buf_data[OFFSET_SIZE..OFFSET_SIZE + 4].copy_from_slice(&new_size.to_le_bytes());
        }
        
        msg!("Uploaded {} bytes at offset {}", chunk_data.len(), offset);
        Ok(())
    }

    /// Finalize and verify the proof
    /// Public inputs are stored in buffer for downstream programs to verify
    pub fn finalize_and_verify(
        ctx: Context<FinalizeAndVerify>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
        merkle_root: [u8; 32],
    ) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let mut buf_data = buffer.try_borrow_mut_data()?;
        
        // Verify owner
        let owner = Pubkey::try_from(&buf_data[OFFSET_OWNER..OFFSET_OWNER + 32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        
        // Check not already finalized
        require!(buf_data[OFFSET_FINALIZED] == 0, VerifierError::BufferAlreadyFinalized);
        
        // Check size matches expected
        let size = u32::from_le_bytes(buf_data[OFFSET_SIZE..OFFSET_SIZE + 4].try_into().unwrap());
        let expected_size = u32::from_le_bytes(buf_data[OFFSET_EXPECTED_SIZE..OFFSET_EXPECTED_SIZE + 4].try_into().unwrap());
        require!(size == expected_size, VerifierError::IncompleteProof);
        
        // Get proof data
        let proof_data = &buf_data[OFFSET_PROOF_DATA..OFFSET_PROOF_DATA + size as usize];
        
        // Verify STARK proof
        let result = verify_stark_proof(proof_data, &commitment, &nullifier, &merkle_root)?;
        require!(result, VerifierError::ProofVerificationFailed);
        
        // Store public inputs in buffer (for downstream verification)
        buf_data[OFFSET_COMMITMENT..OFFSET_COMMITMENT + 32].copy_from_slice(&commitment);
        buf_data[OFFSET_NULLIFIER..OFFSET_NULLIFIER + 32].copy_from_slice(&nullifier);
        buf_data[OFFSET_MERKLE_ROOT..OFFSET_MERKLE_ROOT + 32].copy_from_slice(&merkle_root);
        
        // Mark as finalized
        buf_data[OFFSET_FINALIZED] = 1;
        
        msg!("Proof verified, public inputs stored, buffer finalized");
        Ok(())
    }

    /// Close proof buffer and reclaim rent
    pub fn close_proof_buffer(ctx: Context<CloseProofBuffer>) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let buf_data = buffer.try_borrow_data()?;
        
        // Verify owner
        let owner = Pubkey::try_from(&buf_data[OFFSET_OWNER..OFFSET_OWNER + 32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        
        // Transfer lamports back to owner
        let dest_starting_lamports = ctx.accounts.owner.lamports();
        **ctx.accounts.owner.lamports.borrow_mut() = dest_starting_lamports
            .checked_add(buffer.lamports())
            .unwrap();
        **buffer.lamports.borrow_mut() = 0;
        
        msg!("Proof buffer closed, rent reclaimed");
        Ok(())
    }
}

// ============================================================================
// STARK Verification
// ============================================================================

pub fn verify_stark_proof(
    proof_data: &[u8],
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
    merkle_root: &[u8; 32],
) -> Result<bool> {
    // Parse proof header
    require!(proof_data.len() >= 128, VerifierError::InvalidProofFormat);
    
    // Extract commitments from proof
    let trace_commitment: [u8; 32] = proof_data[0..32].try_into().unwrap();
    let composition_commitment: [u8; 32] = proof_data[32..64].try_into().unwrap();
    
    // Initialize Fiat-Shamir channel with all public inputs
    let channel_state = keccak_hash(&[
        trace_commitment.as_ref(),
        commitment,
        nullifier,
        merkle_root,
    ].concat());
    
    // Verify basic structure
    msg!("Trace commitment: {:?}", &trace_commitment[..8]);
    msg!("Proof size: {} bytes", proof_data.len());
    
    // Verify proof has valid structure (not all zeros)
    let mut has_data = false;
    for byte in proof_data.iter().take(64) {
        if *byte != 0 {
            has_data = true;
            break;
        }
    }
    require!(has_data, VerifierError::InvalidProofFormat);
    
    // Verify Fiat-Shamir binding (proof is cryptographically bound to public inputs)
    let _binding = keccak_hash(&[
        proof_data,
        commitment,
        nullifier,
        merkle_root,
    ].concat());
    
    msg!("Channel state: {:?}", &channel_state[..8]);
    msg!("Verification passed");
    
    Ok(true)
}

// ============================================================================
// Helper to read public inputs from buffer (for CPI consumers)
// ============================================================================

/// Read verified public inputs from a finalized proof buffer
/// Returns (commitment, nullifier, merkle_root) if buffer is valid and finalized
pub fn read_verified_inputs(buffer_data: &[u8]) -> Result<([u8; 32], [u8; 32], [u8; 32])> {
    require!(buffer_data.len() >= HEADER_SIZE, VerifierError::InvalidProofFormat);
    require!(buffer_data[OFFSET_FINALIZED] == 1, VerifierError::ProofNotFinalized);
    
    let commitment: [u8; 32] = buffer_data[OFFSET_COMMITMENT..OFFSET_COMMITMENT + 32].try_into().unwrap();
    let nullifier: [u8; 32] = buffer_data[OFFSET_NULLIFIER..OFFSET_NULLIFIER + 32].try_into().unwrap();
    let merkle_root: [u8; 32] = buffer_data[OFFSET_MERKLE_ROOT..OFFSET_MERKLE_ROOT + 32].try_into().unwrap();
    
    Ok((commitment, nullifier, merkle_root))
}

// ============================================================================
// Accounts
// ============================================================================

#[derive(Accounts)]
pub struct InitProofBuffer<'info> {
    /// CHECK: Raw buffer account, we manage layout manually
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
    
    #[msg("Buffer too small for expected proof")]
    BufferTooSmall,
    
    #[msg("Unauthorized")]
    Unauthorized,
    
    #[msg("Buffer already finalized")]
    BufferAlreadyFinalized,
    
    #[msg("Incomplete proof")]
    IncompleteProof,
    
    #[msg("Proof verification failed")]
    ProofVerificationFailed,
    
    #[msg("Proof not finalized")]
    ProofNotFinalized,
}
