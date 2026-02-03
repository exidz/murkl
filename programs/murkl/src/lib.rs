//! Murkl - Anonymous Social Transfers on Solana
//!
//! This program handles deposits and claims for private transfers.
//! Proof verification is done via CPI to the standalone stark-verifier program.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

/// STARK Verifier program ID  
pub const STARK_VERIFIER_ID: Pubkey = pubkey!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

/// Global config seed
pub const CONFIG_SEED: &[u8] = b"config";

// ============================================================================
// Constants
// ============================================================================

/// Maximum relayer fee (1% = 100 basis points)
const MAX_RELAYER_FEE_BPS: u16 = 100;

/// Minimum deposit (1 token unit)
const MIN_DEPOSIT_AMOUNT: u64 = 1;

// ============================================================================
// Program
// ============================================================================

#[program]
pub mod murkl {
    use super::*;

    /// Initialize global config (only callable once by deployer)
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.bump = ctx.bumps.config;
        
        msg!("Global config initialized, admin: {}", config.admin);
        Ok(())
    }

    /// Initialize a new token pool (admin only)
    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        config: PoolConfig,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.admin = ctx.accounts.admin.key();
        pool.token_mint = ctx.accounts.token_mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.merkle_root = [0u8; 32];
        pool.leaf_count = 0;
        pool.config = config;
        pool.paused = false;
        pool.bump = ctx.bumps.pool;
        
        msg!("Pool initialized for mint: {}", pool.token_mint);
        Ok(())
    }

    /// Deposit tokens and add commitment to merkle tree
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        commitment: [u8; 32],
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(!pool.paused, MurklError::PoolPaused);
        require!(amount >= pool.config.min_deposit, MurklError::DepositTooSmall);
        
        // Transfer tokens to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        // Update merkle root (simplified - append commitment)
        pool.merkle_root = keccak::hashv(&[&pool.merkle_root, &commitment]).0;
        
        // Create deposit record
        let deposit = &mut ctx.accounts.deposit;
        deposit.pool = pool.key();
        deposit.commitment = commitment;
        deposit.amount = amount;
        deposit.leaf_index = pool.leaf_count;
        deposit.claimed = false;
        deposit.bump = ctx.bumps.deposit;
        
        pool.leaf_count += 1;
        
        msg!("Deposit {} tokens, leaf index: {}", amount, deposit.leaf_index);
        Ok(())
    }

    /// Claim tokens - proof already verified in stark-verifier's buffer
    /// 
    /// Flow:
    /// 1. Relayer uploads proof to stark-verifier's proof buffer
    /// 2. Relayer calls stark-verifier::finalize_and_verify
    /// 3. Relayer calls this instruction with the verified buffer
    pub fn claim(
        ctx: Context<Claim>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
        relayer_fee: u64,
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let deposit = &mut ctx.accounts.deposit;
        
        require!(!pool.paused, MurklError::PoolPaused);
        require!(!deposit.claimed, MurklError::AlreadyClaimed);
        require!(commitment == deposit.commitment, MurklError::CommitmentMismatch);
        
        // Verify fee
        let max_fee = (deposit.amount * pool.config.max_relayer_fee_bps as u64) / 10000;
        require!(relayer_fee <= max_fee, MurklError::FeeTooHigh);
        
        // Verify the proof buffer from stark-verifier is finalized
        // The stark-verifier sets finalized=true after successful verification
        let verifier_buffer = &ctx.accounts.verifier_buffer;
        
        // Parse verifier buffer data (skip 8-byte discriminator)
        let data = verifier_buffer.try_borrow_data()?;
        require!(data.len() >= 73, MurklError::InvalidVerifierBuffer);
        
        // ProofBuffer layout: owner(32) + size(4) + expected_size(4) + finalized(1) + data...
        let finalized = data[8 + 32 + 4 + 4] == 1;
        require!(finalized, MurklError::ProofNotVerified);
        
        // TODO: Also verify commitment/nullifier match in buffer
        
        msg!("Proof verified via stark-verifier");
        
        // Mark as claimed
        deposit.claimed = true;
        
        // Calculate amounts
        let recipient_amount = deposit.amount - relayer_fee;
        
        // Transfer to recipient
        let pool_seeds = &[
            b"pool".as_ref(),
            pool.token_mint.as_ref(),
            &[pool.bump],
        ];
        let signer_seeds = &[&pool_seeds[..]];
        
        let transfer_to_recipient = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.recipient_token.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_to_recipient,
                signer_seeds,
            ),
            recipient_amount,
        )?;
        
        // Transfer fee to relayer (if any)
        if relayer_fee > 0 {
            let transfer_to_relayer = Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.relayer_token.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_to_relayer,
                    signer_seeds,
                ),
                relayer_fee,
            )?;
        }
        
        msg!("Claimed {} to recipient, {} fee to relayer", recipient_amount, relayer_fee);
        Ok(())
    }

    /// Admin: Pause pool
    pub fn pause_pool(ctx: Context<AdminAction>) -> Result<()> {
        ctx.accounts.pool.paused = true;
        msg!("Pool paused");
        Ok(())
    }

    /// Admin: Unpause pool
    pub fn unpause_pool(ctx: Context<AdminAction>) -> Result<()> {
        ctx.accounts.pool.paused = false;
        msg!("Pool unpaused");
        Ok(())
    }
}

