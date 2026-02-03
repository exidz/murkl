# Murkl

Anonymous social transfers on Solana via Circle STARKs (M31)

> *Your transactions, murky to everyone else.*

## The Idea

Send tokens to someone's email/Twitter. They claim privately — no one can link sender to receiver.

## Architecture

```
DEPOSIT: User → Contract (commitment = hash(identifier || secret))
                    ↓
              Merkle Tree (on-chain)
                    ↓
CLAIM:   Recipient generates ZK proof (knows preimage in tree)
                    ↓
         M31 Circle STARK Verifier (Solana program)
                    ↓
WITHDRAW: Funds released to fresh address (unlinkable)
```

## Why "Murkl"?

- **Mur**ky — your transfers are hidden
- Mer**kl**e — the cryptographic data structure at its core

## Components

- `circuits/` - STWO ZK circuits (Merkle membership + nullifier)
- `verifier/` - Solana program for M31 STARK verification  
- `contracts/` - Anchor programs for deposits/claims
- `cli/` - Rust CLI for proof generation
- `frontend/` - React app for UX

## Technical Stack

### M31 Field (Mersenne-31)
- p = 2³¹ - 1 = 2147483647
- Efficient 32-bit arithmetic
- Fast modular reduction: x mod p = (x & p) + (x >> 31)
- Perfect for Circle STARKs

### Circle STARKs
- Circle curve: x² + y² = 1 over M31
- Group order = p + 1 = 2³¹ (power of 2!)
- Enables efficient FFT without extension fields
- 1.4x faster than traditional STARKs

### ZK Circuit
- **Private inputs:** identifier, secret, Merkle path
- **Public inputs:** Merkle root, nullifier, recipient address
- **Constraint:** hash(identifier || secret) is in the Merkle tree
- **Nullifier:** hash(secret || leaf_index) — prevents double-claims

### On-Chain Verifier
- FRI (Fast Reed-Solomon IOP) verification
- M31 field operations in Solana BPF
- Optimized for ~1.4M compute unit budget

## Status

🚧 Under construction — Colosseum Agent Hackathon 2026

**Progress:**
- [x] M31 field implementation
- [x] Circle group operations
- [ ] Poseidon hash over M31
- [ ] Merkle tree
- [ ] ZK circuit (STWO)
- [ ] Solana verifier program
- [ ] Deposit/claim contracts
- [ ] CLI prover
- [ ] Frontend

## Links

- [Circle STARKs Paper](https://eprint.iacr.org/2024/278)
- [STWO Prover](https://github.com/starkware-libs/stwo)
