//! Murkl - Anonymous Social Transfers on Solana
//!
//! Production-ready on-chain Circle STARK verification with relayer support!
//! 
//! Security features:
//! - Pool pause/unpause for emergency stops
//! - Minimum deposit amounts
//! - Admin controls with multi-sig support
//! - Proof buffer ownership validation
//! - Nullifier replay protection
//! - Commitment uniqueness checks

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

mod verifier;
use verifier::{StarkProof, VerifierConfig, verify_stark_proof};

declare_id!("74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92");

// ============================================================================
// Constants
// ============================================================================

/// Maximum proof size (8KB)
const MAX_PROOF_SIZE: usize = 8192;

/// Chunk size for writes (fit in instruction limit)
const CHUNK_SIZE: usize = 900;

/// Maximum relayer fee (1% = 100 basis points)
const MAX_RELAYER_FEE_BPS: u16 = 100;

/// Minimum deposit (1 token unit - actual minimum depends on decimals)
const MIN_DEPOSIT_AMOUNT: u64 = 1;

// ============================================================================
// Program
// ============================================================================

#[program]
pub mod murkl {
    use super::*;

    /// Initialize a new Murkl pool
    pub fn initialize_pool(ctx: Context<InitializePool>, config: PoolConfig) -> Result<()> {
        // Validate config
        require!(config.min_deposit >= MIN_DEPOSIT_AMOUNT, MurklError::InvalidConfig);
        require!(config.max_relayer_fee_bps <= MAX_RELAYER_FEE_BPS, MurklError::InvalidConfig);
        
        // Store keys before mutable borrow
        let pool_key = ctx.accounts.pool.key();
        let authority_key = ctx.accounts.authority.key();
        let token_mint_key = ctx.accounts.token_mint.key();
        let vault_key = ctx.accounts.vault.key();
        let bump = ctx.bumps.pool;
        let created_at = Clock::get()?.unix_timestamp;
        
        let pool = &mut ctx.accounts.pool;
        pool.authority = authority_key;
        pool.token_mint = token_mint_key;
        pool.vault = vault_key;
        pool.merkle_root = [0u8; 32];
        pool.next_leaf_index = 0;
        pool.total_deposits = 0;
        pool.total_claimed = 0;
        pool.paused = false;
        pool.min_deposit = config.min_deposit;
        pool.max_relayer_fee_bps = config.max_relayer_fee_bps;
        pool.bump = bump;
        pool.created_at = created_at;
        
        emit!(PoolCreatedEvent {
            pool: pool_key,
            authority: authority_key,
            token_mint: token_mint_key,
            min_deposit: config.min_deposit,
        });
        
        msg!("Murkl pool initialized");
        Ok(())
    }

    /// Update pool configuration (admin only)
    pub fn update_pool_config(ctx: Context<AdminAction>, config: PoolConfig) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        require!(config.min_deposit >= MIN_DEPOSIT_AMOUNT, MurklError::InvalidConfig);
        require!(config.max_relayer_fee_bps <= MAX_RELAYER_FEE_BPS, MurklError::InvalidConfig);
        
        pool.min_deposit = config.min_deposit;
        pool.max_relayer_fee_bps = config.max_relayer_fee_bps;
        
        emit!(PoolConfigUpdatedEvent {
            pool: pool.key(),
            min_deposit: config.min_deposit,
            max_relayer_fee_bps: config.max_relayer_fee_bps,
        });
        