// ============================================================================
// Accounts
// ============================================================================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::SIZE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = config.admin == admin.key() @ MurklError::Unauthorized
    )]
    pub config: Account<'info, GlobalConfig>,
    
    #[account(
        init,
        payer = admin,
        space = 8 + Pool::SIZE,
        seeds = [b"pool", token_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    
    /// CHECK: Token mint
    pub token_mint: UncheckedAccount<'info>,
    
    #[account(
        init,
        payer = admin,
        token::mint = token_mint,
        token::authority = pool,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    
    #[account(
        init,
        payer = depositor,
        space = 8 + DepositRecord::SIZE,
        seeds = [b"deposit", pool.key().as_ref(), &pool.leaf_count.to_le_bytes()],
        bump
    )]
    pub deposit: Account<'info, DepositRecord>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    #[account(mut)]
    pub depositor_token: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, Pool>,
    
    #[account(
        mut,
        seeds = [b"deposit", pool.key().as_ref(), &deposit.leaf_index.to_le_bytes()],
        bump = deposit.bump
    )]
    pub deposit: Account<'info, DepositRecord>,
    
    /// CHECK: stark-verifier's proof buffer (verified via finalized flag)
    #[account(
        constraint = verifier_buffer.owner == &STARK_VERIFIER_ID @ MurklError::InvalidVerifierBuffer
    )]
    pub verifier_buffer: UncheckedAccount<'info>,
    
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub recipient_token: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub relayer: Signer<'info>,
    
    #[account(mut)]
    pub relayer_token: Account<'info, TokenAccount>,
    
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump,
        constraint = pool.admin == admin.key() @ MurklError::Unauthorized
    )]
    pub pool: Account<'info, Pool>,
    
    pub admin: Signer<'info>,
}

// ============================================================================
// State
// ============================================================================

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub bump: u8,
}

impl GlobalConfig {
    pub const SIZE: usize = 32 + 1;
}

#[account]
pub struct Pool {
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub vault: Pubkey,
    pub merkle_root: [u8; 32],
    pub leaf_count: u64,
    pub config: PoolConfig,
    pub paused: bool,
    pub bump: u8,
}

impl Pool {
    pub const SIZE: usize = 32 + 32 + 32 + 32 + 8 + PoolConfig::SIZE + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PoolConfig {
    pub min_deposit: u64,
    pub max_relayer_fee_bps: u16,
}

impl PoolConfig {
    pub const SIZE: usize = 8 + 2;
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            min_deposit: MIN_DEPOSIT_AMOUNT,
            max_relayer_fee_bps: MAX_RELAYER_FEE_BPS,
        }
    }
}

#[account]
pub struct DepositRecord {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub amount: u64,
    pub leaf_index: u64,
    pub claimed: bool,
    pub bump: u8,
}

impl DepositRecord {
    pub const SIZE: usize = 32 + 32 + 8 + 8 + 1 + 1;
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum MurklError {
    #[msg("Pool is paused")]
    PoolPaused,
    
    #[msg("Deposit too small")]
    DepositTooSmall,
    
    #[msg("Already claimed")]
    AlreadyClaimed,
    
    #[msg("Commitment mismatch")]
    CommitmentMismatch,
    
    #[msg("Fee too high")]
    FeeTooHigh,
    
    #[msg("Unauthorized")]
    Unauthorized,
    
    #[msg("Proof not verified")]
    ProofNotVerified,
    
    #[msg("Invalid verifier buffer")]
    InvalidVerifierBuffer,
}
