# Murkl SDK Integration Guide

This guide explains how to integrate Murkl's Circle STARK verifier into your Solana programs.

## Overview

Murkl provides a complete SDK for STARK-based privacy:

| Component | Description |
|-----------|-------------|
| **stark-verifier** | On-chain STARK verification program |
| **murkl-prover** | Core Rust prover library |
| **murkl-wasm** | Browser prover (WASM) |
| **murkl-cli** | Command-line prover |
| **example-integration** | Working CPI example |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MURKL SDK ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  OFF-CHAIN (Prover)              ON-CHAIN (Verifier)           │
│  ┌─────────────────┐             ┌─────────────────┐           │
│  │  murkl-prover   │             │ stark-verifier  │           │
│  │  murkl-wasm     │ ──proof──►  │                 │           │
│  │  murkl-cli      │             │ verify_proof()  │           │
│  └─────────────────┘             └────────┬────────┘           │
│                                           │                    │
│                                     CPI   │                    │
│                                           ▼                    │
│                                  ┌─────────────────┐           │
│                                  │  Your Program   │           │
│                                  │                 │           │
│                                  │ • Check proof   │           │
│                                  │ • Take action   │           │
│                                  └─────────────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Integration Patterns

### Pattern 1: Buffer-Based Verification (Recommended)

For proofs > 1KB, use stark-verifier's proof buffer:

```
1. init_proof_buffer() → Create buffer account
2. upload_chunk() → Upload proof in chunks
3. finalize_and_verify() → Verify proof, set finalized=true
4. Your program checks buffer.finalized flag
```

**Your program:**

```rust
use anchor_lang::prelude::*;

pub const STARK_VERIFIER_ID: Pubkey = pubkey!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

#[derive(Accounts)]
pub struct VerifyAndAct<'info> {
    /// CHECK: stark-verifier's proof buffer
    #[account(
        constraint = verifier_buffer.owner == &STARK_VERIFIER_ID
    )]
    pub verifier_buffer: UncheckedAccount<'info>,
    
    // ... your accounts
}

pub fn verify_and_act(ctx: Context<VerifyAndAct>) -> Result<()> {
    // Check the proof buffer is finalized (proof was verified)
    let data = ctx.accounts.verifier_buffer.try_borrow_data()?;
    
    // ProofBuffer layout: discriminator(8) + owner(32) + size(4) + expected_size(4) + finalized(1)
    require!(data.len() >= 49, YourError::InvalidBuffer);
    let finalized = data[8 + 32 + 4 + 4] == 1;
    require!(finalized, YourError::ProofNotVerified);
    
    // Proof is valid! Take your action
    msg!("Proof verified, executing action...");
    
    Ok(())
}
```

### Pattern 2: Direct CPI (Small Proofs)

For proofs < 1KB, call verify_proof directly:

```rust
pub fn verify_direct(
    ctx: Context<VerifyDirect>,
    proof_data: Vec<u8>,
    public_inputs: Vec<u8>,
) -> Result<()> {
    // Build CPI instruction
    let ix = solana_program::instruction::Instruction {
        program_id: STARK_VERIFIER_ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.payer.key(), true),
        ],
        data: build_verify_proof_data(&proof_data, &public_inputs),
    };
    
    // Execute CPI - will fail if proof invalid
    solana_program::program::invoke(
        &ix,
        &[ctx.accounts.payer.to_account_info()],
    )?;
    
    // If we get here, proof is valid
    Ok(())
}

fn build_verify_proof_data(proof: &[u8], inputs: &[u8]) -> Vec<u8> {
    // Anchor discriminator for "verify_proof"
    let disc: [u8; 8] = [0x40, 0x9d, 0x08, 0x6c, 0x7a, 0x98, 0x9b, 0x8a];
    let mut data = Vec::new();
    data.extend_from_slice(&disc);
    data.extend_from_slice(&(proof.len() as u32).to_le_bytes());
    data.extend_from_slice(proof);
    data.extend_from_slice(&(inputs.len() as u32).to_le_bytes());
    data.extend_from_slice(inputs);
    data
}
```

## Complete Example

See [`programs/example-integration`](../programs/example-integration/src/lib.rs) for a full working example demonstrating:

- **verify_and_record** — Buffer-based verification with on-chain record
- **verify_direct_cpi** — Direct CPI for small proofs
- **verify_and_mint** — Gating NFT minting on proof verification

## Proof Generation

### Browser (WASM)

```typescript
import init, { generate_proof } from 'murkl-wasm';

await init();

// Generate proof for claiming
const result = generate_proof(identifier, password, leafIndex, merklePathJson);
// result.proof (Uint8Array), result.commitment, result.nullifier
```

### CLI

```bash
# Generate commitment (for deposit)
murkl commit -i "@alice" -p "secretpass"
# Output: commitment hex

# Generate proof (for claim)
murkl prove -i "@alice" -p "secretpass" -l 0 -m merkle.json -o proof.bin
# Output: proof.bin file

# Verify locally
murkl verify -p proof.bin -c <commitment_hex>
```

