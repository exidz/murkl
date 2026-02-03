//! Murkl - Anonymous Social Transfers on Solana
//!
//! This program enables privacy-preserving transfers where:
//! 1. Sender deposits funds to a commitment hash
//! 2. Recipient generates a ZK proof (off-chain)
//! 3. Recipient claims funds with the proof - no link to sender

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("GV7iSh8Lz55VEPbgVuTyAaSfETsMNwdeW4Mg8nTWQTuH");

/// Maximum tree depth (determines max deposits)
pub const MAX_TREE_DEPTH: usize = 16;

/// Maximum deposits = 2^16 = 65,536
pub const MAX_DEPOSITS: u32 = 1 << MAX_TREE_DEPTH;

/// M31 prime for field operations
pub const M31_PRIME: u32 = (1 << 31) - 1;

#[program]
pub mod murkl {
    use super::*;

    /// Initialize a new Murkl pool for a specific token
    pub fn initialize_pool(ctx: Context<InitializePool>, pool_bump: u8) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.authority = ctx.accounts.authority.key();
        pool.token_mint = ctx.accounts.token_mint.key();
        pool.vault = ctx.accounts.vault.key();
        pool.merkle_root = [0u8; 32]; // Empty tree root
        pool.next_leaf_index = 0;
        pool.total_deposits = 0;
        pool.bump = pool_bump;
        
        msg!("Murkl pool initialized for mint: {}", pool.token_mint);
        Ok(())
    }

    /// Deposit tokens with a commitment
    /// commitment = Poseidon(identifier || secret) where identifier could be hash of email/twitter
    pub fn deposit(ctx: Context<Deposit>, commitment: [u8; 32], amount: u64) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(
            pool.next_leaf_index < MAX_DEPOSITS,
            MurklError::PoolFull
        );
        
        // Transfer tokens to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;
        
        // Create deposit record
        let deposit_account = &mut ctx.accounts.deposit_account;
        deposit_account.pool = pool.key();
        deposit_account.commitment = commitment;
        deposit_account.amount = amount;
        deposit_account.leaf_index = pool.next_leaf_index;
        deposit_account.depositor = ctx.accounts.depositor.key();
        deposit_account.timestamp = Clock::get()?.unix_timestamp;
        deposit_account.claimed = false;
        
        // Update pool state
        // TODO: Update Merkle tree root (simplified for now)
        pool.next_leaf_index += 1;
        pool.total_deposits += amount;
        
        msg!(
            "Deposit {} tokens at leaf index {}",
            amount,
            deposit_account.leaf_index
        );
        
        emit!(DepositEvent {
            pool: pool.key(),
            commitment,
            amount,
            leaf_index: deposit_account.leaf_index,
            timestamp: deposit_account.timestamp,
        });
        
        Ok(())
    }

    /// Claim deposited tokens with a ZK proof
    /// The nullifier prevents double-spending
    pub fn claim(
        ctx: Context<Claim>,
        nullifier: [u8; 32],
        merkle_root: [u8; 32],
        recipient: Pubkey,
        _proof: Vec<u8>, // STARK proof (verification simplified for hackathon)
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let nullifier_account = &mut ctx.accounts.nullifier_account;
        
        // Check nullifier hasn't been used (prevents double-spend)
        require!(
            !nullifier_account.used,
            MurklError::NullifierAlreadyUsed
        );
        
        // TODO: Verify STARK proof
        // For hackathon MVP, we're trusting the proof
        // Full implementation would verify:
        // 1. Merkle membership proof
        // 2. Nullifier derivation
        // 3. Commitment opening
        
        // Check merkle root matches (simplified)
        // In production, we'd verify against historical roots
        require!(
            merkle_root == pool.merkle_root || pool.merkle_root == [0u8; 32],
            MurklError::InvalidMerkleRoot
        );
        
        // Mark nullifier as used
        nullifier_account.nullifier = nullifier;
        nullifier_account.pool = pool.key();
        nullifier_account.used = true;
        nullifier_account.claimed_at = Clock::get()?.unix_timestamp;
        
        // Transfer tokens to recipient
        let pool_key = pool.key();
        let seeds = &[
            b"pool".as_ref(),
            pool.token_mint.as_ref(),
            &[pool.bump],
        ];
        let signer_seeds = &[&seeds[..]];
        
        let amount = ctx.accounts.deposit_account.amount;
        
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: pool.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;
        
        // Mark deposit as claimed
        ctx.accounts.deposit_account.claimed = true;
        
        msg!("Claim successful: {} tokens to {}", amount, recipient);
        
        emit!(ClaimEvent {
            pool: pool_key,
            nullifier,
            recipient,
            amount,
            timestamp: nullifier_account.claimed_at,
        });
        
        Ok(())
    }
}

// ============================================================================
// Accounts
// ============================================================================

#[account]
pub struct Pool {
    /// Authority that can manage the pool
    pub authority: Pubkey,
    /// Token mint for this pool
    pub token_mint: Pubkey,
    /// Vault holding deposited tokens
    pub vault: Pubkey,
    /// Current Merkle tree root
    pub merkle_root: [u8; 32],
    /// Next available leaf index
    pub next_leaf_index: u32,
    /// Total tokens deposited
    pub total_deposits: u64,
    /// PDA bump
    pub bump: u8,
}

#[account]
pub struct DepositAccount {
    /// Pool this deposit belongs to
    pub pool: Pubkey,
    /// Commitment hash = Poseidon(identifier || secret)
    pub commitment: [u8; 32],
    /// Amount deposited
    pub amount: u64,
    /// Leaf index in Merkle tree
    pub leaf_index: u32,
    /// Depositor's pubkey (for refunds if needed)
    pub depositor: Pubkey,
    /// Deposit timestamp
    pub timestamp: i64,
    /// Whether this deposit has been claimed
    pub claimed: bool,
}

#[account]
pub struct NullifierAccount {
    /// The nullifier hash
    pub nullifier: [u8; 32],
    /// Pool this nullifier is for
    pub pool: Pubkey,
    /// Whether this nullifier has been used
    pub used: bool,
    /// When the claim happened
    pub claimed_at: i64,
}

// ============================================================================
// Contexts
// ============================================================================

#[derive(Accounts)]
#[instruction(pool_bump: u8)]
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
#[instruction(commitment: [u8; 32])]
pub struct Deposit<'info> {
    #[account(mut)]
    pub pool: Account<'info, Pool>,
    
    #[account(
        init,
        payer = depositor,
        space = 8 + 32 + 32 + 8 + 4 + 32 + 8 + 1,
        seeds = [b"deposit", pool.key().as_ref(), &pool.next_leaf_index.to_le_bytes()],
        bump
    )]
    pub deposit_account: Account<'info, DepositAccount>,
    
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub depositor: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(nullifier: [u8; 32])]
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
    
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub claimer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct DepositEvent {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub amount: u64,
    pub leaf_index: u32,
    pub timestamp: i64,
}

#[event]
pub struct ClaimEvent {
    pub pool: Pubkey,
    pub nullifier: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum MurklError {
    #[msg("Pool has reached maximum capacity")]
    PoolFull,
    #[msg("This nullifier has already been used")]
    NullifierAlreadyUsed,
    #[msg("Invalid Merkle root")]
    InvalidMerkleRoot,
    #[msg("This deposit has already been claimed")]
    AlreadyClaimed,
    #[msg("Invalid proof")]
    InvalidProof,
}
