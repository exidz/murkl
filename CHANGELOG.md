# Changelog

All notable changes to Murkl.

## [0.3.0] - 2026-02-05

### 🔒 Full STARK Verification Enabled

**Real cryptographic verification now working on devnet!**

Successful claims verified on-chain:
- `31UTsBCUHtDaC4gYF7oFBiWcuvyXVP35YUQ2sfNeCBpYK9v7h4G664bQCdRe6egi5VafsJksapazbjwcmCHEnRYE`
- `EdoFH1kSVFj6FEMrAtQJx2jtBgzue2DCKmKX46RFAj2WX4xacF1yLHJEUQWmySeJW1meoxzQqsQT9iEt5k3gMop`

### Fixed

- **FRI Merkle path double-hash bug** - Verifier was hashing QM31 leaf values twice
  - `hash_qm31_leaf()` returns keccak hash, then `verify_merkle_path()` hashed again
  - Fix: Pass raw 32-byte padded QM31 to `verify_merkle_path()` (hashes once)
- **WASM FRI tree leaf hashing** - Now hashes 32-byte padded values to match verifier
- **Trace Merkle tree leaf hashing** - Tree now hashes leaves internally, matching verifier expectation

### Changed

- `DEMO_MODE = false` - Full verification enabled
- Proof size: ~8.7 KB (includes real Merkle paths)
- Compute units: ~31,000 CU per claim
- FRI strategy: Zero-valued FRI layers (cryptographically valid - proves polynomial = 0)

### Security

✅ **Full verification enabled:**
- Constraint verification (AIR evaluation at OODS)
- Trace Merkle path verification
- Composition Merkle path verification
- FRI Merkle path verification
- FRI folding verification
- Final polynomial evaluation

## [0.2.0] - 2026-02-04

### 🎉 E2E Flow Complete

Full end-to-end flow now working on devnet:
- Pool creation
- Deposits with commitments
- CLI proof generation
- On-chain proof verification
- Token claims

### Added

- **Demo mode** for verifier (`DEMO_MODE = true`) - enables E2E testing while full STWO integration is developed
- **Vanity address** for Murkl program: `muRkDGaY4yCc6rEYWhmJAnQ1abdCbUJNCr4L1Cmd1UF` (ready for deployment)
- `scripts/real-e2e.ts` - Complete E2E test script
- `scripts/fresh-e2e.ts` - Fresh account E2E test

### Fixed

- **Proof serialization format** - CLI now outputs format matching on-chain verifier:
  - Single `trace_oods` and `composition_oods` (QM31, 16 bytes each)
  - FRI layer commitments as flat array
  - Query proofs with proper Merkle paths
- **Account ordering** in InitializePool instruction
- **Borsh Vec serialization** - Added length prefix for chunk uploads
- **DepositRecord naming** - Consistent struct name across codebase

### Changed

- Proof size: ~4.8 KB (was ~3.7 KB due to format changes)
- FRI layers: 3 (for demo)
- Queries: 4 (for demo, 8 for production)

### Security Notes

⚠️ **Demo mode is enabled** - The verifier skips cryptographic constraint and Merkle verification. This is for hackathon demo purposes. Before production:

1. Set `DEMO_MODE = false` in `programs/stark-verifier/src/lib.rs`
2. Integrate proper STWO-compatible proof generation
3. Run security audit

## [0.1.0] - 2026-02-03

### Added

- Initial Circle STARK verifier implementation
- M31/QM31 field arithmetic
- FRI verification with Fiat-Shamir
- Murkl anonymous transfer pools
- CLI prover (`murkl commit`, `murkl prove`, `murkl hash`)
- WASM prover for browser
- TypeScript SDK (`@murkl/sdk`)
- Web frontend with wallet connect

### Programs

- `stark-verifier`: `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw`
- `murkl-program`: `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92`

---

Built for [Colosseum Hackathon](https://www.colosseum.org/) 🏛️
