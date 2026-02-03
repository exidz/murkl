//! Murkl CLI - Generate STARK proofs for anonymous claims
//!
//! Commands:
//! - deposit: Generate commitment from identifier + secret
//! - prove: Generate STARK proof for claiming
//! - claim: Submit claim transaction

use clap::{Parser, Subcommand};
use std::fs;
use std::path::PathBuf;

mod prover;
mod types;

use prover::MurklProver;
use types::*;

#[derive(Parser)]
#[command(name = "murkl")]
#[command(about = "Anonymous social transfers on Solana", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate commitment for deposit (password-protected)
    Commit {
        /// Social identifier (@twitter, email, phone, etc.)
        #[arg(short, long)]
        identifier: String,
        
        /// Password for claiming (shared out-of-band with recipient)
        #[arg(short, long)]
        password: String,
        
        /// Output file for deposit data (keep private!)
        #[arg(short, long, default_value = "deposit.json")]
        output: PathBuf,
    },
    
/// Generate STARK proof for claim (recipient runs this)
    Prove {
        /// Social identifier (@twitter, email, etc.)
        #[arg(short, long)]
        identifier: String,
        
        /// Password (from sender)
        #[arg(short, long)]
        password: String,
        
        /// Leaf index in Merkle tree
        #[arg(short, long)]
        leaf_index: u32,
        
        /// Merkle tree data file (from pool)
        #[arg(short, long)]
        merkle: PathBuf,
        
        /// Output proof file
        #[arg(short, long, default_value = "proof.bin")]
        output: PathBuf,
    },
    
    /// Verify a proof locally
    Verify {
        /// Proof file
        #[arg(short, long, default_value = "proof.bin")]
        proof: PathBuf,
        
        /// Public commitment
        #[arg(short, long)]
        commitment: String,
    },
    
/// Show deposit info
    Info {
        /// Deposit data file
        #[arg(short, long, default_value = "deposit.json")]
        input: PathBuf,
    },
    
    /// Compute commitment from identifier + password (for verification)
    Hash {
        /// Social identifier
        #[arg(short, long)]
        identifier: String,
        
        /// Password
        #[arg(short, long)]
        password: String,
    },
}

fn main() {
    let cli = Cli::parse();
    
    match cli.command {
        Commands::Commit { identifier, password, output } => {
            cmd_commit(&identifier, &password, &output);
        }
        Commands::Prove { identifier, password, leaf_index, merkle, output } => {
            cmd_prove(&identifier, &password, leaf_index, &merkle, &output);
        }
        Commands::Verify { proof, commitment } => {
            cmd_verify(&proof, &commitment);
        }
        Commands::Info { input } => {
            cmd_info(&input);
        }
        Commands::Hash { identifier, password } => {
            cmd_hash(&identifier, &password);
        }
    }
}

fn cmd_commit(identifier: &str, password: &str, output: &PathBuf) {
    println!("🐈‍⬛ Murkl - Generating commitment\n");
    
    // Hash identifier to M31
    let id_hash = hash_identifier(identifier);
    println!("   Identifier: {}", identifier);
    println!("   ID hash (M31): {}", id_hash);
    
    // Derive secret from password
    let secret = hash_password(password);
    println!("   Password: {}", "*".repeat(password.len()));
    println!("   Secret (from password): {}", secret);
    
    // Compute commitment = hash(identifier, secret)
    let commitment = m31_hash2(id_hash, secret);
    println!("   Commitment: 0x{}", hex::encode(&commitment[..8]));
    
    // Save deposit data (for sender's records)
    let deposit_data = DepositData {
        identifier: identifier.to_string(),
        identifier_hash: id_hash,
        commitment: commitment.to_vec(),
        // Note: password/secret NOT stored - recipient needs password from sender
    };
    
    let json = serde_json::to_string_pretty(&deposit_data).unwrap();
    fs::write(output, &json).expect("Failed to write deposit data");
    
    println!("\n✅ Deposit data saved to {:?}", output);
    println!("\n📋 NEXT STEPS:");
    println!("   1. Use commitment in deposit transaction");
    println!("   2. Share password '{}' with recipient (out-of-band)", password);
    println!("   3. Recipient claims with: murkl prove -i {} -p {}", identifier, password);
}

