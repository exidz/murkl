# Murkl SDK Integration Guide

This guide explains how to integrate Murkl's Circle STARK verifier into your Solana programs.

## Overview

Murkl provides three ways to integrate:

1. **Direct Library Use** — Import verifier functions directly (recommended)
2. **CPI Interface** — Call Murkl program via Cross-Program Invocation
3. **Off-chain Only** — Use prover for off-chain proof generation

## Quick Start

### Add Dependency

```toml
# Cargo.toml
[dependencies]
murkl-program = { path = "../murkl/programs/murkl", features = ["cpi"] }
```

### Basic Verification

```rust
use murkl_program::verifier::{verify_proof_cpi, VerificationResult};

pub fn verify_user_proof(
    proof_data: &[u8],
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
) -> Result<VerificationResult> {
    let result = verify_proof_cpi(proof_data, commitment, nullifier)?;
    require!(result.valid, YourError::InvalidProof);
    Ok(result)
}
```

## Complete Example

See [`programs/example-integration`](../programs/example-integration/src/lib.rs) for a working example program that demonstrates:

- `verify_and_record` — Basic proof verification with on-chain record
- `verify_with_raw_ops` — Using low-level field operations
- `verify_and_mint` — Gating NFT minting on proof verification

## API Reference

### Core Functions

#### `verify_proof_cpi`

Verify a STARK proof against commitment and nullifier.

```rust
pub fn verify_proof_cpi(
    proof_data: &[u8],
    commitment: &[u8; 32],
    nullifier: &[u8; 32],
) -> Result<VerificationResult>
```

**Parameters:**
- `proof_data` — Serialized STARK proof bytes
- `commitment` — 32-byte commitment hash
- `nullifier` — 32-byte nullifier (prevents double-spend)

**Returns:** `VerificationResult` with `valid`, `fri_layers`, `oods_values`

**Example:**
```rust
let result = verify_proof_cpi(&proof_bytes, &commitment, &nullifier)?;
if result.valid {
    msg!("Proof verified with {} FRI layers", result.fri_layers);
}
```

#### `verify_stark_proof`

Lower-level verification with custom config.

```rust
pub fn verify_stark_proof(
    proof: &StarkProof,
    config: &VerifierConfig,
    public_input: &[u32],
) -> bool
```

**Parameters:**
- `proof` — Deserialized `StarkProof` struct
- `config` — `VerifierConfig` (log_trace_size, n_queries, etc.)
- `public_input` — Array of M31 field elements

#### `bytes_to_m31`

Convert 32-byte hash to M31 field element.

```rust
pub fn bytes_to_m31(bytes: &[u8; 32]) -> u32
```

Takes first 4 bytes as little-endian u32, reduces mod M31 prime.

#### `compute_commitment`

Compute commitment hash matching WASM/CLI format.

```rust
pub fn compute_commitment(id_hash: u32, secret: u32) -> [u8; 32]
```

**Computation:** `keccak256("murkl_m31_hash_v1" || id_hash || secret)`

#### `compute_nullifier`

Compute nullifier hash matching WASM/CLI format.

```rust
pub fn compute_nullifier(secret: u32, leaf_index: u32) -> [u8; 32]
```

**Computation:** `keccak256("murkl_nullifier_v1" || secret || leaf_index)`

### Field Operations

For advanced use cases, you can access M31/QM31 field operations:

```rust
use murkl_program::verifier::{
    m31_add, m31_sub, m31_mul, m31_inv, m31_neg,
    QM31, P,
};

// M31 arithmetic
let sum = m31_add(a, b);
let product = m31_mul(a, b);
let inverse = m31_inv(a);

// QM31 extension field
let x = QM31::from_m31(42);
let y = QM31::one();
let z = x.mul(&y);
```

### Merkle Verification

```rust
use murkl_program::verifier::verify_merkle_path;

let valid = verify_merkle_path(
    &merkle_root,
    &leaf_hash,
    leaf_index,
    &merkle_path,
);
```

### Channel (Fiat-Shamir)

```rust
use murkl_program::verifier::Channel;

let mut channel = Channel::new();
channel.mix(b"domain_separator");
channel.mix_commitment(&commitment);
let challenge = channel.draw_felt();
```

## Use Cases

### Privacy-Preserving Airdrops

Gate token distribution on proof of eligibility without revealing identity:

```rust
pub fn claim_airdrop(
    ctx: Context<ClaimAirdrop>,
    proof_data: Vec<u8>,
    commitment: [u8; 32],
    nullifier: [u8; 32],
) -> Result<()> {
    // Verify user knows the secret for this commitment
    let result = verify_proof_cpi(&proof_data, &commitment, &nullifier)?;
    require!(result.valid, AirdropError::InvalidProof);
    
    // Check nullifier not used (prevent double-claim)
    require!(
        !ctx.accounts.nullifier_tracker.is_used(&nullifier),
        AirdropError::AlreadyClaimed
    );
    
    // Mark nullifier used and transfer tokens
    ctx.accounts.nullifier_tracker.mark_used(&nullifier);
    transfer_tokens(&ctx, airdrop_amount)?;
    
    Ok(())
}
```

### Anonymous Voting

