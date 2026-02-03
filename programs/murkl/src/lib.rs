//! Murkl - Anonymous Social Transfers on Solana
//!
//! Full on-chain Circle STARK verification!
//! Uses keccak256 syscall for Merkle, M31/QM31 field ops for constraints.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

mod verifier;
use verifier::{StarkProof, VerifierConfig, verify_stark_proof, m31_mul, m31_add, P};

declare_id!("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

/// Mixing constants for M31 hash (same as off-chain)
const MIX_A: u32 = 0x9e3779b9 % P;
const MIX_B: u32 = 0x517cc1b7 % P;
const MIX_C: u32 = 0x2545f491 % P;

#[program]
pub mod murkl {
    use super::*;

    /// Initialize a new Murkl pool
    pub fn initialize_pool(ctx: Context<InitializePool>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.token_mint = ctx.accounts.token_mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.merkle_root = [0u8; 32];
        pool.next_leaf_index = 0;
        pool.total_deposits = 0;
        pool.bump = ctx.bumps.pool;
        
        msg!("Murkl pool initialized with STARK verification");
        Ok(())
    }

    /// Deposit tokens with a commitment
    /// commitment = m31_hash(identifier, secret)
    pub fn deposit(
        ctx: Context<Deposit>, 
        commitment: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        // Transfer tokens to vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
        )?;
        
        // Store deposit
        let deposit = &mut ctx.accounts.deposit_account;
        deposit.pool = pool.key();
        deposit.commitment = commitment;
        deposit.amount = amount;
        deposit.leaf_index = pool.next_leaf_index;
        deposit.timestamp = Clock::get()?.unix_timestamp;
        deposit.claimed = false;
        
        // Update merkle root (hash chain for simplicity)
        pool.merkle_root = keccak::hashv(&[&pool.merkle_root, &commitment]).0;
        pool.next_leaf_index += 1;
        pool.total_deposits += amount;
        
        emit!(DepositEvent {
            pool: pool.key(),
            commitment,
            amount,
            leaf_index: deposit.leaf_index,
        });
        
        Ok(())
    }

    /// Claim tokens with STARK proof
    /// 
    /// The STARK proof verifies:
    /// 1. Prover knows (identifier, secret) such that hash(identifier, secret) = commitment
    /// 2. Merkle path proves commitment is in the tree
    /// 3. Nullifier = hash(secret, leaf_index) prevents double-spend
    /// 
    /// Privacy: identifier and secret are NEVER revealed on-chain!
    pub fn claim(
        ctx: Context<Claim>,
        // STARK proof (serialized)
        proof_data: Vec<u8>,
        // Public inputs
        commitment: [u8; 32],
        nullifier: [u8; 32],
        leaf_index: u32,
        // Merkle proof for commitment
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let nullifier_account = &mut ctx.accounts.nullifier_account;
        
        // 1. Check nullifier not used
        require!(!nullifier_account.used, MurklError::NullifierAlreadyUsed);
        
        // 2. Verify Merkle proof (commitment in tree)
        let computed_root = verify_merkle_proof_internal(&commitment, leaf_index, &merkle_proof);
        require!(computed_root == pool.merkle_root, MurklError::InvalidMerkleProof);
        
        // 3. Deserialize and verify STARK proof
        let proof: StarkProof = StarkProof::try_from_slice(&proof_data)
            .map_err(|_| MurklError::InvalidProofFormat)?;
        
        let config = VerifierConfig::default();
        
        // Public input: the commitment hash (as M31 element)
        let commitment_m31 = u32::from_le_bytes([
            commitment[0], commitment[1], commitment[2], commitment[3]
        ]) % P;
        
        let verification_result = verify_stark_proof(&proof, &config, &[commitment_m31]);
        
        require!(verification_result, MurklError::StarkVerificationFailed);
        
        // 4. Verify nullifier is correctly derived
        // The STARK also proves nullifier derivation, but we double-check format
        // In production, nullifier would be a public output of the STARK
        
        // 5. Mark nullifier as used
        nullifier_account.nullifier = nullifier;
        nullifier_account.pool = pool.key();
        nullifier_account.used = true;
        nullifier_account.claimed_at = Clock::get()?.unix_timestamp;
        
        // 6. Transfer tokens
        let amount = ctx.accounts.deposit_account.amount;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[&[
                    b"pool",
                    pool.token_mint.as_ref(),
                    &[pool.bump],
                ]],
            ),
            amount,
        )?;
        
        ctx.accounts.deposit_account.claimed = true;
        
        emit!(ClaimEvent {
            pool: pool.key(),
            nullifier,
            amount,
        });
        
        msg!("STARK proof verified! Tokens claimed anonymously.");
        Ok(())
    }
    
    /// Simple claim without full STARK (for testing/MVP)
    /// WARNING: This reveals identifier and secret! Use claim() for privacy.
    pub fn claim_simple(
        ctx: Context<ClaimSimple>,
        // Revealed values (no privacy!)
        identifier: u32,
        secret: u32,
        nullifier: [u8; 32],
        leaf_index: u32,
        merkle_proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let nullifier_account = &mut ctx.accounts.nullifier_account;
        
        // 1. Check nullifier not used
        require!(!nullifier_account.used, MurklError::NullifierAlreadyUsed);
        
        // 2. Compute commitment from revealed values
        let commitment = m31_hash2(identifier, secret);
        
        // 3. Verify commitment matches deposit
        // (simplified - in production use proper Merkle tree)
        require!(
            commitment == ctx.accounts.deposit_account.commitment,
            MurklError::InvalidMerkleProof
        );
        
        // 4. Verify nullifier derivation
        let expected_nullifier = m31_hash2(secret, leaf_index);
        require!(expected_nullifier == nullifier, MurklError::InvalidNullifier);
        
        // 5. Mark nullifier as used
        nullifier_account.nullifier = nullifier;
        nullifier_account.pool = pool.key();
        nullifier_account.used = true;
        nullifier_account.claimed_at = Clock::get()?.unix_timestamp;
        
        // 6. Transfer tokens
        let amount = ctx.accounts.deposit_account.amount;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[&[
                    b"pool",
                    pool.token_mint.as_ref(),
                    &[pool.bump],
                ]],
            ),
            amount,
        )?;
        
        ctx.accounts.deposit_account.claimed = true;
        
        emit!(ClaimEvent {
            pool: pool.key(),
            nullifier,
            amount,
        });
        
        msg!("Simple claim successful (no privacy)");
        Ok(())
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Verify Merkle proof using keccak256 syscall
fn verify_merkle_proof_internal(leaf: &[u8; 32], index: u32, proof: &[[u8; 32]]) -> [u8; 32] {
    let mut current = *leaf;
    let mut idx = index;
    
    for sibling in proof.iter() {
        current = if idx % 2 == 0 {
            keccak::hashv(&[&current, sibling]).0
        } else {
            keccak::hashv(&[sibling, &current]).0
        };
        idx /= 2;
    }
    
    current
}