fn cmd_prove(identifier: &str, password: &str, leaf_index: u32, merkle: &PathBuf, output: &PathBuf) {
    println!("🐈‍⬛ Murkl - Generating STARK proof\n");
    
    // Derive values from identifier + password
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);
    let commitment = m31_hash2(id_hash, secret);
    
    println!("   Identifier: {}", identifier);
    println!("   Commitment: 0x{}", hex::encode(&commitment[..8]));
    println!("   Leaf index: {}", leaf_index);
    
    // Load merkle tree
    let merkle_json = fs::read_to_string(merkle).expect("Failed to read merkle data");
    let merkle_data: MerkleData = serde_json::from_str(&merkle_json).expect("Invalid merkle data");
    
    // Verify commitment is in tree
    if let Some(found_idx) = merkle_data.find_leaf(&commitment.to_vec()) {
        if found_idx != leaf_index {
            println!("   ⚠️  Warning: commitment found at index {} but you specified {}", found_idx, leaf_index);
        }
    }
    
    // Compute nullifier = hash(secret, leaf_index)
    let nullifier = m31_hash2(secret, leaf_index);
    println!("   Nullifier: 0x{}", hex::encode(&nullifier[..8]));
    
    // Generate STARK proof
    println!("\n   Generating STARK proof...");
    let prover = MurklProver::new();
    let proof = prover.generate_proof(
        id_hash,
        secret,
        leaf_index,
        &merkle_data,
    );
    
    // Save proof bundle (proof + public inputs)
    let proof_bundle = ProofBundle {
        proof: proof.serialize(),
        commitment: commitment.to_vec(),
        nullifier: nullifier.to_vec(),
        leaf_index,
    };
    
    let bundle_json = serde_json::to_string_pretty(&proof_bundle).unwrap();
    fs::write(output.with_extension("json"), &bundle_json).expect("Failed to write proof bundle");
    
    // Also save raw proof
    fs::write(output, &proof_bundle.proof).expect("Failed to write proof");
    
    println!("   Proof size: {} bytes", proof_bundle.proof.len());
    println!("\n✅ Proof saved to {:?}", output);
    println!("✅ Proof bundle saved to {:?}", output.with_extension("json"));
    println!("\n📋 NEXT STEP: Submit to relayer with your wallet address");
}

fn cmd_verify(proof_path: &PathBuf, commitment: &str) {
    println!("🐈‍⬛ Murkl - Verifying proof\n");
    
    let proof_bytes = fs::read(proof_path).expect("Failed to read proof");
    let commitment_bytes = hex::decode(commitment.trim_start_matches("0x"))
        .expect("Invalid commitment hex");
    
    let prover = MurklProver::new();
    let proof = MurklProof::deserialize(&proof_bytes);
    
    let valid = prover.verify_proof(&proof, &commitment_bytes);
    
    if valid {
        println!("✅ Proof is VALID!");
    } else {
        println!("❌ Proof is INVALID!");
    }
}

fn cmd_info(input: &PathBuf) {
    println!("🐈‍⬛ Murkl - Deposit Info\n");
    
    let json = fs::read_to_string(input).expect("Failed to read file");
    
    // Try to parse as DepositData first
    if let Ok(deposit_data) = serde_json::from_str::<DepositData>(&json) {
        println!("   Identifier: {}", deposit_data.identifier);
        println!("   ID hash: {}", deposit_data.identifier_hash);
        println!("   Commitment: 0x{}", hex::encode(&deposit_data.commitment[..8.min(deposit_data.commitment.len())]));
        return;
    }
    
    // Try ProofBundle
    if let Ok(bundle) = serde_json::from_str::<ProofBundle>(&json) {
        println!("   Commitment: 0x{}", hex::encode(&bundle.commitment[..8.min(bundle.commitment.len())]));
        println!("   Nullifier: 0x{}", hex::encode(&bundle.nullifier[..8.min(bundle.nullifier.len())]));
        println!("   Leaf index: {}", bundle.leaf_index);
        println!("   Proof size: {} bytes", bundle.proof.len());
        return;
    }
    
    println!("   ❌ Unknown file format");
}

