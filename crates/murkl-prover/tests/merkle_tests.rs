//! Comprehensive tests for Merkle tree operations

use murkl_prover::merkle::{
    MerkleTree, MerklePath, MerkleCommitment,
    hash_pair, hash_leaf, hash_bytes, hash_m31_batch,
    build_tree, TREE_DEPTH, HASH_SIZE, ZERO_HASH,
};
use murkl_prover::m31::M31;

// === Hash function tests ===

#[test]
fn test_hash_deterministic() {
    let data = b"hello world";
    let h1 = hash_bytes(data);
    let h2 = hash_bytes(data);
    
    assert_eq!(h1, h2, "Hash should be deterministic");
}

#[test]
fn test_hash_different_inputs() {
    let h1 = hash_bytes(b"hello");
    let h2 = hash_bytes(b"world");
    
    assert_ne!(h1, h2, "Different inputs should produce different hashes");
}

#[test]
fn test_hash_size() {
    let h = hash_bytes(b"test");
    assert_eq!(h.len(), HASH_SIZE);
}

#[test]
fn test_hash_leaf() {
    let v = M31::new(12345);
    let h = hash_leaf(v);
    
    // Hash should be deterministic
    assert_eq!(h, hash_leaf(M31::new(12345)));
    
    // Different values should hash differently
    assert_ne!(h, hash_leaf(M31::new(67890)));
}

#[test]
fn test_hash_pair() {
    let a = hash_bytes(b"left");
    let b = hash_bytes(b"right");
    
    let h = hash_pair(&a, &b);
    
    // Should be deterministic
    assert_eq!(h, hash_pair(&a, &b));
    
    // Order matters
    assert_ne!(hash_pair(&a, &b), hash_pair(&b, &a));
}

#[test]
fn test_hash_m31_batch() {
    let values = vec![M31::new(1), M31::new(2), M31::new(3)];
    let h = hash_m31_batch(&values);
    
    // Deterministic
    assert_eq!(h, hash_m31_batch(&values));
    
    // Different from individual hashes
    assert_ne!(h, hash_leaf(M31::new(1)));
    
    // Different order = different hash
    let values_rev = vec![M31::new(3), M31::new(2), M31::new(1)];
    assert_ne!(h, hash_m31_batch(&values_rev));
}

// === MerklePath tests ===

#[test]
fn test_merkle_path_depth() {
    let path = MerklePath::new(0, 10);
    assert_eq!(path.depth(), 10);
}

#[test]
fn test_merkle_path_compute_root() {
    let mut tree = MerkleTree::new(4);
    let value = M31::new(42);
    let index = tree.insert_m31(value);
    
    let path = tree.get_path(index);
    let leaf_hash = hash_leaf(value);
    
    let computed = path.compute_root(&leaf_hash);
    let expected = tree.root();
    
    assert_eq!(computed, expected);
}

#[test]
fn test_merkle_path_verify_valid() {
    let mut tree = MerkleTree::new(4);
    let value = M31::new(12345);
    let index = tree.insert_m31(value);
    
    let root = tree.root();
    let path = tree.get_path(index);
    let leaf_hash = hash_leaf(value);
    
    assert!(path.verify(&leaf_hash, &root));
}

#[test]
fn test_merkle_path_verify_invalid_leaf() {
    let mut tree = MerkleTree::new(4);
    let value = M31::new(12345);
    let index = tree.insert_m31(value);
    
    let root = tree.root();
    let path = tree.get_path(index);
    
    // Wrong leaf hash
    let wrong_hash = hash_leaf(M31::new(99999));
    assert!(!path.verify(&wrong_hash, &root));
}

#[test]
fn test_merkle_path_verify_invalid_root() {
    let mut tree = MerkleTree::new(4);
    let value = M31::new(12345);
    let index = tree.insert_m31(value);
    
    let path = tree.get_path(index);
    let leaf_hash = hash_leaf(value);
    
    // Wrong root
    let wrong_root = hash_bytes(b"wrong");
    assert!(!path.verify(&leaf_hash, &wrong_root));
}

// === MerkleTree tests ===

#[test]
fn test_tree_creation() {
    let tree = MerkleTree::new(10);
    
    assert_eq!(tree.depth(), 10);
    assert_eq!(tree.leaf_count(), 0);
    assert_eq!(tree.capacity(), 1024);
}

#[test]
fn test_tree_default_depth() {
    let tree = MerkleTree::with_default_depth();
    assert_eq!(tree.depth(), TREE_DEPTH);
}

#[test]
fn test_empty_tree_root() {
    let tree1 = MerkleTree::new(4);
    let tree2 = MerkleTree::new(4);
    
    // Empty trees should have same root
    assert_eq!(tree1.root(), tree2.root());
}

