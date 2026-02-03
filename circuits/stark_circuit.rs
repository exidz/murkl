//! Murkl STARK Circuit - Merkle Membership Proof
//!
//! This circuit proves knowledge of a Merkle path without revealing:
//! - Which leaf is being claimed
//! - The secret used to create the commitment
//!
//! Public inputs:
//! - Merkle root
//! - Nullifier (prevents double-claims)
//! - Recipient address
//!
//! Private inputs:
//! - Leaf value (commitment)
//! - Merkle path (siblings + path bits)
//! - Secret (used for nullifier)
//! - Leaf index

use super::m31::M31;
use super::merkle::TREE_DEPTH;

/// Configuration for the Murkl circuit
pub const LOG_N_ROWS: u32 = 10; // 1024 rows per proof batch

/// Number of columns for the Merkle proof trace
/// For each level: hash input (2) + hash output (1) + sibling (1) + path bit (1)
pub const MERKLE_COLS_PER_LEVEL: usize = 5;
pub const N_MERKLE_COLUMNS: usize = TREE_DEPTH * MERKLE_COLS_PER_LEVEL;

/// Public inputs for a Murkl claim
#[derive(Clone, Debug)]
pub struct MurklPublicInputs {
    /// The Merkle root (commitment tree root)
    pub merkle_root: M31,
    /// Nullifier = hash(secret || leaf_index) - prevents double-spend
    pub nullifier: M31,
    /// Recipient address hash (where funds go)
    pub recipient: M31,
}

/// Private witness for a Murkl claim
#[derive(Clone, Debug)]
pub struct MurklWitness {
    /// The leaf commitment = hash(identifier || secret)
    pub leaf: M31,
    /// The secret (used for commitment and nullifier)
    pub secret: M31,
    /// The identifier hash (email/social handle)
    pub identifier: M31,
    /// Leaf index in the tree
    pub leaf_index: u32,
    /// Sibling hashes along the Merkle path
    pub siblings: [M31; TREE_DEPTH],
    /// Path bits (0 = left, 1 = right)
    pub path_bits: [bool; TREE_DEPTH],
}

/// Full claim data for proving
#[derive(Clone, Debug)]
pub struct MurklClaim {
    pub public_inputs: MurklPublicInputs,
    pub witness: MurklWitness,
}

impl MurklClaim {
    /// Verify the claim is internally consistent (for debugging)
    pub fn verify_consistency(&self) -> bool {
        use super::poseidon::{commitment, nullifier};
        use super::merkle::MerklePath;

        // Check commitment
        let computed_leaf = commitment(self.witness.identifier, self.witness.secret);
        if computed_leaf.value() != self.witness.leaf.value() {
            return false;
        }

        // Check nullifier
        let computed_nullifier = nullifier(self.witness.secret, self.witness.leaf_index);
        if computed_nullifier.value() != self.public_inputs.nullifier.value() {
            return false;
        }

        // Check Merkle path
        let path = MerklePath {
            siblings: self.witness.siblings,
            path_bits: self.witness.path_bits,
        };
        if !path.verify(self.witness.leaf, self.public_inputs.merkle_root) {
            return false;
        }

        true
    }
}

