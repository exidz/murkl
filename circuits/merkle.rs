//! Merkle tree implementation for Murkl
//!
//! A sparse Merkle tree for storing commitments.
//! The ZK circuit proves membership without revealing which leaf.

use super::m31::M31;
use super::poseidon::hash2;

/// Merkle tree depth (supports 2^DEPTH leaves)
pub const TREE_DEPTH: usize = 16; // 65536 leaves (adjustable for production)

/// A Merkle tree path (sibling hashes from leaf to root)
#[derive(Clone, Debug)]
pub struct MerklePath {
    /// Sibling hashes at each level
    pub siblings: [M31; TREE_DEPTH],
    /// Position bits (0 = left, 1 = right)
    pub path_bits: [bool; TREE_DEPTH],
}

impl MerklePath {
    /// Verify this path leads to the given root
    pub fn verify(&self, leaf: M31, root: M31) -> bool {
        let computed_root = self.compute_root(leaf);
        computed_root.value() == root.value()
    }

    /// Compute the root from a leaf using this path
    pub fn compute_root(&self, leaf: M31) -> M31 {
        let mut current = leaf;

        for i in 0..TREE_DEPTH {
            let sibling = self.siblings[i];
            
            current = if self.path_bits[i] {
                // Current node is on the right
                hash2(sibling, current)
            } else {
                // Current node is on the left
                hash2(current, sibling)
            };
        }

        current
    }

    /// Get the leaf index from path bits
    pub fn leaf_index(&self) -> u32 {
        let mut index = 0u32;
        for i in 0..TREE_DEPTH {
            if self.path_bits[i] {
                index |= 1 << i;
            }
        }
        index
    }
}

/// Default (empty) leaf value
pub fn empty_leaf() -> M31 {
    M31::ZERO
}

/// Compute the root of an empty tree
pub fn empty_tree_root() -> M31 {
    let mut current = empty_leaf();
    for _ in 0..TREE_DEPTH {
        current = hash2(current, current);
    }
    current
}

/// Precomputed empty subtree roots for each level
/// empty_roots[i] = root of empty subtree of depth i
pub fn empty_subtree_roots() -> [M31; TREE_DEPTH + 1] {
    let mut roots = [M31::ZERO; TREE_DEPTH + 1];
    roots[0] = empty_leaf();
    
    for i in 1..=TREE_DEPTH {
        roots[i] = hash2(roots[i - 1], roots[i - 1]);
    }
    
    roots
}

/// In-memory Merkle tree for building/updating
/// Uses sparse representation - only stores non-empty nodes
#[derive(Clone, Debug)]
pub struct MerkleTree {
    /// Leaves (indexed by position)
    leaves: std::collections::HashMap<u32, M31>,
    /// Number of leaves inserted
    pub leaf_count: u32,
    /// Cached empty subtree roots
    empty_roots: [M31; TREE_DEPTH + 1],
}

impl MerkleTree {
    /// Create a new empty tree
    pub fn new() -> Self {
        Self {
            leaves: std::collections::HashMap::new(),
            leaf_count: 0,
            empty_roots: empty_subtree_roots(),
        }
    }

    /// Insert a leaf at the next available position
    pub fn insert(&mut self, leaf: M31) -> u32 {
        let index = self.leaf_count;
        self.leaves.insert(index, leaf);
        self.leaf_count += 1;
        index
    }

    /// Get the leaf at a given index
    pub fn get_leaf(&self, index: u32) -> M31 {
        self.leaves.get(&index).copied().unwrap_or(empty_leaf())
    }

    /// Compute the current root
    pub fn root(&self) -> M31 {
        self.compute_subtree_root(0, TREE_DEPTH)
    }

    /// Compute root of subtree starting at given index and depth
    fn compute_subtree_root(&self, start_index: u32, depth: usize) -> M31 {
        if depth == 0 {
            return self.get_leaf(start_index);
        }

        let subtree_size = 1u32 << (depth - 1);
        let left_index = start_index;
        let right_index = start_index + subtree_size;

        // Check if subtree is entirely empty
        if start_index >= self.leaf_count {
            return self.empty_roots[depth];
        }

        let left = self.compute_subtree_root(left_index, depth - 1);
        let right = if right_index >= self.leaf_count {
            self.empty_roots[depth - 1]
        } else {
            self.compute_subtree_root(right_index, depth - 1)
        };

        hash2(left, right)
    }

    /// Generate a Merkle path for the given leaf index
    pub fn get_path(&self, index: u32) -> MerklePath {
        let mut siblings = [M31::ZERO; TREE_DEPTH];
        let mut path_bits = [false; TREE_DEPTH];
        let mut current_index = index;

        for i in 0..TREE_DEPTH {
            path_bits[i] = (current_index & 1) == 1;
            
            let sibling_index = current_index ^ 1;
            let depth = TREE_DEPTH - i;
            let subtree_start = sibling_index << i;
            
            siblings[i] = self.compute_subtree_root(subtree_start, i);
            
            current_index >>= 1;
        }

        MerklePath { siblings, path_bits }
    }
}

impl Default for MerkleTree {
    fn default() -> Self {
        Self::new()
    }
}

/// Witness for ZK proof of Merkle membership
#[derive(Clone, Debug)]
pub struct MerkleWitness {
    /// The leaf value (commitment)
    pub leaf: M31,
    /// The Merkle path
    pub path: MerklePath,
}

impl MerkleWitness {
    /// Create a witness from tree and leaf index
    pub fn new(tree: &MerkleTree, index: u32) -> Self {
        Self {
            leaf: tree.get_leaf(index),
            path: tree.get_path(index),
        }
    }

    /// Verify this witness against a root
    pub fn verify(&self, root: M31) -> bool {
        self.path.verify(self.leaf, root)
    }

    /// Get the leaf index
    pub fn leaf_index(&self) -> u32 {
        self.path.leaf_index()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_tree() {
        let tree = MerkleTree::new();
        let root = tree.root();
        
        // Should match precomputed empty root
        assert_eq!(root.value(), empty_tree_root().value());
    }

    #[test]
    fn test_single_leaf() {
        let mut tree = MerkleTree::new();
        let leaf = M31::new(12345);
        let index = tree.insert(leaf);
        
        assert_eq!(index, 0);
        assert_eq!(tree.get_leaf(0).value(), 12345);
    }

    #[test]
    fn test_merkle_path_verification() {
        let mut tree = MerkleTree::new();
        
        // Insert some leaves
        for i in 0..10 {
            tree.insert(M31::new(i * 1000 + 123));
        }
        
        let root = tree.root();
        
        // Verify path for each leaf
        for i in 0..10 {
            let witness = MerkleWitness::new(&tree, i);
            assert!(witness.verify(root), "Path verification failed for leaf {}", i);
        }
    }

    #[test]
    fn test_path_bits() {
        let mut tree = MerkleTree::new();
        
        for i in 0..8 {
            tree.insert(M31::new(i));
        }
        
        // Check that path bits correctly encode the index
        for i in 0..8u32 {
            let path = tree.get_path(i);
            assert_eq!(path.leaf_index(), i);
        }
    }

    #[test]
    fn test_different_roots_for_different_trees() {
        let mut tree1 = MerkleTree::new();
        let mut tree2 = MerkleTree::new();
        
        tree1.insert(M31::new(100));
        tree2.insert(M31::new(200));
        
        assert_ne!(tree1.root().value(), tree2.root().value());
    }
}
