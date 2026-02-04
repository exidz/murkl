# Murkl Status

**Last Updated:** 2026-02-04

## 🚀 Current State: E2E Working (Demo Mode)

| Flow | Status |
|------|--------|
| Pool Creation | ✅ Working |
| Deposit | ✅ Working |
| CLI Proof Generation | ✅ Working |
| Proof Upload | ✅ Working |
| On-chain Verification | ✅ Demo Mode |
| Claim | ✅ Working |

## Programs (Devnet)

| Program | Address | Status |
|---------|---------|--------|
| **STARK Verifier** | `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw` | ✅ Deployed |
| **Murkl** | `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92` | ✅ Deployed |

### Vanity Address Ready

- `muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF` - For Murkl program redeploy

## Components

| Component | Location | Status |
|-----------|----------|--------|
| Core Prover | `crates/murkl-prover` | ✅ 185 tests |
| CLI | `cli/` | ✅ Working |
| WASM | `wasm/` | ✅ Working |
| SDK | `sdk/` | ✅ Complete |
| Web | `web/` | ✅ Working |
| Verifier | `programs/stark-verifier` | ✅ Demo Mode |
| Murkl | `programs/murkl` | ✅ Working |

## Test Commands

```bash
# Full E2E test
npx ts-node scripts/real-e2e.ts

# Run Rust tests
cargo test

# Build CLI
cargo build --release -p murkl-cli

# Build programs
anchor build
```

## Demo Mode Warning

⚠️ The STARK verifier is in **demo mode** (`DEMO_MODE = true`):
- Skips constraint verification
- Skips Merkle path checks

For production, set `DEMO_MODE = false` and integrate proper STWO proofs.

## Proof Specs

| Metric | Value |
|--------|-------|
| Proof Size | ~4.8 KB |
| FRI Layers | 3 |
| Queries | 4 |
| Final Poly Degree | 2 |

## Links

- [Solana Explorer (Verifier)](https://explorer.solana.com/address/StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw?cluster=devnet)
- [Solana Explorer (Murkl)](https://explorer.solana.com/address/74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92?cluster=devnet)