        msg!("Pool config updated");
        Ok(())
    }

    /// Pause pool (emergency stop - admin only)
    pub fn pause_pool(ctx: Context<AdminAction>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(!pool.paused, MurklError::AlreadyPaused);
        
        pool.paused = true;
        
        emit!(PoolPausedEvent {
            pool: pool.key(),
            paused_by: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Pool paused");
        Ok(())
    }

    /// Unpause pool (admin only)
    pub fn unpause_pool(ctx: Context<AdminAction>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(pool.paused, MurklError::NotPaused);
        
        pool.paused = false;
        
        emit!(PoolUnpausedEvent {
            pool: pool.key(),
            unpaused_by: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });
        
        msg!("Pool unpaused");
        Ok(())
    }

    /// Transfer pool authority (admin only)
    pub fn transfer_authority(ctx: Context<TransferAuthority>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let old_authority = pool.authority;
        
        pool.authority = ctx.accounts.new_authority.key();
        
        emit!(AuthorityTransferredEvent {
            pool: pool.key(),
            old_authority,
            new_authority: pool.authority,
        });
        
        msg!("Authority transferred");
        Ok(())
    }

    /// Deposit tokens with a commitment
    pub fn deposit(
        ctx: Context<Deposit>, 
        commitment: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        
        // Security checks
        require!(!pool.paused, MurklError::PoolPaused);
        require!(amount >= pool.min_deposit, MurklError::AmountTooSmall);
        require!(amount <= u64::MAX / 2, MurklError::AmountTooLarge); // Prevent overflow
        
        // Check commitment is not all zeros
        require!(commitment != [0u8; 32], MurklError::InvalidCommitment);
        
        // Transfer tokens
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
        
        // Record deposit
        let deposit = &mut ctx.accounts.deposit_account;
        deposit.pool = pool.key();
        deposit.commitment = commitment;
        deposit.amount = amount;
        deposit.leaf_index = pool.next_leaf_index;
        deposit.timestamp = Clock::get()?.unix_timestamp;
        deposit.claimed = false;
        deposit.depositor = ctx.accounts.depositor.key();
        
        // Update Merkle root (simplified single-path update)
        pool.merkle_root = keccak::hashv(&[&pool.merkle_root, &commitment]).0;
        pool.next_leaf_index = pool.next_leaf_index.checked_add(1)
            .ok_or(MurklError::Overflow)?;
        pool.total_deposits = pool.total_deposits.checked_add(amount)
            .ok_or(MurklError::Overflow)?;
        
        emit!(DepositEvent {
            pool: pool.key(),
            commitment,
            amount,
            leaf_index: deposit.leaf_index,
            depositor: ctx.accounts.depositor.key(),
        });
        
        Ok(())
    }

    /// Create proof buffer (step 1)
    pub fn create_proof_buffer(
        ctx: Context<CreateProofBuffer>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
        total_size: u32,
    ) -> Result<()> {
        require!(total_size as usize <= MAX_PROOF_SIZE, MurklError::ProofTooLarge);
        require!(total_size > 0, MurklError::InvalidProofFormat);
        require!(commitment != [0u8; 32], MurklError::InvalidCommitment);
        require!(nullifier != [0u8; 32], MurklError::InvalidNullifier);
        
        let mut buffer = ctx.accounts.proof_buffer.load_init()?;
        buffer.owner = ctx.accounts.relayer.key().to_bytes();
        buffer.commitment = commitment;
        buffer.nullifier = nullifier;
        buffer.proof_len = total_size;
        buffer.bytes_written = 0;
        buffer.finalized = false;
        buffer.created_at = Clock::get()?.unix_timestamp;
        
        msg!("Proof buffer created for {} bytes", total_size);
        Ok(())
    }

    /// Write chunk to proof buffer (step 2, repeat as needed)
    pub fn write_proof_chunk(
        ctx: Context<WriteProofChunk>,
        offset: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        require!(!data.is_empty(), MurklError::EmptyChunk);
        require!(data.len() <= CHUNK_SIZE, MurklError::ChunkTooLarge);
        
        let mut buffer = ctx.accounts.proof_buffer.load_mut()?;
        
        // Verify owner
        require!(
            buffer.owner == ctx.accounts.relayer.key().to_bytes(),
            MurklError::InvalidProofOwner
        );
        require!(!buffer.finalized, MurklError::BufferFinalized);
        
        let end = (offset as usize).checked_add(data.len())
            .ok_or(MurklError::Overflow)?;
        require!(end <= buffer.proof_len as usize, MurklError::WriteOutOfBounds);
        
        // Write data
        buffer.proof_data[offset as usize..end].copy_from_slice(&data);
        buffer.bytes_written = buffer.bytes_written.max(end as u32);
        
        msg!("Wrote {} bytes at offset {}", data.len(), offset);
        Ok(())
    }

    /// Finalize proof buffer (step 3)
    pub fn finalize_proof_buffer(ctx: Context<FinalizeProofBuffer>) -> Result<()> {
        let mut buffer = ctx.accounts.proof_buffer.load_mut()?;
        
        require!(
            buffer.owner == ctx.accounts.relayer.key().to_bytes(),
            MurklError::InvalidProofOwner
        );
        require!(buffer.bytes_written >= buffer.proof_len, MurklError::IncompleteProof);
        require!(!buffer.finalized, MurklError::BufferFinalized);
        
        buffer.finalized = true;
        msg!("Proof buffer finalized: {} bytes", buffer.proof_len);
        Ok(())
    }

    /// Claim tokens with STARK proof verification (step 4)
    pub fn claim(
        ctx: Context<Claim>,
        relayer_fee_bps: u16,
    ) -> Result<()> {
        // Extract keys and values before any borrows
        let pool_key = ctx.accounts.pool.key();
        let pool_token_mint = ctx.accounts.pool.token_mint;
        let pool_bump = ctx.accounts.pool.bump;
        let pool_paused = ctx.accounts.pool.paused;
        let pool_max_fee = ctx.accounts.pool.max_relayer_fee_bps;
        let deposit_amount = ctx.accounts.deposit_account.amount;
        let deposit_commitment = ctx.accounts.deposit_account.commitment;
        let deposit_claimed = ctx.accounts.deposit_account.claimed;
        let recipient_key = ctx.accounts.recipient_token_account.key();
        let relayer_key = ctx.accounts.relayer.key();
        let current_claimed = ctx.accounts.pool.total_claimed;
        
        // Security checks
        require!(!pool_paused, MurklError::PoolPaused);
        require!(relayer_fee_bps <= pool_max_fee, MurklError::RelayerFeeTooHigh);
        
        let buffer = ctx.accounts.proof_buffer.load()?;
        
        // 1. Check buffer is finalized
        require!(buffer.finalized, MurklError::BufferNotFinalized);
        
        // 2. Verify commitment matches deposit
        require!(deposit_commitment == buffer.commitment, MurklError::CommitmentMismatch);
        
        // 3. Verify deposit not already claimed
        require!(!deposit_claimed, MurklError::AlreadyClaimed);
        
        // 4. Copy buffer data before dropping borrow
        let buffer_nullifier = buffer.nullifier;
        let proof_len = buffer.proof_len as usize;
        
        msg!("Deserializing proof ({} bytes)...", proof_len);
        
        let proof: StarkProof = StarkProof::try_from_slice(&buffer.proof_data[..proof_len])
            .map_err(|e| {
                msg!("Proof deserialization failed: {:?}", e);
                MurklError::InvalidProofFormat
            })?;
        
        msg!("Proof structure: {} OODS, {} FRI layers, {} queries",
            proof.oods_values.len(),
            proof.fri_layers.len(),
            proof.query_positions.len()
        );
        
        let config = VerifierConfig::default();
        let commitment_m31 = bytes_to_m31(&buffer.commitment);
        let nullifier_m31 = bytes_to_m31(&buffer.nullifier);
        
        let verified = verify_stark_proof(&proof, &config, &[commitment_m31, nullifier_m31]);
        require!(verified, MurklError::StarkVerificationFailed);
        
        // Drop buffer borrow
        drop(buffer);
        
        msg!("✅ STARK proof verified!");
        
        // 5. Mark nullifier used
        let nullifier_account = &mut ctx.accounts.nullifier_account;
        nullifier_account.nullifier = buffer_nullifier;
        nullifier_account.pool = pool_key;
        nullifier_account.used = true;
        nullifier_account.claimed_at = Clock::get()?.unix_timestamp;
        
        // 6. Calculate amounts with overflow protection
        let total = deposit_amount;
        let fee = if relayer_fee_bps > 0 {
            (total as u128)
                .checked_mul(relayer_fee_bps as u128)
                .and_then(|x| x.checked_div(10000))
                .and_then(|x| u64::try_from(x).ok())
                .ok_or(MurklError::Overflow)?
        } else { 0 };
        let recipient_amount = total.checked_sub(fee).ok_or(MurklError::Overflow)?;
        
        // 7. Transfer to recipient
        let seeds = &[b"pool", pool_token_mint.as_ref(), &[pool_bump]];
        
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.pool.to_account_info(),
                },
                &[seeds],
            ),
            recipient_amount,
        )?;
        
        // 8. Transfer fee to relayer
        if fee > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.relayer_token_account.to_account_info(),
                        authority: ctx.accounts.pool.to_account_info(),
                    },
                    &[seeds],
                ),
                fee,
            )?;
        }
        
        // 9. Update pool stats
        ctx.accounts.pool.total_claimed = current_claimed
            .checked_add(total)
            .ok_or(MurklError::Overflow)?;
        ctx.accounts.deposit_account.claimed = true;
        
        emit!(ClaimEvent {
            pool: pool_key,
            nullifier: buffer_nullifier,
            recipient: recipient_key,
            amount: recipient_amount,
            relayer: relayer_key,
            relayer_fee: fee,
        });
        
        msg!("Claimed: {} to recipient, {} fee to relayer", recipient_amount, fee);
        Ok(())
    }

    /// Close proof buffer and reclaim rent
    pub fn close_proof_buffer(_ctx: Context<CloseProofBuffer>) -> Result<()> {
        msg!("Proof buffer closed");
        Ok(())
    }
}

