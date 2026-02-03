# Murkl STARK SDK — Integration Infrastructure

## Vision

Make Murkl the **STARK primitive layer** for Solana. Other projects call our verifier via CPI instead of building their own.

## Components

### 1. `murkl-prover` (Rust Crate)
SIMD-optimized STARK prover for Circle STARKs over M31.

```
murkl-prover/
├── src/
│   ├── lib.rs           # Public API
│   ├── m31.rs           # M31 field with SIMD
│   ├── circle.rs        # Circle group operations
│   ├── merkle.rs        # Merkle tree (keccak256)
│   ├── fri.rs           # FRI protocol
│   ├── air.rs           # AIR constraints
│   ├── prover.rs        # Proof generation
│   └── types.rs         # Proof structs
├── benches/             # Performance benchmarks
├── tests/               # Comprehensive tests
└── Cargo.toml
```

Features:
- `simd` — SIMD acceleration (default)
- `wasm` — WASM target support
- `no_std` — Embedded/constrained environments

### 2. `murkl-verifier` (On-chain Program)
Solana program that verifies STARK proofs via CPI.

```rust
// Other programs call this:
pub fn verify_stark_proof(
    ctx: Context<VerifyProof>,
    proof: &[u8],
    public_inputs: &[u8],
) -> Result<bool>
```

CPI Interface:
```rust
// In your program:
murkl_verifier::cpi::verify(
    cpi_ctx,
    proof_buffer,
    public_inputs,
)?;
```

### 3. `murkl-sdk` (TypeScript)
Client-side SDK for proof generation and submission.

```typescript
import { MurklProver, submitProof } from '@murkl/sdk';

const prover = new MurklProver();
const proof = await prover.prove(witness, publicInputs);
await submitProof(connection, proof, programId);
```

### 4. `murkl-circuits` (Rust Crate)
Pre-built circuits for common use cases:

- `TransferCircuit` — Private transfers (our current use case)
- `MembershipCircuit` — Merkle membership proofs
- `RangeCircuit` — Range proofs (amount > 0, amount < max)
- `HashPreimageCircuit` — Hash preimage proofs

## Test Matrix

### Unit Tests
| Component | Test | Status |
|-----------|------|--------|
| M31 | Field arithmetic (add, mul, inv) | ⬜ |
| M31 | SIMD vs scalar equivalence | ⬜ |
| Circle | Point operations | ⬜ |
| Circle | Generator powers | ⬜ |
| Merkle | Tree construction | ⬜ |
| Merkle | Proof verification | ⬜ |
| FRI | Commitment | ⬜ |
| FRI | Query responses | ⬜ |
| Prover | Proof generation | ⬜ |
| Verifier | Proof verification | ⬜ |

### Integration Tests
| Test | Description | Status |
|------|-------------|--------|
| E2E Transfer | Deposit → Prove → Claim | ⬜ |
| CPI Verify | External program calls verifier | ⬜ |
| Chunked Upload | Large proof upload flow | ⬜ |
| Invalid Proof | Verifier rejects bad proofs | ⬜ |
| Edge: Empty Witness | Zero inputs | ⬜ |
| Edge: Max Size | Maximum proof size | ⬜ |
| Edge: Malformed | Corrupted proof bytes | ⬜ |

### Devnet Tests
| Test | Description | Status |
|------|-------------|--------|
| Deploy Program | Verifier deploys cleanly | ✅ |
| Create Pool | Pool initialization | ✅ |
| Deposit | Token deposit | ✅ |
| Claim | Full claim flow | ✅ |
| CPI Integration | External program test | ⬜ |

## Dogfooding

**Our own Murkl transfer app uses the SDK.** We're not just building infra for others — we're the first integration.

```
murkl-app (our transfer demo)
    └── uses murkl-prover (Rust/WASM)
    └── uses murkl-verifier (on-chain CPI)
    └── uses murkl-circuits::TransferCircuit
```

This proves the SDK works and serves as a reference implementation.

## Documentation Structure

```
docs/
├── README.md              # Overview & quick start
├── ARCHITECTURE.md        # Technical deep-dive
├── INTEGRATION.md         # How to integrate
├── API.md                 # Full API reference
├── CIRCUITS.md            # Pre-built circuits
├── SECURITY.md            # Security model & assumptions
└── examples/
    ├── private-transfer/  # Our Murkl app (dogfood!)
    ├── private-voting/    # Example: anonymous voting
    └── private-auction/   # Example: sealed-bid auction
```

## Milestones

### Phase 1: Extract & Package (Day 2-3)
- [ ] Extract prover into standalone crate
- [ ] Add SIMD optimizations
- [ ] Write unit tests (100% coverage on crypto)
- [ ] Benchmark prover performance
- [ ] **Wire up Murkl app to use new prover crate**
- [ ] Update WASM build to use murkl-prover
- [ ] Update CLI to use murkl-prover

### Phase 2: CPI Interface (Day 3-4)
- [ ] Refactor verifier for CPI calls
- [ ] Create integration test program
- [ ] Test CPI flow on devnet
- [ ] Document CPI interface

### Phase 3: SDK & Docs (Day 4-5)
- [ ] TypeScript SDK package
- [ ] Comprehensive documentation
- [ ] Example integrations
- [ ] npm publish

### Phase 4: Outreach (Day 5+)
- [ ] Contact hackathon projects
- [ ] Help first integrator
- [ ] Collect feedback
- [ ] Iterate

## Success Metrics

1. **At least 1 external project integrates** before hackathon ends
2. **Full test coverage** on cryptographic components
3. **<100ms proof generation** in browser
4. **<50K CU verification** on-chain
5. **Clear docs** — new dev can integrate in <1 hour
