//! Murkl - Anonymous Social Transfers on Solana
//!
//! Full on-chain Circle STARK verification with relayer support!
//! Uses keccak256 syscall for Merkle, M31/QM31 field ops for constraints.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

mod verifier;
use verifier::{StarkProof, VerifierConfig, verify_stark_proof, m31_mul, m31_add, P};

declare_id!("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

// PQ-SECURE: All hashes use keccak256 (quantum-resistant)
// Domain separators for hash functions
const COMMITMENT_DOMAIN: &[u8] = b"murkl_commitment_v1";
const NULLIFIER_DOMAIN: &[u8] = b"murkl_nullifier_v1";

/// Maximum relayer fee (1% = 100 basis points)
const MAX_RELAYER_FEE_BPS: u16 = 100;

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

    /// Claim tokens with STARK proof via relayer
    /// 
    /// PRIVACY FLOW:
    /// 1. Recipient generates STARK proof off-chain (proves knowledge of secret)
    /// 2. Recipient sends proof to relayer (off-chain, e.g., API call)
    /// 3. Relayer submits this tx and pays gas fees
    /// 4. Tokens go directly to recipient - they never sign anything!
    /// 
    /// The STARK proof verifies:
    /// - Prover knows (identifier, secret) such that hash(identifier, secret) = commitment
    /// - Merkle path proves commitment is in the tree
    /// - Nullifier = hash(secret, leaf_index) prevents double-spend
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
        // Relayer fee in basis points (0-100, max 1%)
        relayer_fee_bps: u16,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let nullifier_account = &mut ctx.accounts.nullifier_account;
        
        // 1. Check nullifier not used
        require!(!nullifier_account.used, MurklError::NullifierAlreadyUsed);
        
        // 2. Validate relayer fee
        require!(relayer_fee_bps <= MAX_RELAYER_FEE_BPS, MurklError::RelayerFeeTooHigh);
        
        // 3. Verify Merkle proof (commitment in tree)
        let computed_root = verify_merkle_proof_internal(&commitment, leaf_index, &merkle_proof);
        require!(computed_root == pool.merkle_root, MurklError::InvalidMerkleProof);
        
        // 4. Deserialize and verify STARK proof
        let proof: StarkProof = StarkProof::try_from_slice(&proof_data)
            .map_err(|_| MurklError::InvalidProofFormat)?;
        
        let config = VerifierConfig::default();
        
        // Public inputs: commitment hash + nullifier (as M31 elements)
        let commitment_m31 = u32::from_le_bytes([
            commitment[0], commitment[1], commitment[2], commitment[3]
        ]) % P;
        let nullifier_m31 = u32::from_le_bytes([
            nullifier[0], nullifier[1], nullifier[2], nullifier[3]
        ]) % P;
        
        let verification_result = verify_stark_proof(
            &proof, 
            &config, 
            &[commitment_m31, nullifier_m31]
        );
        
        require!(verification_result, MurklError::StarkVerificationFailed);
        
        // 5. Mark nullifier as used
        nullifier_account.nullifier = nullifier;
        nullifier_account.pool = pool.key();
        nullifier_account.used = true;
        nullifier_account.claimed_at = Clock::get()?.unix_timestamp;
        
        // 6. Calculate amounts
        let total_amount = ctx.accounts.deposit_account.amount;
        let relayer_fee = if relayer_fee_bps > 0 {
            (total_amount as u128 * relayer_fee_bps as u128 / 10000) as u64
        } else {
            0
        };
        let recipient_amount = total_amount - relayer_fee;
        
        // 7. Transfer tokens to recipient
        let signer_seeds = &[
            b"pool",
            pool.token_mint.as_ref(),
            &[pool.bump],
        ];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[signer_seeds],
            ),
            recipient_amount,
        )?;
        
        // 8. Transfer fee to relayer (if any)
        if relayer_fee > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.relayer_token_account.to_account_info(),
                        authority: pool.to_account_info(),
                    },
                    &[signer_seeds],
                ),
                relayer_fee,
            )?;
        }
        
        ctx.accounts.deposit_account.claimed = true;
        
        emit!(ClaimEvent {
            pool: pool.key(),
            nullifier,
            recipient: ctx.accounts.recipient_token_account.key(),
            amount: recipient_amount,
            relayer: ctx.accounts.relayer.key(),
            relayer_fee,
        });
        
        msg!("STARK verified! {} tokens to recipient, {} fee to relayer", 
            recipient_amount, relayer_fee);
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

/// PQ-secure commitment hash using keccak256 syscall
/// commitment = keccak256("murkl_commitment_v1" || identifier_bytes || secret)
#[allow(dead_code)]
fn pq_commitment_hash(identifier_hash: u32, secret: u32) -> [u8; 32] {
    keccak::hashv(&[
        b"murkl_m31_hash_v1",
        &identifier_hash.to_le_bytes(),
        &secret.to_le_bytes(),
    ]).0
}

/// PQ-secure nullifier hash using keccak256 syscall
/// nullifier = keccak256("murkl_nullifier_v1" || secret || leaf_index)
#[allow(dead_code)]
fn pq_nullifier_hash(secret: u32, leaf_index: u32) -> [u8; 32] {
    keccak::hashv(&[
        NULLIFIER_DOMAIN,
        &secret.to_le_bytes(),
        &leaf_index.to_le_bytes(),
    ]).0
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
    relayer_fee_bps: u16,
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
        payer = relayer,
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
    
    /// Recipient's token account - they don't need to sign!
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    
    /// Relayer's token account for fee (can be same as recipient if self-relay)
    #[account(mut)]
    pub relayer_token_account: Account<'info, TokenAccount>,
    
    /// Relayer signs and pays tx fees - recipient stays anonymous
    #[account(mut)]
    pub relayer: Signer<'info>,
    
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
    pub recipient: Pubkey,
    pub amount: u64,
    pub relayer: Pubkey,
    pub relayer_fee: u64,
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
    #[msg("Relayer fee too high (max 1%)")]
    RelayerFeeTooHigh,
}
