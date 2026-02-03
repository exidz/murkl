//! Example Integration - Demonstrates Murkl Verifier CPI
//!
//! This example shows how external programs can integrate with Murkl's
//! Circle STARK verifier for anonymous proof verification.
//!
//! # Use Cases
//!
//! - **Privacy-preserving airdrops**: Verify user eligibility without revealing identity
//! - **Anonymous voting**: Prove membership in a voter set without deanonymization
//! - **Private NFT minting**: Gate minting on proof of some secret condition
//! - **Compliance proofs**: Prove KYC status without sharing personal data
//!
//! # How It Works
//!
//! 1. User generates a commitment off-chain (WASM or CLI)
//! 2. User generates a STARK proof proving knowledge of preimage
//! 3. User submits proof to this program
//! 4. Program CPI into stark-verifier to verify the proof
//! 5. If valid, program takes some action (mint, unlock, etc.)

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, MintTo};

declare_id!("ExmpLe1111111111111111111111111111111111111");

/// STARK Verifier program ID
pub const STARK_VERIFIER_ID: Pubkey = pubkey!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

// ============================================================================
// Program
// ============================================================================

#[program]
pub mod example_integration {
    use super::*;

    /// Initialize the example integration
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.total_verified = 0;
        config.bump = ctx.bumps.config;
        
        msg!("Example integration initialized");
        Ok(())
    }

    /// Verify a proof using stark-verifier's proof buffer
    /// 
    /// This demonstrates the CPI pattern:
    /// 1. User uploads proof to stark-verifier's buffer
    /// 2. User calls stark-verifier::finalize_and_verify (proof is verified)
    /// 3. User calls this instruction with the verified buffer
    /// 4. We check the buffer is finalized (proof was valid)
    /// 5. We record the verification and take action
    ///
    /// The stark-verifier sets finalized=true only after successful verification,
    /// so checking that flag is sufficient.
    pub fn verify_and_record(
        ctx: Context<VerifyAndRecord>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
    ) -> Result<()> {
        msg!("Checking stark-verifier proof buffer...");
        
        // Verify the proof buffer from stark-verifier is finalized
        let verifier_buffer = &ctx.accounts.verifier_buffer;
        
        // Parse verifier buffer data (skip 8-byte discriminator)
        let data = verifier_buffer.try_borrow_data()?;
        require!(data.len() >= 73, ExampleError::InvalidVerifierBuffer);
        
        // ProofBuffer layout: owner(32) + size(4) + expected_size(4) + finalized(1) + data...
        let finalized = data[8 + 32 + 4 + 4] == 1;
        require!(finalized, ExampleError::ProofNotVerified);
        
        msg!("✅ Proof buffer verified!");
        
        // Record successful verification
        let record = &mut ctx.accounts.verification_record;
        record.verifier = ctx.accounts.verifier.key();
        record.commitment = commitment;
        record.nullifier = nullifier;
        record.verified_at = Clock::get()?.unix_timestamp;
        
        // Update stats
        let config = &mut ctx.accounts.config;
        config.total_verified = config.total_verified.saturating_add(1);
        
        msg!("Verification recorded! Total: {}", config.total_verified);
        
        emit!(VerificationEvent {
            verifier: ctx.accounts.verifier.key(),
            commitment,
            nullifier,
            timestamp: record.verified_at,
        });
        
        Ok(())
    }

    /// Alternative: Direct CPI into stark-verifier::verify_proof
    ///
    /// This shows how to call the verifier instruction directly via CPI
    /// instead of using the proof buffer flow.
    ///
    /// Note: For large proofs, use the buffer flow above. Direct CPI
    /// is limited by transaction size (~1KB for proof data).
    pub fn verify_direct_cpi(
        ctx: Context<VerifyDirectCpi>,
        proof_data: Vec<u8>,
        public_inputs: Vec<u8>,
    ) -> Result<()> {
        msg!("Calling stark-verifier via CPI ({} bytes proof)...", proof_data.len());
        
        // Build the CPI instruction
        let ix = anchor_lang::solana_program::instruction::Instruction {
            program_id: STARK_VERIFIER_ID,
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(
                    ctx.accounts.payer.key(),
                    true,
                ),
            ],
            // Discriminator for verify_proof + serialized args
            data: build_verify_proof_data(&proof_data, &public_inputs),
        };
        
        // Execute CPI
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[ctx.accounts.payer.to_account_info()],
        )?;
        
        msg!("✅ Direct CPI verification succeeded!");
        
        emit!(DirectVerificationEvent {
            verifier: ctx.accounts.payer.key(),
            proof_size: proof_data.len() as u32,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }

    /// Verify proof and mint an NFT as reward
    /// 
    /// This demonstrates a practical use case: gating NFT minting
    /// on proof of some secret knowledge.
    pub fn verify_and_mint(
        ctx: Context<VerifyAndMint>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
    ) -> Result<()> {
        msg!("Verifying proof for NFT mint...");
        
        // Check nullifier not already used (prevent double-mint)
        let nullifier_record = &ctx.accounts.nullifier_record;
        require!(!nullifier_record.used, ExampleError::NullifierUsed);
        
        // Verify the proof buffer is finalized
        let verifier_buffer = &ctx.accounts.verifier_buffer;
        let data = verifier_buffer.try_borrow_data()?;
        require!(data.len() >= 73, ExampleError::InvalidVerifierBuffer);
        let finalized = data[8 + 32 + 4 + 4] == 1;
        require!(finalized, ExampleError::ProofNotVerified);
        
        // Mark nullifier as used
        let nullifier_record = &mut ctx.accounts.nullifier_record;
        nullifier_record.nullifier = nullifier;
        nullifier_record.used = true;
        nullifier_record.used_at = Clock::get()?.unix_timestamp;
        
        // Mint NFT to recipient
        let seeds = &[b"config".as_ref(), &[ctx.accounts.config.bump]];
        
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.nft_mint.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                &[seeds],
            ),
            1, // Mint 1 NFT
        )?;
        
        msg!("✅ Proof verified, NFT minted!");
        
        emit!(MintEvent {
            recipient: ctx.accounts.recipient.key(),
            commitment,
            nullifier,
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        Ok(())
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Build the verify_proof instruction data
fn build_verify_proof_data(proof_data: &[u8], public_inputs: &[u8]) -> Vec<u8> {
    // Anchor discriminator for "verify_proof" = first 8 bytes of sha256("global:verify_proof")
    let discriminator: [u8; 8] = [0x40, 0x9d, 0x08, 0x6c, 0x7a, 0x98, 0x9b, 0x8a];
    
    let mut data = Vec::with_capacity(8 + 4 + proof_data.len() + 4 + public_inputs.len());
    data.extend_from_slice(&discriminator);
    
    // Vec<u8> is serialized as u32 length + bytes
    data.extend_from_slice(&(proof_data.len() as u32).to_le_bytes());
    data.extend_from_slice(proof_data);
    
    data.extend_from_slice(&(public_inputs.len() as u32).to_le_bytes());
    data.extend_from_slice(public_inputs);
    
    data
}

// ============================================================================
// Accounts
// ============================================================================

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub total_verified: u64,
    pub bump: u8,
}

impl Config {
    pub const SIZE: usize = 8 + 32 + 8 + 1;
}

#[account]
pub struct VerificationRecord {
    pub verifier: Pubkey,
    pub commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub verified_at: i64,
}

impl VerificationRecord {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8;
}

#[account]
pub struct NullifierRecord {
    pub nullifier: [u8; 32],
    pub used: bool,
    pub used_at: i64,
}

impl NullifierRecord {
    pub const SIZE: usize = 8 + 32 + 1 + 8;
}

// ============================================================================
// Contexts
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = Config::SIZE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32], nullifier: [u8; 32])]
pub struct VerifyAndRecord<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    
    /// CHECK: stark-verifier's proof buffer (verified via finalized flag)
    #[account(
        constraint = verifier_buffer.owner == &STARK_VERIFIER_ID @ ExampleError::InvalidVerifierBuffer
    )]
    pub verifier_buffer: UncheckedAccount<'info>,
    
    #[account(
        init,
        payer = verifier,
        space = VerificationRecord::SIZE,
        seeds = [b"record", nullifier.as_ref()],
        bump
    )]
    pub verification_record: Account<'info, VerificationRecord>,
    
    #[account(mut)]
    pub verifier: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VerifyDirectCpi<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// CHECK: stark-verifier program
    #[account(address = STARK_VERIFIER_ID)]
    pub verifier_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(commitment: [u8; 32], nullifier: [u8; 32])]
