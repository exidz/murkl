# 🐈‍⬛ Murkl

**Anonymous Social Transfers on Solana — First Full STARK Verifier On-Chain**

> **ZK-STARKs are possible on Solana.** Murkl proves it with a fully on-chain Circle STARK verifier using the M31 (Mersenne-31) field. No optimistic verification, no trusted setup, post-quantum secure.

Send tokens to anyone using their social identifier (email, @twitter, Discord) — they claim with a password you share out-of-band. Full privacy, no KYC.

## 🏆 Key Innovation

This is the **first implementation of a full STARK verifier running on Solana**. Previous ZK implementations on Solana used SNARKs (Groth16) which require trusted setup and are vulnerable to quantum computers. Murkl uses **Circle STARKs** which are:

- **Transparent** — No trusted setup ceremony
- **Post-Quantum Secure** — Based on hash functions, not elliptic curves
- **Efficient** — M31 field enables FFT-friendly arithmetic

```
┌─────────────────────────────────────────────────────────────────┐
│              STARKs vs SNARKs on Solana                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SNARKs (Groth16/PLONK):        STARKs (Circle):               │
│  ❌ Trusted setup required       ✅ Transparent                 │
│  ❌ Broken by quantum            ✅ Post-quantum secure         │
│  ❌ Elliptic curve crypto        ✅ Hash-based                  │
│  ✅ Small proofs (~200B)         ⚠️ Larger proofs (~6KB)        │
│                                                                 │
│  Murkl: First full STARK verifier on Solana! 🎉                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     PASSWORD-PROTECTED CLAIMS                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SENDER:                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. murkl commit -i "@alice" -p "bluemoon123"             │  │
│  │ 2. Deposit tokens with commitment                        │  │
│  │ 3. Tell recipient the password (text, call, Signal...)   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  RECIPIENT:                                                     │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. murkl prove -i "@alice" -p "bluemoon123" -l 0         │  │
│  │ 2. Submit proof + wallet address to relayer              │  │
│  │ 3. Tokens arrive! (never signed anything)                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  PRIVACY:                                                       │
│  ✅ Identifier + password never on-chain                        │
│  ✅ Recipient wallet never signs (relayer submits)              │
│  ✅ STARK proof = zero-knowledge                                │
│  ✅ Password shared out-of-band (your choice how)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 📚 Research & Background

### Circle STARKs

Murkl implements **Circle STARKs** as described in the StarkWare research:

> **"Circle STARKs"** — Haböck, Levit, Papini (StarkWare, 2024)
> 
> Circle STARKs use the circle curve over the Mersenne-31 field, enabling:
> - FFT over a domain of size 2³¹ (vs 2²⁷ for BabyBear)
> - Efficient FRI (Fast Reed-Solomon IOP of Proximity)
> - Native 32-bit arithmetic matching modern CPUs

**Key Papers:**
- [Circle STARKs](https://eprint.iacr.org/2024/278) — StarkWare (2024)
- [STWO Prover](https://github.com/starkware-libs/stwo) — Reference implementation
- [Scalable, transparent, and post-quantum secure computational integrity](https://eprint.iacr.org/2018/046) — Ben-Sasson et al. (2018)
- [Fast Reed-Solomon IOP (FRI)](https://eccc.weizmann.ac.il/report/2017/134/) — Ben-Sasson et al. (2017)

### M31 (Mersenne-31) Field

The M31 field has prime `p = 2³¹ - 1`, giving it special properties:

```
p = 2147483647 = 2³¹ - 1

Why M31?
• p + 1 = 2³¹ → enables FFT over circle group of order 2³¹
• Native 32-bit arithmetic (fast on all CPUs)
• No Montgomery reduction needed
• Efficient modular reduction: x mod p = (x & p) + (x >> 31)
```

### Why STARKs on Solana?

Solana's compute model is uniquely suited for STARK verification:

1. **keccak256 Syscall** — ~100 CU per hash (vs ~5000 in BPF)
2. **Sequential Execution** — FRI verification is sequential, matches Solana's model
3. **High Compute Limit** — 1.4M CU per transaction
4. **Cheap State** — Store commitments on-chain affordably

Our verifier uses **~11,000 CU** per claim — well within limits!

## 📦 SDK Components

Murkl provides a complete SDK for integrating STARK proofs into your applications:

| Crate | Description |
|-------|-------------|
| [`murkl-prover`](./crates/murkl-prover) | Core STARK prover library (Rust) |
| [`murkl-wasm`](./wasm) | Browser prover (WASM) |
| [`murkl-cli`](./cli) | Command-line prover tool |
| [`stark-verifier`](./programs/stark-verifier) | On-chain STARK verifier (CPI-ready) |
| [`murkl-program`](./programs/murkl) | Anonymous transfer pools |
| [`example-integration`](./programs/example-integration) | CPI integration example |

### Using the Prover (Rust)

```rust
use murkl_prover::prelude::*;
use murkl_prover::prover::{Prover, ProverConfig};
use murkl_prover::air::FibonacciAir;