#[test]
fn test_insert_increments_count() {
    let mut tree = MerkleTree::new(4);
    
    assert_eq!(tree.leaf_count(), 0);
    
    tree.insert_m31(M31::new(1));
    assert_eq!(tree.leaf_count(), 1);
    
    tree.insert_m31(M31::new(2));
    assert_eq!(tree.leaf_count(), 2);
}

#[test]
fn test_insert_returns_index() {
    let mut tree = MerkleTree::new(4);
    
    let idx1 = tree.insert_m31(M31::new(1));
    let idx2 = tree.insert_m31(M31::new(2));
    let idx3 = tree.insert_m31(M31::new(3));
    
    assert_eq!(idx1, 0);
    assert_eq!(idx2, 1);
    assert_eq!(idx3, 2);
}

#[test]
fn test_get_leaf() {
    let mut tree = MerkleTree::new(4);
    let value = M31::new(12345);
    let expected_hash = hash_leaf(value);
    
    let index = tree.insert_m31(value);
    
    assert_eq!(tree.get_leaf(index), expected_hash);
}

#[test]
fn test_get_empty_leaf() {
    let tree = MerkleTree::new(4);
    
    // Getting an unset leaf should return empty hash
    let empty = tree.get_leaf(0);
    assert_eq!(empty, hash_bytes(&[]));
}

#[test]
fn test_set_specific_index() {
    let mut tree = MerkleTree::new(4);
    
    let hash1 = hash_leaf(M31::new(100));
    let hash2 = hash_leaf(M31::new(200));
    
    tree.set(5, hash1);
    tree.set(10, hash2);
    
    assert_eq!(tree.get_leaf(5), hash1);
    assert_eq!(tree.get_leaf(10), hash2);
    assert_eq!(tree.leaf_count(), 11); // 0..=10
}

#[test]
fn test_different_trees_different_roots() {
    let mut tree1 = MerkleTree::new(4);
    let mut tree2 = MerkleTree::new(4);
    
    tree1.insert_m31(M31::new(100));
    tree2.insert_m31(M31::new(200));
    
    assert_ne!(tree1.root(), tree2.root());
}

#[test]
fn test_root_changes_on_insert() {
    let mut tree = MerkleTree::new(4);
    
    let root1 = tree.root();
    tree.insert_m31(M31::new(1));
    let root2 = tree.root();
    tree.insert_m31(M31::new(2));
    let root3 = tree.root();
    
    assert_ne!(root1, root2);
    assert_ne!(root2, root3);
    assert_ne!(root1, root3);
}

#[test]
fn test_path_verification_all_leaves() {
    let mut tree = MerkleTree::new(4);
    
    // Insert multiple leaves
    for i in 0..10 {
        tree.insert_m31(M31::new(i * 1000 + 123));
    }
    
    let root = tree.root();
    
    // Verify path for each leaf
    for i in 0..10 {
        let value = M31::new(i * 1000 + 123);
        let leaf_hash = hash_leaf(value);
        let path = tree.get_path(i as usize);
        
        assert!(
            path.verify(&leaf_hash, &root),
            "Path verification failed for leaf {}",
            i
        );
    }
}

#[test]
fn test_verify_method() {
    let mut tree = MerkleTree::new(4);
    let value = M31::new(42);
    let index = tree.insert_m31(value);
    let leaf_hash = hash_leaf(value);
    
    assert!(tree.verify(index, &leaf_hash));
    
    // Wrong hash should fail
    let wrong_hash = hash_leaf(M31::new(999));
    assert!(!tree.verify(index, &wrong_hash));
}

// === Large tree tests ===

#[test]
fn test_large_tree() {
    let mut tree = MerkleTree::new(10); // 1024 leaves
    
    // Insert 500 leaves
    for i in 0..500 {
        tree.insert_m31(M31::new(i));
    }
    
    let root = tree.root();
    
    // Verify some paths
    for i in [0, 100, 250, 499] {
        let value = M31::new(i as u32);
        let leaf_hash = hash_leaf(value);
        let path = tree.get_path(i);
        assert!(path.verify(&leaf_hash, &root));
    }
}

#[test]
fn test_sparse_tree() {
    let mut tree = MerkleTree::new(10);
    
    // Set leaves at sparse positions
    tree.set(0, hash_leaf(M31::new(0)));
    tree.set(100, hash_leaf(M31::new(100)));
    tree.set(500, hash_leaf(M31::new(500)));
    tree.set(999, hash_leaf(M31::new(999)));
    
    let root = tree.root();
    
    // Verify each path
    for idx in [0, 100, 500, 999] {
        let path = tree.get_path(idx);
        let leaf_hash = hash_leaf(M31::new(idx as u32));
        assert!(path.verify(&leaf_hash, &root));
    }
}