### Rust

```rust
use murkl_prover::prelude::*;

// Build the AIR and trace
let air = TransferAir::new(/* ... */);
let trace = build_trace(&air, /* ... */);

// Generate proof
let proof = prover::prove(&air, &trace, &public_inputs)?;
let proof_bytes = proof.serialize();
```

## Public Inputs Format

Public inputs are serialized as 96 bytes:

```
┌─────────────────────────────────────────────┐
│ commitment (32 bytes)                       │
├─────────────────────────────────────────────┤
│ nullifier (32 bytes)                        │
├─────────────────────────────────────────────┤
│ merkle_root (32 bytes)                      │
└─────────────────────────────────────────────┘
```

```rust
let mut public_inputs = Vec::with_capacity(96);
public_inputs.extend_from_slice(&commitment);
public_inputs.extend_from_slice(&nullifier);
public_inputs.extend_from_slice(&merkle_root);
```

## Use Cases

### Privacy-Preserving Airdrops

```rust
pub fn claim_airdrop(
    ctx: Context<ClaimAirdrop>,
    commitment: [u8; 32],
    nullifier: [u8; 32],
) -> Result<()> {
    // Check verifier buffer is finalized
    let data = ctx.accounts.verifier_buffer.try_borrow_data()?;
    let finalized = data[48] == 1;
    require!(finalized, AirdropError::InvalidProof);
    
    // Check nullifier not used (prevent double-claim)
    let nullifier_pda = &ctx.accounts.nullifier_record;
    require!(!nullifier_pda.used, AirdropError::AlreadyClaimed);
    
    // Mark nullifier used and transfer tokens
    let nullifier_pda = &mut ctx.accounts.nullifier_record;
    nullifier_pda.used = true;
    nullifier_pda.nullifier = nullifier;
    
    transfer_tokens(ctx, airdrop_amount)?;
    Ok(())
}
```

### Anonymous Voting

```rust
pub fn cast_vote(
    ctx: Context<CastVote>,
    nullifier: [u8; 32],
    vote_choice: u8,
) -> Result<()> {
    // Verify proof via buffer
    let data = ctx.accounts.verifier_buffer.try_borrow_data()?;
    require!(data[48] == 1, VoteError::NotEligible);
    
    // Check this nullifier hasn't voted
    require!(!ctx.accounts.ballot.has_voted(&nullifier), VoteError::AlreadyVoted);
    
    // Record vote
    ctx.accounts.ballot.record_vote(nullifier, vote_choice);
    Ok(())
}
```

### Proof-Gated NFT Minting

```rust
pub fn mint_exclusive_nft(
    ctx: Context<MintNFT>,
    nullifier: [u8; 32],
) -> Result<()> {
    // Verify proof
    let data = ctx.accounts.verifier_buffer.try_borrow_data()?;
    require!(data[48] == 1, MintError::InvalidProof);
    
    // Track nullifier (one mint per proof)
    let nullifier_pda = &mut ctx.accounts.nullifier_record;
    require!(!nullifier_pda.used, MintError::AlreadyMinted);
    nullifier_pda.used = true;
    
    // Mint NFT
    token::mint_to(/* ... */, 1)?;
    Ok(())
}
```

## Compute Units

| Operation | CU |
|-----------|-----|
| STARK proof verification | ~40,000 |
| Merkle path (depth 20) | ~5,000 |
| keccak256 hash (syscall) | ~100 |
| Token transfer | ~2,000 |
| **Total typical claim** | ~50,000 |

Well within Solana's 1.4M CU limit.

## Program Addresses

| Program | Address |
|---------|---------|
| **stark-verifier** | `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw` |
| **murkl** (transfer pools) | `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92` |

## Security Considerations

1. **Always Track Nullifiers** — Store nullifiers in PDAs to prevent double-spend
2. **Verify Buffer Ownership** — Check `verifier_buffer.owner == STARK_VERIFIER_ID`
3. **Check Finalized Flag** — Never trust a buffer that isn't finalized
4. **Match Public Inputs** — Ensure commitment/nullifier in your logic match the proof

## Troubleshooting

### "Proof not verified"
- Buffer wasn't finalized yet
- Call `finalize_and_verify` before your instruction

### "Invalid verifier buffer"
- Buffer owned by wrong program
- Verify `verifier_buffer.owner == STARK_VERIFIER_ID`

### CPI fails with proof
- Proof too large for single transaction
- Use buffer pattern instead of direct CPI

### High CU usage
- Proof has many FRI layers
- Use faster prover config for smaller proofs

## Resources

- [Example Integration](../programs/example-integration/src/lib.rs)
- [Stark Verifier](../programs/stark-verifier/src/lib.rs)
- [WASM Prover](../wasm/)
- [Circle STARKs Paper](https://eprint.iacr.org/2024/278)
