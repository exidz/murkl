# Murkl Status

**Last Updated:** 2026-02-05

## 🚀 Live Demo

**https://murkl-relayer-production.up.railway.app**

## Current State: Production-Ready on Devnet

| Flow | Status |
|------|--------|
| Pool Creation | ✅ Working |
| SOL/WSOL Deposit | ✅ Working (auto-wrap) |
| WASM Proof Generation | ✅ Working (in-browser) |
| Proof Upload (Chunked) | ✅ Working |
| On-chain STARK Verification | ✅ Full Verification (DEMO_MODE=false) |
| Claim via Relayer | ✅ Working |
| Twitter/X OAuth Login | ✅ Working |
| Discord OAuth Login | ✅ Working |
| Email OTP Login | ✅ Working (via Resend) |
| Multi-Identity Picker | ✅ Working |
| Claim Link Sharing | ✅ Working |
| Claim Notification Emails | ✅ Working |
| Railway Deployment | ✅ Live |

## Programs (Devnet)

| Program | Address | Status |
|---------|---------|--------|
| **STARK Verifier** | `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw` | ✅ Deployed |
| **Murkl** | `muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF` | ✅ Deployed |
| **Relayer** | `DhUG7vMJsx3GDAJ3RLmFhs5piwfSxN6zX34ABvUwgC3T` | ✅ Running (~2.8 SOL) |
| **WSOL Pool** | `8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ` | ✅ 29+ deposits |

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
| Field | M31 (p = 2³¹ - 1) |
| Extension | QM31 (degree 4) |

## Auth Providers

| Provider | Method | Status |
|----------|--------|--------|
| Twitter/X | OAuth 2.0 | ✅ |
| Discord | OAuth 2.0 | ✅ |
| Email | OTP (Resend) | ✅ |

Identifiers use namespaced format: `twitter:@handle`, `discord:username`, `email:user@example.com`

## Components

| Component | Location | Status | Notes |
|-----------|----------|--------|-------|
| Core Prover | `crates/murkl-prover` | ✅ 185+ tests | SIMD-optimized |
| WASM Prover | `wasm/` | ✅ 73KB | Browser-ready |
| STARK Verifier | `programs/stark-verifier` | ✅ Full verification | CPI target |
| Murkl Program | `programs/murkl` | ✅ Vanity address | Deposit/claim pools |
| Web Frontend | `web/` | ✅ 50+ tests | React 19, TanStack Query |
| Relayer | `relayer/` | ✅ Railway | Express + Better Auth |
| SDK | `sdk/` | ✅ | TypeScript |
| CLI | `cli/` | ✅ | Rust |

## Deployment

| Service | Platform | URL |
|---------|----------|-----|
| Frontend + API | Railway | https://murkl-relayer-production.up.railway.app |
| Email | Resend | `noreply@email.siklab.dev` |
| Source | GitHub | https://github.com/exidz/murkl |

## Recent Successful Claims (Devnet)

| TX | Date |
|----|------|
| `31UTsBCUHtDaC...` | Feb 5 |
| `EdoFH1kSVFj6F...` | Feb 5 |
| `2fhvoGotvMvA1...` | Feb 5 |

[Full list on Solana Explorer](https://explorer.solana.com/address/8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ?cluster=devnet)

## Dev Commands

```bash
# Full stack dev
cd relayer && npm run dev    # API on :3001
cd web && npm run dev        # Frontend on :5173 (proxies to :3001)

# Deploy to Railway
railway up

# Build WASM (after prover changes)
cd wasm && wasm-pack build --target web --release
cp pkg/*.{js,wasm,ts} ../web/src/wasm/

# Tests
cargo test                   # Rust (185+ tests)
cd web && npm test           # Frontend (50+ tests)
cd relayer && npx tsx test-e2e.ts  # E2E
```

## Colosseum Hackathon

- **Project:** #66
- **Agent:** sable (#122)
- **Deadline:** Feb 12, 2026
- **Tags:** privacy, payments, infra
