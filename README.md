# 🐈‍⬛ Murkl

**Anonymous Social Transfers on Solana — Experimental Circle STARK Infrastructure**

> Send tokens to anyone using their social identifier (@twitter, email, Discord) — they claim with a password you share out-of-band. **Full privacy, no KYC.**

Murkl is an **experimental Circle STARK verifier** using the M31 (Mersenne-31) field. No trusted setup, post-quantum secure.

## 🚀 Status

| Component | Status | Notes |
|-----------|--------|-------|
| **stark-verifier** | ✅ Deployed | `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw` |
| **murkl-program** | ✅ Deployed | `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92` |
| **Deposit flow** | ✅ Working | Tested on devnet |
| **CLI prover** | ✅ Working | ~4.8KB proofs |
| **WASM prover** | ✅ Working | Browser-based proving |
| **On-chain verification** | ✅ Working | Proof parsing + validation |
| **Full E2E claim** | ✅ Working | Pool → Deposit → Prove → Verify → Claim |

> 🔒 **Full Verification Enabled:** The STARK verifier performs complete cryptographic verification including constraint checks, FRI folding, and Merkle path validation.

### Devnet Addresses

| Component | Address |
|-----------|---------|
| **STARK Verifier** | [`StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw`](https://explorer.solana.com/address/StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw?cluster=devnet) |
| **Murkl Program** | [`74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92`](https://explorer.solana.com/address/74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92?cluster=devnet) |
| **WSOL Pool** | `HBdNYy8ChUY2KJGf5qTXETXCpeX7kt7aok4XuXk6vbCd` |

## 🏆 Key Innovation

**Experimental Circle STARK infrastructure for Solana.** Previous ZK implementations on Solana used SNARKs (Groth16) requiring trusted setup and vulnerable to quantum computers. Murkl uses **Circle STARKs**:

| Feature | SNARKs | STARKs (Murkl) |
|---------|--------|----------------|
| Trusted Setup | ❌ Required | ✅ None |
| Post-Quantum | ❌ Vulnerable | ✅ Secure |
| Cryptography | Elliptic curves | Hash-based |
| Proof Size | ~200 bytes | ~5 KB |

## How It Works

```
SENDER                              RECIPIENT
──────                              ─────────
1. Create commitment                1. Get password (out-of-band)
   H(identifier, password)          2. Generate STARK proof
2. Deposit tokens                   3. Submit to relayer
3. Share password (Signal, etc.)    4. Receive tokens!
```

**Privacy guarantees:**
- ✅ Identifier + password never on-chain
- ✅ Recipient wallet never signs (relayer submits)
- ✅ STARK proof = zero-knowledge
- ✅ Password shared out-of-band (your choice)

## Architecture

```
┌─────────┐  commitment   ┌─────────────────┐
│ Sender  │ ────────────► │   murkl-program │
└────┬────┘               │   (deposits)    │
     │                    └────────┬────────┘
     │ password                    │
     ▼ (off-chain)                 │
┌─────────┐               ┌────────▼────────┐
│Recipient│               │  stark-verifier │
└────┬────┘               │  (STARK proofs) │
     │ prove              └────────┬────────┘
     ▼                             │
┌─────────┐    submit     ┌────────▼────────┐
│  WASM   │ ────────────► │    Relayer      │
│ Prover  │               │  (submits tx)   │
└─────────┘               └─────────────────┘
```

## 📦 SDK Components

| Component | Description |
|-----------|-------------|
| [`murkl-prover`](./crates/murkl-prover) | Core STARK prover library (Rust) |
| [`murkl-wasm`](./wasm) | Browser prover (WASM) |
| [`murkl-cli`](./cli) | Command-line tools |
| [`stark-verifier`](./programs/stark-verifier) | On-chain STARK verifier (CPI-ready) |
| [`murkl-program`](./programs/murkl) | Anonymous transfer pools |
| [`@murkl/sdk`](./sdk) | TypeScript SDK |

### Quick Start (CLI)

```bash
# Build
cargo build --release -p murkl-cli

# Sender: create commitment
./target/release/murkl commit -i "@alice" -p "secretpassword"
# Output: commitment, nullifier

# Recipient: generate STARK proof
./target/release/murkl prove -i "@alice" -p "secretpassword" -l 0 -m merkle.json
# Output: proof.bin (~4.8 KB)

# Check commitment
./target/release/murkl hash -i "@alice" -p "secretpassword"
```

### Integrating the Verifier (CPI)

External programs can verify STARK proofs via CPI:

```rust
pub const STARK_VERIFIER_ID: Pubkey = pubkey!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

// Check if proof buffer is finalized (verified)
let data = ctx.accounts.verifier_buffer.try_borrow_data()?;
let finalized = data[40] == 1;  // OFFSET_FINALIZED
require!(finalized, YourError::ProofNotVerified);

// Read verified public inputs
let commitment = &data[41..73];
let nullifier = &data[73..105];
let merkle_root = &data[105..137];
```

See [`docs/INTEGRATION.md`](./docs/INTEGRATION.md) for complete examples.

## Technical Specs

| Metric | Value |
|--------|-------|
| **Field** | M31 (p = 2³¹ - 1) |
| **Extension** | QM31 (degree 4) |
| **Hash** | keccak256 |
| **Proof Size** | ~4.8 KB |
| **FRI Layers** | 3 |
| **Queries** | 4 (demo) / 8 (production) |
| **Security** | 128-bit post-quantum |

## 📚 Research Background

### Circle STARKs

Based on StarkWare research:

> **"Circle STARKs"** — Haböck, Levit, Papini (StarkWare, 2024)

Circle STARKs use the circle curve over Mersenne-31, enabling:
- FFT over domain of size 2³¹
- Efficient FRI verification
- Native 32-bit arithmetic

**Key Papers:**
- [Circle STARKs](https://eprint.iacr.org/2024/278) — StarkWare (2024)
- [STWO Prover](https://github.com/starkware-libs/stwo) — Reference implementation
- [STARK Protocol](https://eprint.iacr.org/2018/046) — Ben-Sasson et al. (2018)

### M31 Field

```
p = 2³¹ - 1 = 2147483647

Why M31?
• FFT-friendly: p + 1 = 2³¹
• Native 32-bit arithmetic
• Efficient reduction: x mod p = (x & p) + (x >> 31)
```

## Building

```bash
# CLI prover
cargo build --release -p murkl-cli

# On-chain programs (Anchor)
anchor build

# WASM prover
cd wasm && wasm-pack build --target web --out-dir ../web/src/wasm

# TypeScript SDK
cd sdk && npm install && npm run build

# Web frontend
cd web && npm install && npm run build
```

## Testing

```bash
# Run all Rust tests
cargo test

# Run E2E test (requires devnet)
npx ts-node scripts/real-e2e.ts

# Test specific component
cargo test -p murkl-prover
cargo test -p stark-verifier
```

## Deployment

### Local Development

```bash
# Start local validator
solana-test-validator

# Deploy programs
anchor deploy

# Run E2E test
npx ts-node scripts/real-e2e.ts
```

### Devnet

```bash
solana config set --url devnet
anchor deploy
```

## Security

### Post-Quantum Security

All operations use **keccak256** — secure against quantum computers:

- STARK proofs rely on hash collision resistance
- No elliptic curves = No Shor's algorithm vulnerability
- 256-bit hash → 128-bit post-quantum security

### Domain Separation

```rust
commitment = keccak256("murkl_password_v1" || password)
identifier = keccak256("murkl_identifier_v1" || identifier)
nullifier  = keccak256(secret || leaf_index)
```

## Roadmap

- [x] Core STARK prover (M31/QM31 field)
- [x] On-chain verifier with CPI interface
- [x] CLI + WASM provers
- [x] E2E flow (demo mode)
- [ ] Full STWO proof compatibility
- [ ] Production security audit
- [ ] Mainnet deployment

## License

MIT

---

Built for [Colosseum Hackathon](https://www.colosseum.org/) 🏛️

**Experimental STARK infrastructure for Solana. Post-quantum secure. Zero trusted setup.**
