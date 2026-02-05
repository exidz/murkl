# 🐈‍⬛ Murkl

**Privacy-Preserving Payments on Solana — Real STARK Proofs, Venmo-Style UX**

> Send SOL to anyone using their Twitter handle, Discord username, or email — they claim with a password + zero-knowledge proof. The sender-recipient link is completely hidden on-chain.

**🔗 Try it now: [murkl-relayer-production.up.railway.app](https://murkl-relayer-production.up.railway.app)**

## 🚀 Status

| Component | Status | Notes |
|-----------|--------|-------|
| **STARK Verifier** | ✅ Deployed | `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw` |
| **Murkl Program** | ✅ Deployed | `muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF` |
| **Web App** | ✅ Live | Railway (auto-deploy) |
| **Deposit** | ✅ Working | SOL + WSOL, auto-wrapping |
| **WASM Prover** | ✅ Working | In-browser proof generation |
| **On-chain Verification** | ✅ Real | Full STARK verification, DEMO_MODE=false |
| **E2E Claim** | ✅ Verified | Multiple successful claims on devnet |
| **Multi-Provider Auth** | ✅ Working | Twitter/X, Discord, Email OTP |

> 🔒 **Real Verification:** The STARK verifier performs complete cryptographic verification — constraint checks, FRI folding, Merkle paths, and Fiat-Shamir. Not a demo.

### Devnet Addresses

| Component | Address |
|-----------|---------|
| **STARK Verifier** | [`StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw`](https://explorer.solana.com/address/StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw?cluster=devnet) |
| **Murkl Program** | [`muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF`](https://explorer.solana.com/address/muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF?cluster=devnet) |
| **WSOL Pool** | [`8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ`](https://explorer.solana.com/address/8MU3WQzxLDHi6Up2ksk255LWrRm17i7UQ6Hap4zeF3qJ?cluster=devnet) |
| **Relayer** | [`DhUG7vMJsx3GDAJ3RLmFhs5piwfSxN6zX34ABvUwgC3T`](https://explorer.solana.com/address/DhUG7vMJsx3GDAJ3RLmFhs5piwfSxN6zX34ABvUwgC3T?cluster=devnet) |

## 🏆 Key Innovation

**First Circle STARK verifier as a general-purpose CPI target on Solana.** Any program can verify zero-knowledge proofs by calling the verifier — no need to implement STARK math yourself.

| Feature | SNARKs (Groth16) | STARKs (Murkl) |
|---------|-------------------|----------------|
| Trusted Setup | ❌ Required | ✅ None |
| Post-Quantum | ❌ Vulnerable | ✅ Secure |
| Transparency | ❌ Hidden params | ✅ Fully transparent |
| Proof Size | ~200 bytes | ~8.7 KB |
| Compute Units | ~200k CU | ~31k CU |

## How It Works

```
SENDER                              RECIPIENT
──────                              ─────────
1. Connect wallet                   1. Sign in (Twitter/Discord/Email)
2. Pick recipient (@handle)         2. See pending deposits
3. Set password, send SOL           3. Enter password
4. Share password privately          4. STARK proof generated in browser
   (Signal, DM, etc.)               5. Proof verified on-chain → funds arrive!
```

**Privacy guarantees:**
- ✅ Identifier + password never appear on-chain
- ✅ Recipient wallet never signs the claim (relayer submits)
- ✅ STARK proof reveals nothing about which deposit you're claiming
- ✅ Namespaced identifiers prevent cross-provider impersonation

## Features

### Send Tab
- **Multi-provider recipients** — Twitter (`@handle`), Discord (`username`), Email (`user@example.com`)
- **SOL + WSOL support** — native SOL auto-wraps to WSOL for deposit
- **Claim links** — shareable links for easy recipient onboarding
- **Provider pills** — visual selection for recipient identity type

### Claim Tab
- **Social login** — Twitter/X OAuth, Discord OAuth, Email OTP (via Resend)
- **Multi-identity support** — users with multiple linked accounts can pick which to claim with
- **In-browser proving** — WASM prover generates STARK proofs client-side
- **Progress UI** — step-by-step proof generation and on-chain verification feedback
- **Deposit cards** — Venmo-style cards with status, amounts, and relative timestamps

### Security
- **Namespaced identifiers** — `twitter:@user`, `discord:user`, `email:user@x.com` prevent cross-provider impersonation
- **Email OTP verification** — email claims require proving ownership via one-time code
- **Server-side rate limiting** — OTP and claim endpoints rate-limited at Express middleware level
- **Helmet CSP** — Content Security Policy headers in production
- **Real STARK verification** — no demo mode, full cryptographic verification on-chain

## Architecture

```
┌──────────┐                    ┌──────────────────┐
│  Browser  │───── deposit ────►│  Murkl Program   │
│  (React)  │                   │  (Solana)        │
│           │                   └────────┬─────────┘
│  WASM     │                            │
│  Prover   │── proof ──►┌───────────────▼─────────┐
│           │            │  Relayer (Express)       │
└──────────┘             │  ├─ Better Auth (OAuth)  │
                         │  ├─ Proof upload          │
                         │  └─ Claim submission      │
                         └───────────────┬─────────┘
                                         │ CPI
                                ┌────────▼────────┐
                                │ STARK Verifier   │
                                │ (Solana)         │
                                └─────────────────┘
```

## 📦 SDK Components

| Component | Location | Description |
|-----------|----------|-------------|
| **murkl-prover** | [`crates/murkl-prover`](./crates/murkl-prover) | SIMD-optimized STARK prover (Rust) |
| **murkl-wasm** | [`wasm/`](./wasm) | Browser prover (73KB WASM) |
| **stark-verifier** | [`programs/stark-verifier`](./programs/stark-verifier) | On-chain STARK verifier — **CPI target for any program** |
| **murkl-program** | [`programs/murkl`](./programs/murkl) | Anonymous transfer pools |
| **murkl-sdk** | [`sdk/`](./sdk) | TypeScript SDK |
| **Web frontend** | [`web/`](./web) | React + Framer Motion UI |
| **Relayer** | [`relayer/`](./relayer) | Express API + Better Auth + static serving |

### Integrating the STARK Verifier (CPI)

Any Solana program can verify STARK proofs by calling the verifier:

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
| **Proof Size** | ~8.7 KB |
| **Compute Units** | ~31,000 per claim |
| **FRI Layers** | 3 |
| **Queries** | 4 |
| **Security** | 128-bit post-quantum |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **On-chain** | Rust (Anchor), Solana BPF |
| **Prover** | Rust + WASM (wasm-pack) |
| **Frontend** | React 19, Framer Motion, TanStack Query |
| **Auth** | Better Auth (Discord, Twitter/X, Email OTP) |
| **Email** | Resend (OTP + claim notifications) |
| **Backend** | Express, better-sqlite3, Helmet |
| **Deploy** | Railway (Docker), devnet |

## Building

```bash
# On-chain programs
anchor build

# WASM prover
cd wasm && wasm-pack build --target web --release
cp pkg/*.{js,wasm,ts} ../web/src/wasm/

# Web frontend
cd web && npm install && npm run build

# Relayer
cd relayer && npm install && npm run build

# Full stack (dev)
cd relayer && npm run dev  # API on :3001
cd web && npm run dev      # Frontend on :5173 (proxies API)
```

## Deployment

```bash
# Railway (production)
railway up

# Or Docker
docker build -t murkl .
docker run -p 3001:3001 --env-file .env murkl
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `RPC_URL` | Solana RPC endpoint |
| `RELAYER_SECRET_KEY` | Relayer keypair (JSON array) |
| `BETTER_AUTH_SECRET` | Auth session signing secret |
| `BETTER_AUTH_URL` | Public URL for OAuth callbacks |
| `TWITTER_CLIENT_ID` | Twitter/X OAuth client ID |
| `TWITTER_CLIENT_SECRET` | Twitter/X OAuth client secret |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |
| `RESEND_API_KEY` | Resend API key for email OTP |
| `EMAIL_FROM` | From address for emails |

## Testing

```bash
# Rust tests (185+ tests)
cargo test

# Web tests (50+ tests)
cd web && npm test

# E2E test (requires devnet)
cd relayer && npx tsx test-e2e.ts
```

## Research Background

Based on StarkWare's Circle STARK research:

- [Circle STARKs](https://eprint.iacr.org/2024/278) — Haböck, Levit, Papini (2024)
- [STWO Prover](https://github.com/starkware-libs/stwo) — Reference implementation
- [STARK Protocol](https://eprint.iacr.org/2018/046) — Ben-Sasson et al. (2018)

### Why M31?

```
p = 2³¹ - 1 = 2147483647

• FFT-friendly: p + 1 = 2³¹
• Native 32-bit arithmetic
• Efficient reduction: x mod p = (x & p) + (x >> 31)
```

## Security

- **Post-quantum secure** — all operations use keccak256 (hash-based, no elliptic curves)
- **No trusted setup** — STARKs are transparent
- **Domain separation** — commitments, identifiers, and nullifiers use distinct prefixes
- See [`SECURITY.md`](./SECURITY.md) for full details

## License

MIT

---

Built for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon) 🏛️

**Real STARK verification on Solana. Post-quantum secure. Zero trusted setup. Open source.**