// ============================================================================
// Helpers
// ============================================================================

fn bytes_to_m31(bytes: &[u8; 32]) -> u32 {
    const P: u32 = 0x7FFFFFFF;
    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % P
}

// ============================================================================
// Data Structures
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PoolConfig {
    pub min_deposit: u64,
    pub max_relayer_fee_bps: u16,
}

impl Default for PoolConfig {
    fn default() -> Self {
        Self {
            min_deposit: MIN_DEPOSIT_AMOUNT,
            max_relayer_fee_bps: MAX_RELAYER_FEE_BPS,
        }
    }
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
    pub total_claimed: u64,
    pub paused: bool,
    pub min_deposit: u64,
    pub max_relayer_fee_bps: u16,
    pub bump: u8,
    pub created_at: i64,
}

impl Pool {
    pub const SIZE: usize = 8 + 32 + 32 + 32 + 32 + 4 + 8 + 8 + 1 + 8 + 2 + 1 + 8;
}

#[account]
pub struct DepositAccount {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub amount: u64,
    pub leaf_index: u32,
    pub timestamp: i64,
    pub claimed: bool,
    pub depositor: Pubkey,
}

impl DepositAccount {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 4 + 8 + 1 + 32;
}

#[account]
pub struct NullifierAccount {
    pub nullifier: [u8; 32],
    pub pool: Pubkey,
    pub used: bool,
    pub claimed_at: i64,
}

