# Changelog

All notable changes to Murkl.

## [0.4.0] - 2026-02-05

### 🚀 Live Deployment + Multi-Provider Auth

**Murkl is publicly accessible:** https://murkl-relayer-production.up.railway.app

### Added

- **Railway deployment** — Dockerfile, railway.toml, .dockerignore for production deploy
- **Twitter/X OAuth** — Social login via Better Auth
- **Discord OAuth** — Social login via Better Auth
- **Email OTP** — Login via one-time code (Resend integration, `email.siklab.dev`)
- **Multi-identity support** — Users with multiple linked providers can pick which identity to claim with
- **Identity picker UI** — When multiple accounts are linked, shows selectable list
- **Claim notification emails** — Deposits to `email:` identifiers trigger styled notification emails
- **TanStack Query** — `useDeposits`, `usePoolInfo`, `useTokenBalance`, `useRegisterDeposit` hooks
- **Venmo-style deposit cards** — Token-aware icons, unclaimed glow, relative timestamps, staggered animations
- **Custom OTP input** — Segmented 6-digit input (replaced HeroUI dependency)
- **Custom TokenSelector** — Segmented control with framer-motion layoutId animation
- **SOL/WSOL deposit support** — Native SOL auto-wraps to WSOL
- **Claim links** — Shareable URLs for easy recipient onboarding
- **Provider pills** — Visual selection for recipient identity type (Twitter, Discord, Email)
- **Baseline UI** — Global typography, animation, and accessibility baseline
- **Vite dev proxy** — All API routes proxy to relayer, eliminating CORS in development
- **Auto-migrate auth DB** — Better Auth tables created on startup if missing
- **Block height retry** — Polls signature status when devnet confirmation times out

### Fixed

- **CSP headers** — Allow Google Fonts, WebSocket to devnet, OAuth provider avatars
- **SOL rent reserve** — Max deposit now reserves 0.005 SOL for rent + fees
- **CORS origins** — Added localhost:5173/5174 to default origins
- **leafIndex validation** — Fixed `!leafIndex === undefined` → proper null check
- **Email login bug** — Email OTP verify calls onLogin directly, preventing wrong identity detection
- **Identity header overflow** — Handle text truncated with ellipsis
- **Switch account loop** — Single-identity users can now switch without auto-login loop
- **Wallet auto-connect** — Enabled `autoConnect` in WalletProvider

### Changed

- **Namespaced identifiers** — `provider:handle` format (e.g., `twitter:@user`, `discord:user`, `email:user@x.com`)
- **No HeroUI components** — Custom CSS components throughout (no Tailwind dependency)
- **WASM in git** — Pre-built WASM tracked in repo for Docker builds
- **`RELAYER_URL` empty** — Same-origin serving in production, Vite proxy in dev

## [0.3.0] - 2026-02-05

### 🔒 Full STARK Verification Enabled

**Real cryptographic verification working on devnet!**

### Fixed

- **FRI Merkle path double-hash bug** — Verifier hashed QM31 leaf values twice
- **WASM FRI tree leaf hashing** — Now hashes 32-byte padded values to match verifier
- **Trace Merkle tree leaf hashing** — Tree hashes leaves internally

### Changed

- `DEMO_MODE = false` — Full verification enabled
- Proof size: ~8.7 KB
- Compute units: ~31,000 CU per claim

### Security

✅ Full verification: constraint checks, Merkle paths, FRI folding, Fiat-Shamir

## [0.2.0] - 2026-02-04

### 🎉 E2E Flow Complete

Full end-to-end flow working on devnet.

### Added

- Demo mode for verifier
- Vanity address: `muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF`
- E2E test scripts

### Fixed

- Proof serialization format
- Account ordering in InitializePool
- Borsh Vec serialization

## [0.1.0] - 2026-02-03

### Added

- Circle STARK verifier (M31/QM31)
- Murkl anonymous transfer pools
- CLI + WASM provers
- TypeScript SDK
- Web frontend

---

Built for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon) 🏛️
