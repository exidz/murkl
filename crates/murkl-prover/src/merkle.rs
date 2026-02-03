//! Merkle tree implementation using Keccak256
//!
//! A binary Merkle tree for committing to polynomial evaluations.
//! Uses Keccak256 (SHA3) for the hash function.

#[cfg(not(feature = "std"))]
use alloc::{collections::BTreeMap, vec, vec::Vec};
#[cfg(feature = "std")]
use std::collections::HashMap;

use sha3::{Digest, Keccak256};
use crate::m31::M31;

/// Default tree depth (supports 2^TREE_DEPTH leaves)
pub const TREE_DEPTH: usize = 20; // 1M leaves

/// Hash output size in bytes
pub const HASH_SIZE: usize = 32;

/// A 32-byte hash value
pub type Hash = [u8; HASH_SIZE];

/// Zero hash (32 zero bytes)
pub const ZERO_HASH: Hash = [0u8; HASH_SIZE];

/// Hash two child hashes together to form a parent hash
#[inline]
pub fn hash_pair(left: &Hash, right: &Hash) -> Hash {
    let mut hasher = Keccak256::new();
    hasher.update(left);
    hasher.update(right);
    let result = hasher.finalize();
    let mut hash = [0u8; HASH_SIZE];
    hash.copy_from_slice(&result);
    hash
}

/// Hash a single leaf value (M31 element)
#[inline]
pub fn hash_leaf(value: M31) -> Hash {
    let mut hasher = Keccak256::new();
    hasher.update(&value.to_le_bytes());
    let result = hasher.finalize();
    let mut hash = [0u8; HASH_SIZE];
    hash.copy_from_slice(&result);
    hash
}

/// Hash multiple M31 elements (for batched leaf hashing)
pub fn hash_m31_batch(values: &[M31]) -> Hash {
    let mut hasher = Keccak256::new();
    for v in values {
        hasher.update(&v.to_le_bytes());
    }
    let result = hasher.finalize();
    let mut hash = [0u8; HASH_SIZE];
    hash.copy_from_slice(&result);
    hash
}

/// Hash arbitrary bytes
pub fn hash_bytes(data: &[u8]) -> Hash {
    let result = Keccak256::digest(data);
    let mut hash = [0u8; HASH_SIZE];
    hash.copy_from_slice(&result);
    hash
}

/// A Merkle authentication path (sibling hashes from leaf to root)
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerklePath {
    /// Sibling hashes at each level (from leaf to root)
    pub siblings: Vec<Hash>,
    /// Leaf index
    pub leaf_index: usize,
}

impl MerklePath {
    /// Create a new empty path
    pub fn new(leaf_index: usize, depth: usize) -> Self {
        Self {
            siblings: vec![ZERO_HASH; depth],
            leaf_index,
        }
    }

    /// Verify this path against a leaf and root
    pub fn verify(&self, leaf_hash: &Hash, root: &Hash) -> bool {
        let computed = self.compute_root(leaf_hash);
        &computed == root
    }

    /// Compute the root from a leaf hash using this path
    pub fn compute_root(&self, leaf_hash: &Hash) -> Hash {
        let mut current = *leaf_hash;
        let mut index = self.leaf_index;

        for sibling in &self.siblings {
            current = if index & 1 == 0 {
                // Current is left child
                hash_pair(&current, sibling)
            } else {
                // Current is right child
                hash_pair(sibling, &current)
            };
            index >>= 1;
        }

        current
    }

    /// Get the depth of this path
    pub fn depth(&self) -> usize {
        self.siblings.len()
    }
}

/// Sparse Merkle tree implementation
///
/// Only stores non-empty nodes, making it memory-efficient
/// for trees with few populated leaves.
#[derive(Clone, Debug)]
pub struct MerkleTree {
    /// Tree depth (log2 of max leaves)
    depth: usize,
    /// Leaf values by index
    #[cfg(feature = "std")]
    leaves: HashMap<usize, Hash>,
    #[cfg(not(feature = "std"))]
    leaves: BTreeMap<usize, Hash>,
    /// Cached empty subtree hashes at each level
    empty_hashes: Vec<Hash>,
    /// Number of leaves inserted
    leaf_count: usize,
}