fn cmd_hash(identifier: &str, password: &str) {
    println!("🐈‍⬛ Murkl - Compute Hash\n");
    
    let id_hash = hash_identifier(identifier);
    let secret = hash_password(password);
    let commitment = m31_hash2(id_hash, secret);
    let nullifier_example = m31_hash2(secret, 0); // Example with leaf_index=0
    
    println!("   Identifier: {}", identifier);
    println!("   ID hash: {}", id_hash);
    println!("   Secret (from password): {}", secret);
    println!("   Commitment: 0x{}", hex::encode(&commitment[..8]));
    println!("   Nullifier (leaf 0): 0x{}", hex::encode(&nullifier_example[..8]));
}

// ============================================================================
// PQ-SECURE HASH FUNCTIONS (keccak256-based)
// Post-quantum secure: relies only on hash collision resistance
// ============================================================================

use sha3::{Digest, Keccak256};

const M31_PRIME: u32 = 0x7FFFFFFF;

/// Derive secret from password using keccak256 (PQ-secure)
fn hash_password(password: &str) -> u32 {
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_password_v1");
    hasher.update(password.as_bytes());
    let result = hasher.finalize();
    // Take first 4 bytes mod M31
    let val = u32::from_le_bytes([result[0], result[1], result[2], result[3]]);
    val % M31_PRIME
}

/// Hash identifier to M31 using keccak256 (PQ-secure)
fn hash_identifier(id: &str) -> u32 {
    let normalized = id.to_lowercase();
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_identifier_v1");
    hasher.update(normalized.as_bytes());
    let result = hasher.finalize();
    // Take first 4 bytes mod M31
    let val = u32::from_le_bytes([result[0], result[1], result[2], result[3]]);
    val % M31_PRIME
}

/// Compute commitment = keccak256(identifier || secret) (PQ-secure)
/// Full 32-byte hash for on-chain storage
fn pq_commitment(identifier: &str, secret: u32) -> [u8; 32] {
    let normalized = identifier.to_lowercase();
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_commitment_v1");
    hasher.update(normalized.as_bytes());
    hasher.update(&secret.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Compute nullifier = keccak256(secret || leaf_index) (PQ-secure)
/// Prevents double-spend
fn pq_nullifier(secret: u32, leaf_index: u32) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_nullifier_v1");
    hasher.update(&secret.to_le_bytes());
    hasher.update(&leaf_index.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

/// Convert 32-byte hash to M31 for STARK circuits
fn hash_to_m31(hash: &[u8; 32]) -> u32 {
    let val = u32::from_le_bytes([hash[0], hash[1], hash[2], hash[3]]);
    val % M31_PRIME
}

// Legacy M31 hash (kept for STARK trace, but commitment uses keccak256)
fn m31_hash2(id_hash: u32, secret: u32) -> [u8; 32] {
    // Now just wraps pq_commitment with M31 inputs
    let mut hasher = Keccak256::new();
    hasher.update(b"murkl_m31_hash_v1");
    hasher.update(&id_hash.to_le_bytes());
    hasher.update(&secret.to_le_bytes());
    let result = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&result);
    out
}

// ============================================================================
// Data structures for JSON serialization
// ============================================================================

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct DepositData {
    identifier: String,
    identifier_hash: u32,
    commitment: Vec<u8>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct ProofBundle {
    proof: Vec<u8>,
    commitment: Vec<u8>,
    nullifier: Vec<u8>,
    leaf_index: u32,
}
