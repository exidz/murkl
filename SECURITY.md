# Murkl Security

## Overview

Murkl provides anonymous social transfers using Circle STARKs. This document describes the security model and hardening measures.

## Threat Model

### Protected Against

1. **Recipient Tracking**: On-chain observers cannot link claims to identifiers
2. **Double Spending**: Nullifiers prevent claiming the same deposit twice
3. **Replay Attacks**: Nullifier tracking + on-chain verification
4. **Relayer Censorship**: Anyone can run a relayer; recipient can claim directly
5. **DoS Attacks**: Rate limiting on relayer endpoints
6. **Front-Running**: Nullifier is derived from secret; cannot be predicted

### Trust Assumptions

1. **Relayer**: Semi-trusted. Cannot steal funds (no signing authority). Can:
   - Censor claims (mitigated by allowing multiple relayers)
   - Collect fees (capped at 1% on-chain)
   - See recipient addresses (unavoidable for token transfer)

2. **Depositor**: Trusted to share correct password with intended recipient

3. **Recipient**: Must keep password secret; anyone with password can claim

## Cryptographic Guarantees

### Post-Quantum Security
- All hashes use **keccak256** (pre-image resistance: 256-bit)
- Domain separation prevents cross-context attacks
- No discrete log or factoring assumptions

### STARK Proof
- Commitment binds identifier + password without revealing them
- Nullifier binds to commitment, preventing reuse
- Zero-knowledge: verifier learns nothing about identifier/password

## Smart Contract Security

### Access Controls
- Pool pause/unpause: Authority only
- Config updates: Authority only
- Authority transfer: Current authority only
- Deposits: Anyone (when not paused)
- Claims: Anyone with valid proof (when not paused)

### Validation
- Minimum deposit amounts enforced
- Maximum relayer fee enforced (on-chain)
- Commitment uniqueness (via deposit PDAs)
- Nullifier uniqueness (via nullifier PDAs)
- Proof ownership verification

### Overflow Protection
- All arithmetic uses checked operations
- Amount limits prevent overflow in fee calculation

## Relayer Security

### Rate Limiting
- General: 100 requests/minute/IP
- Claims: 10 requests/minute/IP
- Prevents DoS and resource exhaustion

### Input Validation
- Hex format validation
- Base58 address validation
- Fee bounds checking
- Size limits on proof data

### Security Headers (Helmet)
- Content-Security-Policy
- X-Frame-Options
- X-Content-Type-Options
- Strict-Transport-Security (when HTTPS)

### Error Handling
- Internal errors don't leak implementation details
- Structured logging for incident response
- Graceful shutdown on SIGTERM/SIGINT

## Frontend Security

### Input Sanitization
- Control characters stripped
- Length limits enforced client-side
- Address format validation before submission

### CORS
- Whitelist-based origin checking
- Credentials not included (stateless)

### Content Security Policy
```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self' <rpc-url>;
```

## Operational Security

### Relayer Key Management
1. Use dedicated keypair for relayer (not personal wallet)
2. Store keypair securely (encrypted at rest)
3. Maintain minimal SOL balance (enough for fees only)
4. Monitor balance and top up as needed

### Monitoring Recommendations
1. Log all claim attempts (success/failure)
2. Alert on high failure rates
3. Alert on balance drops
4. Monitor for unusual traffic patterns

### Incident Response
1. **Pool Pause**: If vulnerability discovered, pause pool immediately
2. **Relayer Stop**: Stop relayer if compromised
3. **Key Rotation**: If relayer key compromised, deploy new relayer

## Audit Status

⚠️ **This code has not been professionally audited.**

For production deployment, we recommend:
1. Smart contract audit by reputable firm
2. Penetration testing of relayer API
3. Code review by STARK/ZK experts

## Bug Bounty

*Not yet established*

## Contact

Security issues: security@murkl.app (not yet active)

---

Last updated: 2026-02-03