impl MerkleTree {
    /// Create a new empty Merkle tree with given depth
    pub fn new(depth: usize) -> Self {
        let empty_hashes = compute_empty_hashes(depth);
        Self {
            depth,
            #[cfg(feature = "std")]
            leaves: HashMap::new(),
            #[cfg(not(feature = "std"))]
            leaves: BTreeMap::new(),
            empty_hashes,
            leaf_count: 0,
        }
    }

    /// Create with default depth
    pub fn with_default_depth() -> Self {
        Self::new(TREE_DEPTH)
    }

    /// Get tree depth
    pub fn depth(&self) -> usize {
        self.depth
    }

    /// Get number of inserted leaves
    pub fn leaf_count(&self) -> usize {
        self.leaf_count
    }

    /// Maximum number of leaves this tree can hold
    pub fn capacity(&self) -> usize {
        1 << self.depth
    }

    /// Insert a leaf at the next available position
    pub fn insert(&mut self, leaf_hash: Hash) -> usize {
        let index = self.leaf_count;
        self.leaves.insert(index, leaf_hash);
        self.leaf_count += 1;
        index
    }

    /// Insert an M31 value as a leaf
    pub fn insert_m31(&mut self, value: M31) -> usize {
        self.insert(hash_leaf(value))
    }

    /// Set a leaf at a specific index
    pub fn set(&mut self, index: usize, leaf_hash: Hash) {
        assert!(index < self.capacity(), "Index out of bounds");
        self.leaves.insert(index, leaf_hash);
        if index >= self.leaf_count {
            self.leaf_count = index + 1;
        }
    }

    /// Get the leaf hash at a given index
    pub fn get_leaf(&self, index: usize) -> Hash {
        self.leaves.get(&index).copied().unwrap_or(self.empty_hashes[0])
    }

    /// Compute the root hash
    pub fn root(&self) -> Hash {
        self.compute_node(0, self.depth)
    }

    /// Compute hash of a node at given position and level
    fn compute_node(&self, index: usize, level: usize) -> Hash {
        if level == 0 {
            return self.get_leaf(index);
        }

        let left_index = index * 2;
        let right_index = index * 2 + 1;

        // Check if this subtree is entirely empty
        let subtree_start = index << level;
        let _subtree_end = subtree_start + (1 << level);

        if subtree_start >= self.leaf_count {
            return self.empty_hashes[level];
        }

        let left = self.compute_node(left_index, level - 1);
        let right = if (right_index << (level - 1)) >= self.leaf_count {
            self.empty_hashes[level - 1]
        } else {
            self.compute_node(right_index, level - 1)
        };

        hash_pair(&left, &right)
    }

    /// Generate a Merkle path for a leaf
    pub fn get_path(&self, leaf_index: usize) -> MerklePath {
        assert!(leaf_index < self.capacity(), "Index out of bounds");

        let mut siblings = Vec::with_capacity(self.depth);
        let mut index = leaf_index;

        for level in 0..self.depth {
            let sibling_index = index ^ 1;
            let sibling_start = sibling_index << level;

            let sibling_hash = if sibling_start >= self.leaf_count {
                self.empty_hashes[level]
            } else {
                self.compute_node(sibling_index, level)
            };

            siblings.push(sibling_hash);
            index >>= 1;
        }

        MerklePath {
            siblings,
            leaf_index,
        }
    }

    /// Verify a leaf at the given index matches the current root
    pub fn verify(&self, leaf_index: usize, leaf_hash: &Hash) -> bool {
        let path = self.get_path(leaf_index);
        let computed_root = path.compute_root(leaf_hash);
        computed_root == self.root()
    }
}

impl Default for MerkleTree {
    fn default() -> Self {
        Self::with_default_depth()
    }
}

/// Compute empty subtree hashes for each level
fn compute_empty_hashes(depth: usize) -> Vec<Hash> {
    let mut hashes = vec![ZERO_HASH; depth + 1];
    hashes[0] = hash_bytes(&[]); // Empty leaf hash

    for i in 1..=depth {
        hashes[i] = hash_pair(&hashes[i - 1], &hashes[i - 1]);
    }

    hashes
}

