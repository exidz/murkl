# @murkl/sdk

TypeScript SDK for Murkl STARK verifier on Solana.

## Installation

```bash
npm install @murkl/sdk
```

## Quick Start

```typescript
import { Connection, Keypair } from '@solana/web3.js';
import { MurklClient, StarkVerifier, generateCommitment, generateNullifier } from '@murkl/sdk';

const connection = new Connection('https://api.devnet.solana.com');
const wallet = Keypair.generate(); // or your wallet

// Initialize client
const client = new MurklClient({ connection, wallet });
const verifier = client.verifier;

// Generate commitment for deposit
const commitment = generateCommitment('@alice', 'secretpassword');

// Deposit tokens
const { depositAddress } = await client.deposit({
  pool: poolAddress,
  amount: 1000000n,
  commitment,
  depositorTokenAccount: myTokenAccount,
});

// Later: generate proof and claim
const nullifier = generateNullifier('secretpassword', leafIndex);

// Upload and verify proof
const { bufferAddress } = await verifier.uploadAndVerify({
  proof: proofBytes,
  commitment,
  nullifier,
  merkleRoot,
});

// Claim tokens
await client.claim({
  pool: poolAddress,
  deposit: depositAddress,
  verifierBuffer: bufferAddress,
  nullifier,
  recipientTokenAccount: recipientToken,
});
```

## API Reference

### MurklClient

Main client for deposits and claims.

```typescript
const client = new MurklClient({
  connection: Connection,
  wallet: Signer,
  programId?: PublicKey,  // optional, defaults to mainnet
  verifierProgramId?: PublicKey,
});

// Get pool info
const pool = await client.getPool(poolAddress);

// Get deposit info
const deposit = await client.getDeposit(depositAddress);

// Check if nullifier used
const used = await client.isNullifierUsed(pool, nullifier);

// Deposit
await client.deposit({ pool, amount, commitment, depositorTokenAccount });

// Claim
await client.claim({ pool, deposit, verifierBuffer, nullifier, recipientTokenAccount });
```

### StarkVerifier

Client for STARK proof verification.

```typescript
const verifier = new StarkVerifier(connection, wallet);

// Create buffer for proof
const { address, keypair } = await verifier.createBuffer(proofSize);

// Upload proof in chunks
await verifier.uploadProof(address, proofData, chunkSize, (percent) => {
  console.log(`Upload: ${percent}%`);
});

// Verify proof
await verifier.finalizeAndVerify(address, commitment, nullifier, merkleRoot);

// Or all-in-one:
await verifier.uploadAndVerify({ proof, commitment, nullifier, merkleRoot });

// Clean up
await verifier.closeBuffer(address);
```

### Crypto Utilities

```typescript
import { 
  generateCommitment,
  generateNullifier,
  hashIdentifier,
  keccak256,
  toHex,
  fromHex,
} from '@murkl/sdk';

// Generate commitment
const commitment = generateCommitment('@alice', 'password');

// Generate nullifier
const nullifier = generateNullifier('password', 0n);

// Raw hash
const hash = keccak256(data);
```

### ProofBuffer

Read proof buffer state.

```typescript
import { ProofBuffer } from '@murkl/sdk';

const buffer = await ProofBuffer.fetch(connection, bufferAddress);
console.log(buffer.isFinalized);
console.log(buffer.commitment);
console.log(buffer.nullifier);
console.log(buffer.merkleRoot);
```

## Program Addresses

| Program | Address |
|---------|---------|
| Murkl | `74P7nTytTESmeJTH46geZ93GLFq3yAojnvKDxJFFZa92` |
| STARK Verifier | `StArKSLbAn43UCcujFMc5gKc8rY2BVfSbguMfyLTMtw` |

## Security

This SDK implements fault-proof verification:

1. **Nullifier tracking** — Prevents replay attacks
2. **Public input verification** — Commitment, nullifier, merkle root verified from buffer
3. **Merkle root matching** — Ensures proof is for correct pool state
4. **Buffer ownership** — Only buffer owner can finalize

## License

MIT
