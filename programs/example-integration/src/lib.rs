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
//! 4. Program verifies proof using Murkl's CPI interface
//! 5. If valid, program takes some action (mint, unlock, etc.)

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Mint, MintTo};
use murkl_program::verifier::{
    verify_proof_cpi, bytes_to_m31, compute_commitment,
    StarkProof, VerifierConfig, verify_stark_proof,
};

declare_id!("ExmpLe1111111111111111111111111111111111111");

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

    /// Verify a proof and record the verification
    /// 
    /// This demonstrates the simplest CPI pattern: deserialize proof,
    /// call verify_proof_cpi, and record result.
    pub fn verify_and_record(
        ctx: Context<VerifyAndRecord>,
        proof_data: Vec<u8>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
    ) -> Result<()> {
        msg!("Verifying proof ({} bytes)...", proof_data.len());
        
        // Call Murkl verifier via the library (not CPI instruction)
        let result = verify_proof_cpi(&proof_data, &commitment, &nullifier)?;
        
        require!(result.valid, ExampleError::ProofInvalid);
        
        // Record successful verification
        let record = &mut ctx.accounts.verification_record;
        record.verifier = ctx.accounts.verifier.key();
        record.commitment = commitment;
        record.nullifier = nullifier;
        record.verified_at = Clock::get()?.unix_timestamp;
        record.fri_layers = result.fri_layers;
        record.oods_values = result.oods_values;
        
        // Update stats
        let config = &mut ctx.accounts.config;
        config.total_verified = config.total_verified.saturating_add(1);
        
        msg!("✅ Proof verified! ({} FRI layers, {} OODS values)", 
            result.fri_layers, result.oods_values);
        
        emit!(VerificationEvent {
            verifier: ctx.accounts.verifier.key(),
            commitment,
            nullifier,
            timestamp: record.verified_at,
        });
        
        Ok(())
    }

    /// Verify a proof using raw field operations
    /// 
    /// This demonstrates using Murkl's lower-level APIs for
    /// more control over the verification process.
    pub fn verify_with_raw_ops(
        ctx: Context<VerifyRaw>,
        proof_data: Vec<u8>,
        id_hash: u32,
        secret: u32,
        leaf_index: u32,
    ) -> Result<()> {
        msg!("Verifying with raw ops...");
        
        // Compute expected commitment and nullifier using Murkl's functions
        let expected_commitment = compute_commitment(id_hash, secret);
        let expected_nullifier = murkl_program::verifier::compute_nullifier(secret, leaf_index);
        
        // Deserialize and verify proof
        let proof: StarkProof = StarkProof::try_from_slice(&proof_data)
            .map_err(|_| ExampleError::InvalidProofFormat)?;
        
        let config = VerifierConfig::default();
        let commitment_m31 = bytes_to_m31(&expected_commitment);
        let nullifier_m31 = bytes_to_m31(&expected_nullifier);
        
        let valid = verify_stark_proof(&proof, &config, &[commitment_m31, nullifier_m31]);
        require!(valid, ExampleError::ProofInvalid);
        
        // Store verification
        let record = &mut ctx.accounts.verification_record;
        record.verifier = ctx.accounts.verifier.key();
        record.commitment = expected_commitment;
        record.nullifier = expected_nullifier;
        record.verified_at = Clock::get()?.unix_timestamp;
        record.fri_layers = proof.fri_layers.len() as u8;
        record.oods_values = proof.oods_values.len() as u8;
        
        msg!("✅ Raw verification passed!");
        
        Ok(())
    }

    /// Verify proof and mint an NFT as reward
    /// 
    /// This demonstrates a practical use case: gating NFT minting
    /// on proof of some secret knowledge.
    pub fn verify_and_mint(
        ctx: Context<VerifyAndMint>,
        proof_data: Vec<u8>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
    ) -> Result<()> {
        msg!("Verifying proof for NFT mint...");
        
        // Verify the proof
        let result = verify_proof_cpi(&proof_data, &commitment, &nullifier)?;
        require!(result.valid, ExampleError::ProofInvalid);
        
        // Check nullifier not already used (prevent double-mint)
        // In production, you'd use a nullifier PDA like Murkl does
        
        // Mint NFT to recipient
        let config_key = ctx.accounts.config.key();
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
    pub fri_layers: u8,
    pub oods_values: u8,
}

impl VerificationRecord {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 8 + 1 + 1;
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
#[instruction(proof_data: Vec<u8>, commitment: [u8; 32], nullifier: [u8; 32])]
pub struct VerifyAndRecord<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    
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
#[instruction(proof_data: Vec<u8>, id_hash: u32, secret: u32, leaf_index: u32)]
pub struct VerifyRaw<'info> {
    #[account(mut)]
    pub config: Account<'info, Config>,
    
    #[account(
        init,
        payer = verifier,
        space = VerificationRecord::SIZE,
        // Use id_hash + leaf_index as seed (nullifier derived from these)
        seeds = [b"raw_record", id_hash.to_le_bytes().as_ref(), leaf_index.to_le_bytes().as_ref()],
        bump
    )]
    pub verification_record: Account<'info, VerificationRecord>,
    
    #[account(mut)]
    pub verifier: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(proof_data: Vec<u8>, commitment: [u8; 32], nullifier: [u8; 32])]
pub struct VerifyAndMint<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, Config>,
    
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
}
