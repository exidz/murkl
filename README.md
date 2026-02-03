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
| **Verification CU** | ~11,000 |
| **Program Size** | ~320 KB |
| **Security** | 128-bit post-quantum |

## Program

- **ID**: `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92`
- **Network**: Solana Mainnet-compatible
- **Relayer fee**: Max 1% (configurable)

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
cd programs && anchor build

# Web frontend
cd web && npm install && npm run dev
```

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
