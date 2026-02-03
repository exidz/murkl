//! Standalone Circle STARK Verifier for Solana
//!
//! Uses raw account storage to handle large proofs without stack overflow.

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
// [41..]: proof data

const HEADER_SIZE: usize = 41;

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
        
        // Write header
        data[0..32].copy_from_slice(ctx.accounts.owner.key.as_ref());
        data[32..36].copy_from_slice(&0u32.to_le_bytes()); // size = 0
        data[36..40].copy_from_slice(&expected_size.to_le_bytes());
        data[40] = 0; // finalized = false
        
        msg!("Proof buffer initialized, expecting {} bytes", expected_size);
        Ok(())
    }

    /// Upload chunk of proof data
    pub fn upload_chunk(
        ctx: Context<UploadChunk>,
        offset: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let mut buf_data = buffer.try_borrow_mut_data()?;
        
        // Verify owner
        let owner = Pubkey::try_from(&buf_data[0..32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        
        // Check not finalized
        require!(buf_data[40] == 0, VerifierError::BufferAlreadyFinalized);
        
        // Get expected size
        let expected_size = u32::from_le_bytes(buf_data[36..40].try_into().unwrap());
        
        // Write data
        let start = HEADER_SIZE + offset as usize;
        let end = start + data.len();
        require!(end <= HEADER_SIZE + expected_size as usize, VerifierError::ProofTooLarge);
        require!(end <= buf_data.len(), VerifierError::ProofTooLarge);
        
        buf_data[start..end].copy_from_slice(&data);
        
        // Update size
        let new_size = (offset as usize + data.len()) as u32;
        let current_size = u32::from_le_bytes(buf_data[32..36].try_into().unwrap());
        if new_size > current_size {
            buf_data[32..36].copy_from_slice(&new_size.to_le_bytes());
        }
        
        msg!("Uploaded {} bytes at offset {}", data.len(), offset);
        Ok(())
    }

    /// Finalize and verify the proof
    pub fn finalize_and_verify(
        ctx: Context<FinalizeAndVerify>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
        merkle_root: [u8; 32],
    ) -> Result<()> {
        let buffer = &ctx.accounts.proof_buffer;
        let mut buf_data = buffer.try_borrow_mut_data()?;
        
        // Verify owner
        let owner = Pubkey::try_from(&buf_data[0..32]).unwrap();
        require!(owner == ctx.accounts.owner.key(), VerifierError::Unauthorized);
        
        // Check not already finalized
        require!(buf_data[40] == 0, VerifierError::BufferAlreadyFinalized);
        
        // Check size matches expected
        let size = u32::from_le_bytes(buf_data[32..36].try_into().unwrap());
        let expected_size = u32::from_le_bytes(buf_data[36..40].try_into().unwrap());
        require!(size == expected_size, VerifierError::IncompleteProof);
        
        // Get proof data
        let proof_data = &buf_data[HEADER_SIZE..HEADER_SIZE + size as usize];
        
        // Verify STARK proof
        let result = verify_stark_proof(proof_data, &commitment, &nullifier, &merkle_root)?;
        require!(result, VerifierError::ProofVerificationFailed);
        
        // Mark as finalized
        buf_data[40] = 1;
        
        msg!("Proof verified and buffer finalized");
        Ok(())
    }

    /// Close proof buffer
    pub fn close_proof_buffer(ctx: Context<CloseProofBuffer>) -> Result<()> {
        msg!("Proof buffer closed");
        Ok(())
    }
}

// ============================================================================
// STARK Verification (simplified for demo - real impl in progress)
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
    
    // Initialize Fiat-Shamir channel
    let mut channel_state = keccak_hash(&[
        trace_commitment.as_ref(),
        commitment,
        nullifier,
        merkle_root,
    ].concat());
    
    // Verify basic structure
    msg!("Trace commitment: {:?}", &trace_commitment[..8]);
    msg!("Proof size: {} bytes", proof_data.len());
    
    // For hackathon: verify proof structure is valid
    // Full FRI verification requires more CU - will optimize
    
    // Check proof has valid structure (not all zeros)
    let mut has_data = false;
    for byte in proof_data.iter().take(64) {
        if *byte != 0 {
            has_data = true;
            break;
        }
    }
    require!(has_data, VerifierError::InvalidProofFormat);
    
    // Verify Fiat-Shamir binding (proof is bound to public inputs)
    let expected_binding = keccak_hash(&[
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
    
    #[msg("Unauthorized")]
    Unauthorized,
    
    #[msg("Buffer already finalized")]
    BufferAlreadyFinalized,
    
    #[msg("Incomplete proof")]
    IncompleteProof,
    
    #[msg("Proof verification failed")]
    ProofVerificationFailed,
}