/// Generate the execution trace for a Murkl proof
/// 
/// The trace encodes:
/// 1. Commitment verification: leaf = hash(identifier || secret)
/// 2. Merkle path verification: root = hash_chain(leaf, siblings, path_bits)
/// 3. Nullifier computation: nullifier = hash(secret || leaf_index)
pub fn generate_trace(claims: &[MurklClaim]) -> Vec<Vec<M31>> {
    use super::poseidon::hash2;

    let n_rows = 1 << LOG_N_ROWS;
    let n_claims = claims.len();
    
    // Initialize trace columns
    let mut trace: Vec<Vec<M31>> = vec![vec![M31::ZERO; n_rows]; N_MERKLE_COLUMNS + 10];
    
    for (row, claim) in claims.iter().enumerate().take(n_rows) {
        let mut col = 0;
        
        // Column 0-2: Commitment inputs and output
        trace[col][row] = claim.witness.identifier;
        col += 1;
        trace[col][row] = claim.witness.secret;
        col += 1;
        trace[col][row] = claim.witness.leaf; // = hash(identifier, secret)
        col += 1;
        
        // Merkle path computation
        let mut current = claim.witness.leaf;
        for level in 0..TREE_DEPTH {
            let sibling = claim.witness.siblings[level];
            let path_bit = claim.witness.path_bits[level];
            
            // Store current node
            trace[col][row] = current;
            col += 1;
            
            // Store sibling
            trace[col][row] = sibling;
            col += 1;
            
            // Store path bit as field element
            trace[col][row] = if path_bit { M31::ONE } else { M31::ZERO };
            col += 1;
            
            // Compute next level
            let next = if path_bit {
                hash2(sibling, current)
            } else {
                hash2(current, sibling)
            };
            
            // Store hash output
            trace[col][row] = next;
            col += 1;
            
            current = next;
        }
        
        // Final column: Merkle root should match public input
        trace[col][row] = claim.public_inputs.merkle_root;
        col += 1;
        
        // Nullifier columns
        trace[col][row] = claim.witness.secret;
        col += 1;
        trace[col][row] = M31::new(claim.witness.leaf_index);
        col += 1;
        trace[col][row] = claim.public_inputs.nullifier;
        // col += 1;
    }
    
    trace
}

/// Constraint evaluation for Murkl circuit
/// 
/// Constraints:
/// 1. leaf = Poseidon(identifier, secret)
/// 2. For each Merkle level: next = Poseidon(left, right) where left/right depend on path_bit
/// 3. Final hash = public merkle_root
/// 4. nullifier = Poseidon(secret, leaf_index)
/// 5. path_bit ∈ {0, 1}
pub struct MurklConstraints {
    pub log_n_rows: u32,
}

impl MurklConstraints {
    pub fn new(log_n_rows: u32) -> Self {
        Self { log_n_rows }
    }
    
    /// Evaluate constraints (placeholder - full implementation requires STWO integration)
    pub fn evaluate_constraints(&self, _trace: &[Vec<M31>]) -> Vec<M31> {
        // TODO: Implement full constraint evaluation using STWO's EvalAtRow trait
        // For now, return empty (no constraint violations)
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merkle::MerkleTree;
    use crate::poseidon::{commitment, nullifier};

    fn create_test_claim() -> MurklClaim {
        // Create a test Merkle tree
        let mut tree = MerkleTree::new();
        
        // Create test values
        let identifier = M31::new(12345); // hash of email
        let secret = M31::new(98765);
        let leaf = commitment(identifier, secret);
        
        // Insert some leaves
        for i in 0..5 {
            if i == 2 {
                tree.insert(leaf); // Our leaf at index 2
            } else {
                tree.insert(M31::new(i * 1000));
            }
        }
        
        let leaf_index = 2u32;
        let merkle_root = tree.root();
        let path = tree.get_path(leaf_index);
        let null = nullifier(secret, leaf_index);
        
        MurklClaim {
            public_inputs: MurklPublicInputs {
                merkle_root,
                nullifier: null,
                recipient: M31::new(0xABCDEF), // recipient address
            },
            witness: MurklWitness {
                leaf,
                secret,
                identifier,
                leaf_index,
                siblings: path.siblings,
                path_bits: path.path_bits,
            },
        }
    }

    #[test]
    fn test_claim_consistency() {
        let claim = create_test_claim();
        assert!(claim.verify_consistency(), "Claim should be internally consistent");
    }

    #[test]
    fn test_trace_generation() {
        let claim = create_test_claim();
        let trace = generate_trace(&[claim]);
        
        // Trace should have expected number of columns
        assert!(trace.len() > N_MERKLE_COLUMNS);
        
        // First row should have our data
        assert!(trace[0][0].value() != 0);
    }
}