/// Build a Merkle tree from a slice of leaf hashes
pub fn build_tree(leaves: &[Hash]) -> (Hash, Vec<Vec<Hash>>) {
    if leaves.is_empty() {
        return (ZERO_HASH, vec![]);
    }

    let depth = (leaves.len() as f64).log2().ceil() as usize;
    let padded_size = 1 << depth;

    // Pad with zero hashes if necessary
    let mut current_level: Vec<Hash> = leaves.to_vec();
    current_level.resize(padded_size, hash_bytes(&[]));

    let mut tree = vec![current_level.clone()];

    // Build tree level by level
    while current_level.len() > 1 {
        let mut next_level = Vec::with_capacity(current_level.len() / 2);

        for chunk in current_level.chunks(2) {
            next_level.push(hash_pair(&chunk[0], &chunk[1]));
        }

        tree.push(next_level.clone());
        current_level = next_level;
    }

    (current_level[0], tree)
}

/// Commitment to a vector of M31 elements using Merkle tree
#[derive(Clone, Debug)]
pub struct MerkleCommitment {
    /// Root hash of the tree
    pub root: Hash,
    /// Original values (optional, for opening proofs)
    values: Option<Vec<M31>>,
    /// Internal tree structure
    tree: Option<Vec<Vec<Hash>>>,
}

impl MerkleCommitment {
    /// Create a commitment from M31 values
    pub fn commit(values: &[M31]) -> Self {
        let leaves: Vec<Hash> = values.iter().map(|&v| hash_leaf(v)).collect();
        let (root, tree) = build_tree(&leaves);

        Self {
            root,
            values: Some(values.to_vec()),
            tree: Some(tree),
        }
    }

    /// Create a commitment without storing values (just the root)
    pub fn commit_root_only(values: &[M31]) -> Self {
        let leaves: Vec<Hash> = values.iter().map(|&v| hash_leaf(v)).collect();
        let (root, _) = build_tree(&leaves);

        Self {
            root,
            values: None,
            tree: None,
        }
    }

    /// Get the root hash
    pub fn root(&self) -> Hash {
        self.root
    }

    /// Open the commitment at a specific index
    pub fn open(&self, index: usize) -> Option<(M31, MerklePath)> {
        let values = self.values.as_ref()?;
        let tree = self.tree.as_ref()?;

        if index >= values.len() {
            return None;
        }

        let value = values[index];
        // Number of sibling levels is tree.len() - 1 (root has no sibling)
        let num_siblings = tree.len().saturating_sub(1);

        let mut siblings = Vec::with_capacity(num_siblings);
        let mut idx = index;

        for level in 0..num_siblings {
            let sibling_idx = idx ^ 1;
            if sibling_idx < tree[level].len() {
                siblings.push(tree[level][sibling_idx]);
            } else {
                siblings.push(compute_empty_hashes(num_siblings)[level]);
            }
            idx >>= 1;
        }

        Some((value, MerklePath {
            siblings,
            leaf_index: index,
        }))
    }

