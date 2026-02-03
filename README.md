# 🐈‍⬛ Murkl

**Anonymous Social Transfers on Solana via Circle STARKs**

Send tokens to anyone using their social identifier (email, @twitter, Discord) — they claim with a password you share out-of-band. Full privacy, no KYC.

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

## Cryptography

- **Field**: M31 (Mersenne-31, p = 2³¹ - 1)
- **STARK**: Circle STARKs over M31 for efficient FRI
- **Hash**: Custom M31-native hash for commitment/nullifier
- **Merkle**: keccak256 via Solana syscall (~100 CU/hash)
- **Proof size**: ~6 KB
- **Verification**: ~11K compute units on-chain

## Program

- **ID**: `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92`
- **Size**: ~320 KB (includes full STARK verifier)
- **Relayer fee**: Max 1% (configurable)

## Instructions

### `initialize_pool`
Create a new Murkl pool for a token.

### `deposit`
Deposit tokens with a commitment.
- `commitment = hash(identifier, hash(password))`

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
```

## License

MIT

---

Built for [Colosseum Hackathon](https://www.colosseum.org/) 🏛️
