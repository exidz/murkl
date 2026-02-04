# Murkl Status

**Last Updated:** 2026-02-05

## 🚀 Current State: E2E Working (Full Verification)

| Flow | Status |
|------|--------|
| Pool Creation | ✅ Working |
| Deposit | ✅ Working |
| WASM Proof Generation | ✅ Working |
| Proof Upload (Chunked) | ✅ Working |
| On-chain STARK Verification | ✅ Full Verification |
| Claim | ✅ Working |

## Programs (Devnet)

| Program | Address | Status |
|---------|---------|--------|
| **STARK Verifier** | `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw` | ✅ Deployed |
| **Murkl** | `muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF` | ✅ Deployed |

## Recent Successful Claims (Devnet)

| TX | Date |
|----|------|
| `31UTsBCUHtDaC4gYF7oFBiWcuvyXVP35YUQ2sfNeCBpYK9v7h4G664bQCdRe6egi5VafsJksapazbjwcmCHEnRYE` | Feb 5 |
| `EdoFH1kSVFj6FEMrAtQJx2jtBgzue2DCKmKX46RFAj2WX4xacF1yLHJEUQWmySeJW1meoxzQqsQT9iEt5k3gMop` | Feb 5 |
| `2fhvoGotvMvA1DnUXUBgG7Qe6cK7RKZwADkRf92KpgDmbpxYmiKZrgXKtxMtcrtZbj4c9CYCVfm3fSHP9k9MA27T` | Feb 5 |

## Components

| Component | Location | Status |
|-----------|----------|--------|
| Core Prover | `crates/murkl-prover` | ✅ 185 tests |
| CLI | `cli/` | ✅ Working |
| WASM | `wasm/` | ✅ Working (73KB) |
| SDK | `sdk/` | ✅ Complete |
| Web | `web/` | ✅ Working |
| Relayer | `relayer/` | ✅ Working |
| Verifier | `programs/stark-verifier` | ✅ Full Verification |
| Murkl | `programs/murkl` | ✅ Working |

## Test Commands

```bash
# E2E test via relayer
cd relayer && npx tsx test-e2e.ts

# Run Rust tests
cargo test

# Build WASM
cd wasm && wasm-pack build --target web --release

# Build programs
cd programs && cargo build-sbf
```

## Verification Status

🔒 **Full verification enabled** (`DEMO_MODE = false`):
- ✅ Constraint verification (AIR evaluation at OODS)
- ✅ Trace Merkle path verification
- ✅ Composition Merkle path verification  
- ✅ FRI Merkle path verification
- ✅ FRI folding verification
- ✅ Final polynomial evaluation
- ✅ Fiat-Shamir query index enforcement

## Proof Specs

| Metric | Value |
|--------|-------|
| Proof Size | ~8.7 KB |
| FRI Layers | 3 |
| Queries | 4 |
| Final Poly Degree | 1 (constant) |
| Compute Units | ~31,000 |

## Pool Info (Devnet)

| Pool | Address |
|------|---------|
| WSOL Pool | `8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ` |
| Vault | `HBdNYy8ChUY2KJGf5qTXETXCpeX7kt7aok4XuXk6vbCd` |
| Deposits | 22+ |

## Links

- [STARK Verifier on Explorer](https://explorer.solana.com/address/StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw?cluster=devnet)
- [Murkl Program on Explorer](https://explorer.solana.com/address/muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF?cluster=devnet)
- [Recent Claim TX](https://explorer.solana.com/tx/31UTsBCUHtDaC4gYF7oFBiWcuvyXVP35YUQ2sfNeCBpYK9v7h4G664bQCdRe6egi5VafsJksapazbjwcmCHEnRYE?cluster=devnet)
