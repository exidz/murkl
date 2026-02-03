//! Benchmarks for Merkle tree operations

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use murkl_prover::merkle::{MerkleTree, MerkleCommitment, hash_bytes, hash_leaf, hash_pair};
use murkl_prover::m31::M31;

fn bench_hash_bytes(c: &mut Criterion) {
    let data = vec![0u8; 64];
    
    c.bench_function("hash_bytes_64", |bench| {
        bench.iter(|| hash_bytes(black_box(&data)))
    });
}

fn bench_hash_leaf(c: &mut Criterion) {
    let value = M31::new(12345);
    
    c.bench_function("hash_leaf", |bench| {
        bench.iter(|| hash_leaf(black_box(value)))
    });
}

fn bench_hash_pair(c: &mut Criterion) {
    let a = hash_bytes(b"left");
    let b = hash_bytes(b"right");
    
    c.bench_function("hash_pair", |bench| {
        bench.iter(|| hash_pair(black_box(&a), black_box(&b)))
    });
}

fn bench_tree_insert(c: &mut Criterion) {
    let mut group = c.benchmark_group("merkle_insert");
    
    for depth in [8, 12, 16, 20] {
        group.bench_with_input(BenchmarkId::new("depth", depth), &depth, |b, &depth| {
            b.iter_with_setup(
                || MerkleTree::new(depth),
                |mut tree| {
                    for i in 0..100 {
                        tree.insert_m31(M31::new(i));
                    }
                    tree
                }
            )
        });
    }
    
    group.finish();
}

fn bench_tree_root(c: &mut Criterion) {
    let mut group = c.benchmark_group("merkle_root");
    
    for num_leaves in [10, 100, 1000] {
        group.bench_with_input(
            BenchmarkId::new("leaves", num_leaves),
            &num_leaves,
            |b, &num_leaves| {
                let mut tree = MerkleTree::new(20);
                for i in 0..num_leaves {
                    tree.insert_m31(M31::new(i));
                }
                
                b.iter(|| black_box(&tree).root())
            }
        );
    }
    
    group.finish();
}

fn bench_tree_get_path(c: &mut Criterion) {
    let mut tree = MerkleTree::new(16);
    for i in 0..1000 {
        tree.insert_m31(M31::new(i));
    }
    
    c.bench_function("merkle_get_path", |bench| {
        bench.iter(|| tree.get_path(black_box(500)))
    });
}

fn bench_path_verify(c: &mut Criterion) {
    let mut tree = MerkleTree::new(16);
    for i in 0..1000 {
        tree.insert_m31(M31::new(i));
    }
    
    let root = tree.root();
    let path = tree.get_path(500);
    let leaf_hash = hash_leaf(M31::new(500));
    
    c.bench_function("merkle_path_verify", |bench| {
        bench.iter(|| path.verify(black_box(&leaf_hash), black_box(&root)))
    });
}

fn bench_commitment_create(c: &mut Criterion) {
    let mut group = c.benchmark_group("merkle_commitment");
    
    for size in [16, 64, 256, 1024] {
        let values: Vec<M31> = (0..size).map(|i| M31::new(i)).collect();
        
        group.bench_with_input(BenchmarkId::new("create", size), &values, |b, values| {
            b.iter(|| MerkleCommitment::commit(black_box(values)))
        });
    }
    
    group.finish();
}

fn bench_commitment_open(c: &mut Criterion) {
    let values: Vec<M31> = (0..1024).map(|i| M31::new(i)).collect();
    let commitment = MerkleCommitment::commit(&values);
    
    c.bench_function("merkle_commitment_open", |bench| {
        bench.iter(|| commitment.open(black_box(512)))
    });
}

fn bench_build_tree(c: &mut Criterion) {
    let mut group = c.benchmark_group("merkle_build_tree");
    
    for size in [16, 64, 256, 1024] {
        let leaves: Vec<_> = (0..size).map(|i| hash_leaf(M31::new(i))).collect();
        
        group.bench_with_input(BenchmarkId::new("size", size), &leaves, |b, leaves| {
            b.iter(|| murkl_prover::merkle::build_tree(black_box(leaves)))
        });
    }
    
    group.finish();
}

fn bench_sparse_tree(c: &mut Criterion) {
    c.bench_function("merkle_sparse_operations", |bench| {
        bench.iter_with_setup(
            || {
                let mut tree = MerkleTree::new(20);
                // Set sparse leaves
                for i in [0, 1000, 5000, 10000, 50000] {
                    tree.set(i, hash_leaf(M31::new(i as u32)));
                }
                tree
            },
            |tree| {
                // Compute root and get paths for sparse leaves
                let root = tree.root();
                for i in [0, 1000, 5000, 10000, 50000] {
                    let path = tree.get_path(i);
                    let _ = path.verify(&hash_leaf(M31::new(i as u32)), &root);
                }
            }
        )
    });
}

criterion_group!(
    benches,
    bench_hash_bytes,
    bench_hash_leaf,
    bench_hash_pair,
    bench_tree_insert,
    bench_tree_root,
    bench_tree_get_path,
    bench_path_verify,
    bench_commitment_create,
    bench_commitment_open,
    bench_build_tree,
    bench_sparse_tree,
);

criterion_main!(benches);