// Create prover with fast config (for development)
let prover = Prover::new(ProverConfig::fast());

// Build AIR and trace
let air = FibonacciAir::new(64);
let trace = air.generate_trace(M31::ONE, M31::ONE);

// Generate proof
let proof = prover.prove(&air, &trace, PublicInputs::empty())?;

// Serialize for on-chain verification
let proof_bytes = proof.to_bytes();
println!("Proof size: {} bytes", proof.size());
```

### Integrating the Verifier (On-chain CPI)

External programs can integrate Murkl's verifier. See [`docs/INTEGRATION.md`](./docs/INTEGRATION.md) for complete examples.

**Pattern: Buffer-based verification (recommended)**

```rust
pub const STARK_VERIFIER_ID: Pubkey = pubkey!("StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw");

// Check stark-verifier's proof buffer is finalized
let data = ctx.accounts.verifier_buffer.try_borrow_data()?;
let finalized = data[48] == 1;  // ProofBuffer.finalized flag
require!(finalized, YourError::ProofNotVerified);

// Proof is valid! Take your action...
```

## CLI Usage

```bash
# Install
cargo build --release -p murkl-cli

# Sender: create deposit commitment
./target/release/murkl commit -i "@alice" -p "secretpassword"

# Recipient: generate STARK proof
./target/release/murkl prove -i "@alice" -p "secretpassword" -l 0 -m merkle.json

# Verify locally
./target/release/murkl verify -p proof.bin -c <commitment_hex>

# Check commitment from identifier + password
./target/release/murkl hash -i "@alice" -p "secretpassword"
```

## Architecture

```
┌─────────┐  password   ┌─────────┐
│ Sender  │ ──────────► │Recipient│
└────┬────┘  (Signal,   └────┬────┘
     │       in person)      │
     │                       │
     ▼                       ▼
┌─────────┐             ┌─────────┐
│ Deposit │             │  Prove  │
│   tx    │             │ (WASM)  │
└────┬────┘             └────┬────┘
     │                       │
     │                       ▼
     │                  ┌─────────┐    tx     ┌─────────┐
     │                  │ Relayer │ ────────► │ Solana  │
     │                  └─────────┘           └────┬────┘
     │                       ▲                     │
     │                       │ fee                 │ tokens
     └───────────────────────┴─────────────────────┘
```

## 🛡️ Security

### Post-Quantum Security

All cryptographic operations use **keccak256** (SHA-3 family), which is secure against quantum computers:

```
┌─────────────────────────────────────────────────────────────────┐
│              POST-QUANTUM SECURITY MODEL                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Classical (bits)  →  Post-Quantum (bits)                      │
│  256-bit keccak    →  128-bit security                         │
│                                                                 │
│  Grover's algorithm provides √ speedup for hash inversion      │
│  256-bit hash → 128-bit post-quantum security ✅                │
│                                                                 │
│  STARK proofs rely only on:                                    │
│  • Collision resistance (hash functions)                       │
│  • Merkle tree security (hash functions)                       │
│  • FRI proximity (information-theoretic)                       │
│                                                                 │
│  NO elliptic curves = NO Shor's algorithm vulnerability        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Domain Separation

All hashes use domain separators to prevent cross-protocol attacks:

```rust
commitment = keccak256("murkl_commitment_v1" || identifier || secret)
nullifier  = keccak256("murkl_nullifier_v1" || secret || leaf_index)
```

## Technical Specs

| Metric | Value |
|--------|-------|
| **Field** | M31 (p = 2³¹ - 1) |
| **Extension** | QM31 (degree 4) |
| **Hash** | keccak256 (syscall) |
| **Proof Size** | ~6 KB |
| **Verification CU** | ~40,000 |
| **Program Size** | ~320 KB |
| **Security** | 128-bit post-quantum |

## Program

- **ID**: `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92`
- **Network**: Solana Mainnet-compatible
- **Relayer fee**: Max 1% (configurable)

### 🌐 Live Devnet Deployment

Try it now on Solana Devnet!