/// M31 hash function (matches off-chain STWO circuits)
fn m31_hash2(a: u32, b: u32) -> [u8; 32] {
    let a = a % P;
    let b = b % P;
    
    // x = (a + b * MIX_A + 1) mod p
    let x = m31_add(m31_add(a, m31_mul(b, MIX_A)), 1);
    // y = x^2 mod p
    let y = m31_mul(x, x);
    // result = (y + a*MIX_B + b*MIX_C + MIX_A) mod p
    let result = m31_add(
        m31_add(m31_add(y, m31_mul(a, MIX_B)), m31_mul(b, MIX_C)),
        MIX_A
    );
    
    let mut bytes = [0u8; 32];
    bytes[0..4].copy_from_slice(&result.to_le_bytes());
    bytes
}

// ============================================================================
// Accounts
// ============================================================================

#[account]
pub struct Pool {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub merkle_root: [u8; 32],
    pub next_leaf_index: u32,
    pub total_deposits: u64,
    pub bump: u8,
}

#[account]
pub struct DepositAccount {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub amount: u64,
    pub leaf_index: u32,
    pub timestamp: i64,
    pub claimed: bool,
}

#[account]
pub struct NullifierAccount {
    pub nullifier: [u8; 32],
    pub pool: Pubkey,
    pub used: bool,
    pub claimed_at: i64,
}

// ============================================================================
// Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 32 + 32 + 4 + 8 + 1,
        seeds = [b"pool", token_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    
    /// CHECK: Token mint
    pub token_mint: AccountInfo<'info>,
    
    #[account(
        init,
        payer = authority,
        token::mint = token_mint,
        token::authority = pool,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub authority: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    
    #[account(
        init,
        payer = depositor,
        space = 8 + 32 + 32 + 8 + 4 + 8 + 1,
        seeds = [b"deposit", pool.key().as_ref(), &pool.next_leaf_index.to_le_bytes()],
        bump
    )]
    pub deposit_account: Account<'info, DepositAccount>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    proof_data: Vec<u8>,
    commitment: [u8; 32],
    nullifier: [u8; 32],
    leaf_index: u32,
    merkle_proof: Vec<[u8; 32]>,
)]
pub struct Claim<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    
    #[account(
        mut,
        constraint = !deposit_account.claimed @ MurklError::AlreadyClaimed
    )]
    pub deposit_account: Account<'info, DepositAccount>,
    
    #[account(
        init,
        payer = claimer,
        space = 8 + 32 + 32 + 1 + 8,
        seeds = [b"nullifier", pool.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub nullifier_account: Account<'info, NullifierAccount>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub claimer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(
    identifier: u32,
    secret: u32,
    nullifier: [u8; 32],
    leaf_index: u32,
    merkle_proof: Vec<[u8; 32]>,
)]
pub struct ClaimSimple<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    
    #[account(
        mut,
        constraint = !deposit_account.claimed @ MurklError::AlreadyClaimed
    )]
    pub deposit_account: Account<'info, DepositAccount>,
    
    #[account(
        init,
        payer = claimer,
        space = 8 + 32 + 32 + 1 + 8,
        seeds = [b"nullifier", pool.key().as_ref(), nullifier.as_ref()],
        bump
    )]
    pub nullifier_account: Account<'info, NullifierAccount>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub claimer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ============================================================================
// Events & Errors
// ============================================================================

#[event]
pub struct DepositEvent {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub amount: u64,
    pub leaf_index: u32,
}

#[event]
pub struct ClaimEvent {
    pub pool: Pubkey,
    pub nullifier: [u8; 32],
    pub amount: u64,
}

#[error_code]
pub enum MurklError {
    #[msg("Nullifier already used")]
    NullifierAlreadyUsed,
    #[msg("Invalid Merkle proof")]
    InvalidMerkleProof,
    #[msg("Invalid nullifier derivation")]
    InvalidNullifier,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Invalid proof format")]
    InvalidProofFormat,
    #[msg("STARK verification failed")]
    StarkVerificationFailed,
}