// === build_tree tests ===

#[test]
fn test_build_tree_empty() {
    let (root, tree) = build_tree(&[]);
    assert_eq!(root, ZERO_HASH);
    assert!(tree.is_empty());
}

#[test]
fn test_build_tree_single() {
    let leaf = hash_leaf(M31::new(42));
    let (root, tree) = build_tree(&[leaf]);
    
    // Single leaf means root = leaf (after potential padding)
    assert!(!tree.is_empty());
}

#[test]
fn test_build_tree_power_of_two() {
    let leaves: Vec<_> = (0..8).map(|i| hash_leaf(M31::new(i))).collect();
    let (root, tree) = build_tree(&leaves);
    
    // Tree should have 4 levels: 8 -> 4 -> 2 -> 1
    assert_eq!(tree.len(), 4);
    assert_eq!(tree[0].len(), 8);
    assert_eq!(tree[1].len(), 4);
    assert_eq!(tree[2].len(), 2);
    assert_eq!(tree[3].len(), 1);
    assert_eq!(tree[3][0], root);
}

#[test]
fn test_build_tree_non_power_of_two() {
    let leaves: Vec<_> = (0..5).map(|i| hash_leaf(M31::new(i))).collect();
    let (root, tree) = build_tree(&leaves);
    
    // Should be padded to 8
    assert_eq!(tree[0].len(), 8);
}

// === MerkleCommitment tests ===

#[test]
fn test_commitment_creation() {
    let values: Vec<M31> = (0..16).map(|i| M31::new(i)).collect();
    let commitment = MerkleCommitment::commit(&values);
    
    // Root should exist
    assert_ne!(commitment.root(), ZERO_HASH);
}

#[test]
fn test_commitment_open() {
    let values: Vec<M31> = (0..16).map(|i| M31::new(i * 10)).collect();
    let commitment = MerkleCommitment::commit(&values);
    
    // Open at each index
    for i in 0..16 {
        let opening = commitment.open(i);
        assert!(opening.is_some());
        
        let (value, path) = opening.unwrap();
        assert_eq!(value.value(), (i * 10) as u32);
        
        // Path should verify
        let leaf_hash = hash_leaf(value);
        assert!(path.verify(&leaf_hash, &commitment.root()));
    }
}

#[test]
fn test_commitment_open_out_of_bounds() {
    let values: Vec<M31> = (0..8).map(|i| M31::new(i)).collect();
    let commitment = MerkleCommitment::commit(&values);
    
    let opening = commitment.open(100);
    assert!(opening.is_none());
}

#[test]
fn test_commitment_verify_opening() {
    let values: Vec<M31> = (0..8).map(|i| M31::new(i * 100)).collect();
    let commitment = MerkleCommitment::commit(&values);
    
    let (value, path) = commitment.open(3).unwrap();
    
    assert!(commitment.verify_opening(3, value, &path));
    
    // Wrong index should fail
    assert!(!commitment.verify_opening(5, value, &path));
    
    // Wrong value should fail
    assert!(!commitment.verify_opening(3, M31::new(9999), &path));
}

#[test]
fn test_commitment_root_only() {
    let values: Vec<M31> = (0..16).map(|i| M31::new(i)).collect();
    
    let full = MerkleCommitment::commit(&values);
    let root_only = MerkleCommitment::commit_root_only(&values);
    
    // Roots should match
    assert_eq!(full.root(), root_only.root());
    
    // Root-only can't open
    assert!(root_only.open(0).is_none());
}

// === Edge cases ===

#[test]
fn test_zero_depth_tree() {
    let tree = MerkleTree::new(0);
    assert_eq!(tree.capacity(), 1);
}

#[test]
fn test_single_leaf_tree() {
    let mut tree = MerkleTree::new(1);
    let value = M31::new(42);
    tree.insert_m31(value);
    
    let path = tree.get_path(0);
    assert_eq!(path.depth(), 1);
    
    let leaf_hash = hash_leaf(value);
    assert!(path.verify(&leaf_hash, &tree.root()));
}

#[test]
fn test_consecutive_updates() {
    let mut tree = MerkleTree::new(4);
    
    // Insert and immediately verify
    for i in 0..10 {
        let value = M31::new(i);
        let index = tree.insert_m31(value);
        let root = tree.root();
        let path = tree.get_path(index);
        let leaf_hash = hash_leaf(value);
        
        assert!(path.verify(&leaf_hash, &root));
    }
}