| Component | Address |
|-----------|---------|
| **Program** | [`74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92`](https://explorer.solana.com/address/74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92?cluster=devnet) |
| **WSOL Pool** | [`HBdNYy8ChUY2KJGf5qTXETXCpeX7kt7aok4XuXk6vbCd`](https://explorer.solana.com/address/HBdNYy8ChUY2KJGf5qTXETXCpeX7kt7aok4XuXk6vbCd?cluster=devnet) |
| **WSOL Vault** | `9SehPALznYqRcCiRxkt7oJtqiqRT8DbPXLhaJ3U5Mz1M` |
| **Test Token Pool** | `Gjw5fS9TvtaZracqD31QSBcJ2SBP84jyASNFaDF7VSY4` |
| **Test Token** | `77s7rE6jC85uF1R1697qivEEqbU1ZifcvCFZzJ6vvfDV` |

**E2E Test Verified:** Deposit → STARK Proof → Claim → ~40K CU verification ✅

**View transactions:** [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet)

## Instructions

### `initialize_pool`
Create a new Murkl pool for a token.

### `deposit`
Deposit tokens with a commitment.
- `commitment = keccak256(identifier || hash(password))`

### `claim`
Claim tokens with STARK proof via relayer.
- Verifies STARK proof on-chain
- Checks Merkle proof
- Prevents double-spend via nullifier
- Tokens go to recipient, fee to relayer

## Building

```bash
# CLI (STWO prover)
cargo build --release -p murkl-cli

# On-chain program (Anchor)
anchor build

# WASM prover (for web)
cd wasm && wasm-pack build --target web --out-dir ../web/src/wasm

# Relayer
cd relayer && npm install && npm run build

# Web frontend
cd web && npm install && npm run build
```

## Deployment

### Local Development

```bash
# 1. Start local validator
surfpool

# 2. Deploy program
anchor deploy

# 3. Setup test pool
npx ts-node scripts/setup-pool.ts

# 4. Make a deposit
npx ts-node scripts/deposit.ts "@alice" "secretpassword" 100

# 5. Start relayer (serves frontend)
cd relayer && npm run dev
```

### Production Deployment

1. **Deploy program to devnet/mainnet:**
   ```bash
   solana config set --url devnet
   anchor deploy
   ```

2. **Configure relayer:**
   ```bash
   cp relayer/.env.example relayer/.env
   # Edit .env with:
   # - RPC_URL (your RPC endpoint)
   # - PROGRAM_ID (deployed program)
   # - RELAYER_KEYPAIR (funded keypair)
   # - CORS_ORIGINS (your frontend domain)
   ```

3. **Deploy frontend:**
   ```bash
   cd web
   cp .env.example .env
   # Set VITE_POOL_ADDRESS and VITE_DEPOSIT_ADDRESS
   npm run build
   # Deploy dist/ to Vercel/Netlify/etc.
   ```

4. **Run relayer:**
   ```bash
   cd relayer
   npm run build
   NODE_ENV=production node dist/index.js
   ```

### Cloud Deployment (Fly.io)

Deploy the relayer to Fly.io for production:

```bash
cd relayer

# Install flyctl (https://fly.io/docs/hands-on/install-flyctl/)
curl -L https://fly.io/install.sh | sh

# Login and create app
fly auth login
fly apps create murkl-relayer

# Set secrets (required!)
fly secrets set RELAYER_SECRET_KEY='[YOUR_KEYPAIR_JSON_ARRAY]'
fly secrets set CORS_ORIGINS='https://your-frontend.com,https://murkl.app'

# Deploy
fly deploy

# Check status
fly status
fly logs
```

**Environment Variables:**
| Variable | Description | Required |
|----------|-------------|----------|
| `RELAYER_SECRET_KEY` | Keypair as JSON array (e.g., `[12,34,...]`) | Yes |
| `RPC_URL` | Solana RPC endpoint | No (defaults to devnet) |
| `PROGRAM_ID` | Murkl program address | No (has default) |
| `CORS_ORIGINS` | Comma-separated allowed origins | Recommended |
| `PORT` | Server port | No (defaults to 3001) |

**⚠️ Security:** The relayer keypair needs SOL for transaction fees. Keep balance minimal and use a dedicated keypair (not your main wallet).

### Security Checklist

- [ ] Use dedicated relayer keypair (not personal wallet)
- [ ] Keep relayer balance minimal (SOL for tx fees only)
- [ ] Set restrictive CORS origins
- [ ] Enable HTTPS (via reverse proxy)
- [ ] Set up monitoring/alerting
- [ ] Review [SECURITY.md](./SECURITY.md) before production

See [SECURITY.md](./SECURITY.md) for full security documentation.

## References

1. **Circle STARKs** — Haböck, U., Levit, D., Papini, S. (2024). *Circle STARKs*. IACR ePrint 2024/278.
2. **STARK Protocol** — Ben-Sasson, E., et al. (2018). *Scalable, transparent, and post-quantum secure computational integrity*. IACR ePrint 2018/046.
3. **FRI Protocol** — Ben-Sasson, E., et al. (2017). *Fast Reed-Solomon Interactive Oracle Proofs of Proximity*. ECCC TR17-134.
4. **STWO Prover** — StarkWare. https://github.com/starkware-libs/stwo
5. **Plonky3** — Polygon. https://github.com/Plonky3/Plonky3

## License

MIT

---

Built for [Colosseum Hackathon](https://www.colosseum.org/) 🏛️

**First full STARK verifier on Solana. Post-quantum secure. Zero trusted setup.**