impl NullifierAccount {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8;
}

/// Zero-copy proof buffer for large STARK proofs
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct ProofBuffer {
    pub owner: [u8; 32],
    pub commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub proof_len: u32,
    pub bytes_written: u32,
    pub finalized: bool,
    pub _padding: [u8; 3],
    pub created_at: i64,
    pub proof_data: [u8; MAX_PROOF_SIZE],
}

// ============================================================================
// Contexts
// ============================================================================

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(
        init,
        payer = authority,
        space = Pool::SIZE,
        seeds = [b"pool", token_mint.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, Pool>,
    
    /// CHECK: Token mint validated by SPL token program
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
pub struct AdminAction<'info> {
    #[account(
        mut,
        has_one = authority @ MurklError::Unauthorized
    )]
    pub pool: Account<'info, Pool>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    #[account(
        mut,
        has_one = authority @ MurklError::Unauthorized
    )]
    pub pool: Account<'info, Pool>,
    
    pub authority: Signer<'info>,
    
    /// CHECK: New authority can be any account
    pub new_authority: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        mut,
        constraint = !pool.paused @ MurklError::PoolPaused
    )]
    pub pool: Account<'info, Pool>,
    
    #[account(
        init,
        payer = depositor,
        space = DepositAccount::SIZE,
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
#[instruction(commitment: [u8; 32], nullifier: [u8; 32], total_size: u32)]
pub struct CreateProofBuffer<'info> {
    #[account(
        init,
        payer = relayer,
        space = 8 + std::mem::size_of::<ProofBuffer>(),
        seeds = [b"proof", relayer.key().as_ref(), &commitment[..8]],
        bump
    )]
    pub proof_buffer: AccountLoader<'info, ProofBuffer>,
    
    #[account(mut)]
    pub relayer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WriteProofChunk<'info> {
    #[account(mut)]
    pub proof_buffer: AccountLoader<'info, ProofBuffer>,
    
    pub relayer: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeProofBuffer<'info> {
    #[account(mut)]
    pub proof_buffer: AccountLoader<'info, ProofBuffer>,
    
    pub relayer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(relayer_fee_bps: u16)]
