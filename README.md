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
- [x] M31 field implementation (circuits/m31.rs)
- [x] Circle group operations (circuits/circle.rs)
- [x] Poseidon hash over M31 (circuits/poseidon.rs)
- [x] Merkle tree (circuits/merkle.rs)
- [x] ZK circuit with STWO integration (circuits/stark_circuit.rs, prover.rs)
- [x] **End-to-end proof generation & verification working!** 🎉
- [ ] Solana verifier program
- [ ] Deposit/claim contracts
- [ ] CLI prover
- [ ] Frontend

### Test Results
```
running 26 tests
test circle::tests::test_double_equals_add ... ok
test circle::tests::test_generator_on_circle ... ok
test circle::tests::test_group_identity ... ok
test m31::tests::test_basic_arithmetic ... ok
test m31::tests::test_inverse ... ok
test poseidon::tests::test_hash_deterministic ... ok
test merkle::tests::test_merkle_path_verification ... ok
test stark_circuit::tests::test_claim_consistency ... ok
test prover::tests::test_full_proof_generation_and_verification ... ok
... (26 total)

test result: ok. 26 passed; 0 failed
```

## Building

```bash
# Requires Rust nightly-2025-07-14 for STWO compatibility
rustup install nightly-2025-07-14
rustup default nightly-2025-07-14

cargo build
cargo test
```

## Links & Research

- [Circle STARKs Paper (PDF)](https://eprint.iacr.org/2024/278.pdf)
- [STWO Prover GitHub](https://github.com/starkware-libs/stwo)
- [STWO Blog Announcement](https://starkware.co/blog/stwo-prover-the-next-gen-of-stark-scaling-is-here/)

### Key Insight
Classical STARKs require p-1 divisible by 2^k. M31 has p-1 = 2(2³⁰-1) which fails this.
But M31 has **p+1 = 2³¹** — Circle STARKs use the circle curve x²+y²=1 to provide FFT/FRI structure when p+1 is a power of 2.

## License

MIT