pub struct VerifyAndMint<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    
    /// CHECK: stark-verifier's proof buffer (verified via finalized flag)
    #[account(
        constraint = verifier_buffer.owner == &STARK_VERIFIER_ID @ ExampleError::InvalidVerifierBuffer
    )]
    pub verifier_buffer: UncheckedAccount<'info>,
    
    #[account(
        init,
        payer = payer,
        space = NullifierRecord::SIZE,
        seeds = [b"nullifier", nullifier.as_ref()],
        bump
    )]
    pub nullifier_record: Account<'info, NullifierRecord>,
    
    #[account(
        mut,
        constraint = nft_mint.mint_authority.unwrap() == config.key()
    )]
    pub nft_mint: Account<'info, Mint>,
    
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    
    /// CHECK: Recipient can be any account
    pub recipient: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct VerificationEvent {
    pub verifier: Pubkey,
    pub commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct DirectVerificationEvent {
    pub verifier: Pubkey,
    pub proof_size: u32,
    pub timestamp: i64,
}

#[event]
pub struct MintEvent {
    pub recipient: Pubkey,
    pub commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub timestamp: i64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum ExampleError {
    #[msg("Proof verification failed")]
    ProofInvalid,
    #[msg("Invalid proof format")]
    InvalidProofFormat,
    #[msg("Nullifier already used")]
    NullifierUsed,
    #[msg("Proof not verified")]
    ProofNotVerified,
    #[msg("Invalid verifier buffer")]
    InvalidVerifierBuffer,
}