Prove membership in voter set without revealing identity:

```rust
pub fn cast_vote(
    ctx: Context<CastVote>,
    proof_data: Vec<u8>,
    voter_commitment: [u8; 32],
    vote_nullifier: [u8; 32],
    vote_choice: u8,
) -> Result<()> {
    // Verify voter is eligible (knows preimage of commitment in voter set)
    let result = verify_proof_cpi(&proof_data, &voter_commitment, &vote_nullifier)?;
    require!(result.valid, VoteError::NotEligible);
    
    // Check this nullifier hasn't voted
    require!(
        !ctx.accounts.ballot.has_voted(&vote_nullifier),
        VoteError::AlreadyVoted
    );
    
    // Record vote
    ctx.accounts.ballot.record_vote(vote_nullifier, vote_choice);
    
    Ok(())
}
```

### Proof-Gated NFT Minting

Mint NFTs only to users who can prove something:

```rust
pub fn mint_exclusive_nft(
    ctx: Context<MintNFT>,
    proof_data: Vec<u8>,
    commitment: [u8; 32],
    nullifier: [u8; 32],
) -> Result<()> {
    // Verify proof
    let result = verify_proof_cpi(&proof_data, &commitment, &nullifier)?;
    require!(result.valid, MintError::InvalidProof);
    
    // Mint NFT
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.nft_mint.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
                authority: ctx.accounts.mint_authority.to_account_info(),
            },
            &[&[b"authority", &[ctx.bumps.mint_authority]]],
        ),
        1,
    )?;
    
    Ok(())
}
```

## Proof Generation

### WASM (Browser)

```typescript
import init, { generate_proof, generate_commitment, generate_nullifier } from 'murkl-wasm';

await init();

// Generate commitment for deposit
const commitment = generate_commitment("user@email.com", "password123");

// Generate proof for claim
const proofBundle = generate_proof("user@email.com", "password123", leafIndex);
// proofBundle.proof, proofBundle.commitment, proofBundle.nullifier
```

### CLI

```bash
# Generate commitment
murkl commit -i "user@email.com" -p "password123"

# Generate proof
murkl prove -i "user@email.com" -p "password123" -l 0 -m merkle.json
```

### Rust (Native)

```rust
use murkl_prover::prelude::*;
use murkl_prover::prover::{Prover, ProverConfig};

// Create prover
let prover = Prover::new(ProverConfig::default());

// Generate proof
let proof = prover.prove(&air, &trace, public_inputs)?;
let proof_bytes = proof.to_bytes();
```

## Testing

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_commitment_computation() {
        let commitment = compute_commitment(12345, 67890);
        assert_eq!(commitment.len(), 32);
        
        // Should be deterministic
        let commitment2 = compute_commitment(12345, 67890);
        assert_eq!(commitment, commitment2);
    }
    
    #[test]
    fn test_nullifier_different_indices() {
        let n1 = compute_nullifier(12345, 0);
        let n2 = compute_nullifier(12345, 1);
        assert_ne!(n1, n2);
    }
}
```

### Integration Tests (Anchor)

```typescript
import * as anchor from "@coral-xyz/anchor";

describe("murkl-integration", () => {
  it("verifies proof and records", async () => {
    // Generate proof off-chain
    const proofBundle = await generateProof(identifier, password, leafIndex);
    
    // Submit to on-chain verifier
    await program.methods
      .verifyAndRecord(
        Buffer.from(proofBundle.proof),
        Array.from(proofBundle.commitment),
        Array.from(proofBundle.nullifier),
      )
      .accounts({
        config: configPda,
        verificationRecord: recordPda,
        verifier: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    // Check record
    const record = await program.account.verificationRecord.fetch(recordPda);
    expect(record.commitment).to.deep.equal(proofBundle.commitment);
  });
});
```

## Compute Units

Typical CU consumption:

| Operation | CU |
|-----------|-----|
| Verify STARK proof | ~40,000 |
| Merkle path (depth 20) | ~5,000 |
| Commitment/nullifier hash | ~100 |
| Transfer tokens | ~2,000 |
| **Total claim** | ~50,000 |

Well within Solana's 1.4M CU limit per transaction.

## Security Considerations

1. **Nullifier Tracking** — Always track nullifiers to prevent double-spend
2. **Commitment Uniqueness** — Check commitments aren't reused across pools
3. **Domain Separation** — Use consistent hash prefixes matching WASM/CLI
4. **Input Validation** — Validate proof size and format before deserialization

## Troubleshooting

### "InvalidProofFormat" Error

- Check proof bytes are correctly serialized
- Ensure proof was generated with compatible WASM/CLI version
- Verify proof size is within limits (max 8KB)

### "VerificationFailed" Error

- Check commitment matches the one used in proof generation
- Verify nullifier is computed correctly
- Ensure identifier normalization (lowercase) matches

### High CU Usage

- Use `ProverConfig::fast()` for smaller proofs
- Reduce trace size if possible
- Consider batching multiple verifications

## Resources

- [Murkl GitHub](https://github.com/exidz/murkl)
- [Circle STARKs Paper](https://eprint.iacr.org/2024/278)
- [Example Integration](../programs/example-integration)
- [WASM Package](../wasm)