    /// Verify an opening
    pub fn verify_opening(&self, index: usize, value: M31, path: &MerklePath) -> bool {
        if index != path.leaf_index {
            return false;
        }
        let leaf_hash = hash_leaf(value);
        path.verify(&leaf_hash, &self.root)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_deterministic() {
        let a = hash_bytes(b"hello");
        let b = hash_bytes(b"hello");
        assert_eq!(a, b);

        let c = hash_bytes(b"world");
        assert_ne!(a, c);
    }

    #[test]
    fn test_hash_leaf() {
        let v1 = M31::new(12345);
        let v2 = M31::new(12345);
        let v3 = M31::new(67890);

        assert_eq!(hash_leaf(v1), hash_leaf(v2));
        assert_ne!(hash_leaf(v1), hash_leaf(v3));
    }

    #[test]
    fn test_empty_tree() {
        let tree = MerkleTree::new(4);
        let root = tree.root();

        // Empty tree has a deterministic root
        let tree2 = MerkleTree::new(4);
        assert_eq!(root, tree2.root());
    }

    #[test]
    fn test_single_leaf() {
        let mut tree = MerkleTree::new(4);
        let leaf_hash = hash_leaf(M31::new(12345));
        let index = tree.insert(leaf_hash);

        assert_eq!(index, 0);
        assert_eq!(tree.get_leaf(0), leaf_hash);
        assert_eq!(tree.leaf_count(), 1);
    }

    #[test]
    fn test_merkle_path_verification() {
        let mut tree = MerkleTree::new(4);

        // Insert some leaves
        for i in 0u32..10 {
            tree.insert_m31(M31::new(i * 1000 + 123));
        }

        let root = tree.root();

        // Verify path for each leaf
        for i in 0usize..10 {
            let leaf_hash = hash_leaf(M31::new((i * 1000 + 123) as u32));
            let path = tree.get_path(i);

            assert!(
                path.verify(&leaf_hash, &root),
                "Path verification failed for leaf {}",
                i
            );
        }
    }

    #[test]
    fn test_path_fails_for_wrong_leaf() {
        let mut tree = MerkleTree::new(4);

        for i in 0..8 {
            tree.insert_m31(M31::new(i * 100));
        }

        let root = tree.root();
        let path = tree.get_path(0);

        // Correct leaf should verify
        let correct_hash = hash_leaf(M31::new(0));
        assert!(path.verify(&correct_hash, &root));

        // Wrong leaf should not verify
        let wrong_hash = hash_leaf(M31::new(999));
        assert!(!path.verify(&wrong_hash, &root));
    }

    #[test]
    fn test_different_roots_for_different_trees() {
        let mut tree1 = MerkleTree::new(4);
        let mut tree2 = MerkleTree::new(4);

        tree1.insert_m31(M31::new(100));
        tree2.insert_m31(M31::new(200));

        assert_ne!(tree1.root(), tree2.root());
    }

    #[test]
    fn test_build_tree() {
        let leaves: Vec<Hash> = (0..8)
            .map(|i| hash_leaf(M31::new(i)))
            .collect();

        let (root, tree) = build_tree(&leaves);

        // Tree should have 4 levels (8 -> 4 -> 2 -> 1)
        assert_eq!(tree.len(), 4);
        assert_eq!(tree[0].len(), 8);
        assert_eq!(tree[1].len(), 4);
        assert_eq!(tree[2].len(), 2);
        assert_eq!(tree[3].len(), 1);
        assert_eq!(tree[3][0], root);
    }

    #[test]
    fn test_commitment() {
        let values: Vec<M31> = (0..16).map(|i| M31::new(i)).collect();
        let commitment = MerkleCommitment::commit(&values);

        // Open at each index and verify
        for i in 0..16 {
            let (value, path) = commitment.open(i).unwrap();
            assert_eq!(value.value(), i as u32);
            assert!(commitment.verify_opening(i, value, &path));
        }
    }

    #[test]
    fn test_commitment_root_only() {
        let values: Vec<M31> = (0..16).map(|i| M31::new(i)).collect();
        let full = MerkleCommitment::commit(&values);
        let root_only = MerkleCommitment::commit_root_only(&values);

        // Roots should match
        assert_eq!(full.root(), root_only.root());

        // Opening should fail for root-only
        assert!(root_only.open(0).is_none());
    }

    #[test]
    fn test_large_tree() {
        let mut tree = MerkleTree::new(10);

        // Insert 1000 leaves
        for i in 0..1000 {
            tree.insert_m31(M31::new(i));
        }

        let root = tree.root();

        // Verify some random paths
        for i in [0, 100, 500, 999] {
            let leaf_hash = hash_leaf(M31::new(i as u32));
            let path = tree.get_path(i);
            assert!(path.verify(&leaf_hash, &root));
        }
    }

    #[test]
    fn test_set_specific_index() {
        let mut tree = MerkleTree::new(4);

        tree.set(5, hash_leaf(M31::new(500)));
        tree.set(10, hash_leaf(M31::new(1000)));

        assert_eq!(tree.get_leaf(5), hash_leaf(M31::new(500)));
        assert_eq!(tree.get_leaf(10), hash_leaf(M31::new(1000)));
        assert_eq!(tree.get_leaf(0), tree.empty_hashes[0]); // Empty leaf
    }
}