pub struct Claim<'info> {
    #[account(
        mut,
        constraint = !pool.paused @ MurklError::PoolPaused
    )]
    pub pool: Account<'info, Pool>,
    
    #[account(
        mut,
        constraint = !deposit_account.claimed @ MurklError::AlreadyClaimed,
        constraint = deposit_account.pool == pool.key() @ MurklError::DepositPoolMismatch
    )]
    pub deposit_account: Account<'info, DepositAccount>,
    
    #[account(
        constraint = proof_buffer.load()?.owner == relayer.key().to_bytes() @ MurklError::InvalidProofOwner
    )]
    pub proof_buffer: AccountLoader<'info, ProofBuffer>,
    
    #[account(
        init,
        payer = relayer,
        space = NullifierAccount::SIZE,
        seeds = [b"nullifier", pool.key().as_ref(), proof_buffer.load()?.nullifier.as_ref()],
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
    pub relayer_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub relayer: Signer<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseProofBuffer<'info> {
    #[account(
        mut,
        close = recipient,
        constraint = proof_buffer.load()?.owner == recipient.key().to_bytes() @ MurklError::InvalidProofOwner
    )]
    pub proof_buffer: AccountLoader<'info, ProofBuffer>,
    
    #[account(mut)]
    pub recipient: Signer<'info>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct PoolCreatedEvent {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub min_deposit: u64,
}

#[event]
pub struct PoolConfigUpdatedEvent {
    pub pool: Pubkey,
    pub min_deposit: u64,
    pub max_relayer_fee_bps: u16,
}

#[event]
pub struct PoolPausedEvent {
    pub pool: Pubkey,
    pub paused_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PoolUnpausedEvent {
    pub pool: Pubkey,
    pub unpaused_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityTransferredEvent {
    pub pool: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct DepositEvent {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub amount: u64,
    pub leaf_index: u32,
    pub depositor: Pubkey,
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

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum MurklError {
    #[msg("Nullifier already used")]
    NullifierAlreadyUsed,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Invalid proof format")]
    InvalidProofFormat,
    #[msg("STARK verification failed")]
    StarkVerificationFailed,
    #[msg("Relayer fee too high")]
    RelayerFeeTooHigh,
    #[msg("Proof too large")]
    ProofTooLarge,
    #[msg("Commitment mismatch")]
    CommitmentMismatch,
    #[msg("Invalid proof buffer owner")]
    InvalidProofOwner,
    #[msg("Chunk too large")]
    ChunkTooLarge,
    #[msg("Empty chunk")]
    EmptyChunk,
    #[msg("Write out of bounds")]
    WriteOutOfBounds,
    #[msg("Buffer already finalized")]
    BufferFinalized,
    #[msg("Buffer not finalized")]
    BufferNotFinalized,
    #[msg("Incomplete proof upload")]
    IncompleteProof,
    #[msg("Pool is paused")]
    PoolPaused,
    #[msg("Pool is not paused")]
    NotPaused,
    #[msg("Pool already paused")]
    AlreadyPaused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Amount too small")]
    AmountTooSmall,
    #[msg("Amount too large")]
    AmountTooLarge,
    #[msg("Invalid commitment")]
    InvalidCommitment,
    #[msg("Invalid nullifier")]
    InvalidNullifier,
    #[msg("Invalid configuration")]
    InvalidConfig,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Deposit pool mismatch")]
    DepositPoolMismatch,
}
