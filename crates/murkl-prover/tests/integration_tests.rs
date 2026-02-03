//! Integration tests for the complete prover system

use murkl_prover::prelude::*;
use murkl_prover::air::{ConstraintEvaluator, FibonacciAir, MurklAir, Trace, TraceColumn, verify_constraints};
use murkl_prover::fri::{FriConfig, FriProver, FriVerifier, evaluate_polynomial};
use murkl_prover::prover::{Prover, ProverConfig, Transcript};
use murkl_prover::verifier::Verifier;
use murkl_prover::types::{PublicInputs, Witness, MurklClaim, MurklPublicInputs, MurklWitness};

// === Fibonacci proof tests ===

#[test]
fn test_fibonacci_trace_generation() {
    let air = FibonacciAir::new(64);
    let trace = air.generate_trace(M31::ONE, M31::ONE);
    
    assert_eq!(trace.num_rows, 64);
    assert_eq!(trace.num_columns(), 1);
    
    // Check Fibonacci sequence
    assert_eq!(trace.get(0, 0).value(), 1);
    assert_eq!(trace.get(1, 0).value(), 1);
    assert_eq!(trace.get(2, 0).value(), 2);
    assert_eq!(trace.get(3, 0).value(), 3);
    assert_eq!(trace.get(4, 0).value(), 5);
}

#[test]
fn test_fibonacci_constraints_pass() {
    let air = FibonacciAir::new(32);
    let trace = air.generate_trace(M31::ONE, M31::ONE);
    
    let result = verify_constraints(&air, &trace);
    assert!(result.is_ok(), "Fibonacci constraints should pass");
}

#[test]
fn test_fibonacci_constraints_fail_wrong_trace() {
    let air = FibonacciAir::new(16);
    
    // Create invalid trace (linear sequence, not Fibonacci)
    let values: Vec<M31> = (0..16).map(|i| M31::new(i)).collect();
    let trace = Trace::new(vec![TraceColumn::new(0, values)]);
    
    let result = verify_constraints(&air, &trace);
    assert!(result.is_err(), "Invalid trace should fail");
}

#[test]
fn test_fibonacci_proof_generation() {
    let config = ProverConfig::fast();
    let prover = Prover::new(config);
    
    let air = FibonacciAir::new(64);
    let trace = air.generate_trace(M31::ONE, M31::ONE);
    
    let public_inputs = PublicInputs {
        initial_state: vec![M31::ONE, M31::ONE],
        final_state: vec![trace.get(63, 0)],
    };
    
    let result = prover.prove(&air, &trace, public_inputs);
    assert!(result.is_ok());
    
    let proof = result.unwrap();
    assert!(!proof.trace_commitment.is_empty());
    assert!(!proof.query_proofs.is_empty());
}

#[test]
fn test_fibonacci_proof_verification() {
    let config = ProverConfig::fast();
    let prover = Prover::new(config.clone());
    let verifier = Verifier::new(config);
    
    let air = FibonacciAir::new(32);
    let trace = air.generate_trace(M31::ONE, M31::ONE);
    
    let public_inputs = PublicInputs {
        initial_state: vec![M31::ONE],
        final_state: vec![trace.get(31, 0)],
    };
    
    let proof = prover.prove(&air, &trace, public_inputs).unwrap();
    
    // Quick verification should pass
    let result = verifier.quick_verify(&proof);
    assert!(result.is_ok());
}

// === FRI protocol tests ===

#[test]
fn test_fri_commit_and_fold() {
    let config = FriConfig::default();
    let mut prover = FriProver::new(config);
    
    // Create polynomial evaluations
    let evals: Vec<M31> = (0..64).map(|i| M31::new(i * i % 1000)).collect();
    prover.commit(evals, 6);
    
    // Fold with a random coefficient
    prover.fold(M31::new(7));
    
    // Generate proof
    let proof = prover.prove(&[0, 10, 30]);
    
    assert!(!proof.layer_commitments.is_empty());
    assert_eq!(proof.query_proofs.len(), 3);
}

#[test]
fn test_polynomial_evaluation() {
    // p(x) = 1 + 2x + 3x^2
    let coeffs = vec![M31::new(1), M31::new(2), M31::new(3)];
    
    assert_eq!(evaluate_polynomial(&coeffs, M31::ZERO).value(), 1);
    assert_eq!(evaluate_polynomial(&coeffs, M31::ONE).value(), 6);
    assert_eq!(evaluate_polynomial(&coeffs, M31::new(2)).value(), 17);
    assert_eq!(evaluate_polynomial(&coeffs, M31::new(3)).value(), 34);
}

// === Transcript (Fiat-Shamir) tests ===

#[test]
fn test_transcript_determinism() {
    let mut t1 = Transcript::new();
    let mut t2 = Transcript::new();
    
    // Same operations should produce same results
    t1.append_m31(M31::new(42));
    t2.append_m31(M31::new(42));
    
    let c1 = t1.challenge_scalar();
    let c2 = t2.challenge_scalar();
    
    assert_eq!(c1.value(), c2.value());
}

#[test]
fn test_transcript_different_inputs() {
    let mut t1 = Transcript::new();
    let mut t2 = Transcript::new();
    
    t1.append_m31(M31::new(1));
    t2.append_m31(M31::new(2));
    
    let c1 = t1.challenge_scalar();
    let c2 = t2.challenge_scalar();
    
    assert_ne!(c1.value(), c2.value());
}

#[test]
fn test_transcript_challenge_indices_unique() {
    let mut transcript = Transcript::new();
    let indices = transcript.challenge_indices(20, 100);
    
    // Check uniqueness
    let mut sorted = indices.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), indices.len());
    
    // Check bounds
    for &idx in &indices {
        assert!(idx < 100);
    }
}

// === Merkle integration tests ===

#[test]
fn test_merkle_commitment_flow() {
    let values: Vec<M31> = (0..32).map(|i| M31::new(i * 100)).collect();
    let commitment = murkl_prover::merkle::MerkleCommitment::commit(&values);
    
    // Open multiple indices and verify
    for i in 0..32 {
        let (value, path) = commitment.open(i).unwrap();
        assert!(commitment.verify_opening(i, value, &path));
    }
}

#[test]
fn test_merkle_tree_proof_flow() {
    let mut tree = MerkleTree::new(6);
    
    // Insert leaves
    let test_values: Vec<M31> = (0..50).map(|i| M31::new(i * i)).collect();
    for &val in &test_values {
        tree.insert_m31(val);
    }
    
    let root = tree.root();
    
    // Verify all paths
    for (i, &val) in test_values.iter().enumerate() {
        let path = tree.get_path(i);
        let leaf_hash = murkl_prover::merkle::hash_leaf(val);
        assert!(path.verify(&leaf_hash, &root), "Path failed for index {}", i);
    }
}

// === Circle group integration tests ===

#[test]
fn test_domain_fft_compatibility() {
    let log_size = 5;
    let domain = murkl_prover::circle::compute_domain(log_size);
    let twiddles = murkl_prover::circle::compute_twiddles(log_size);
    
    assert_eq!(domain.len(), 32);
    assert_eq!(twiddles.len(), 32);
    
    // All points on circle
    for p in &domain {
        assert!(p.is_on_circle());
    }
}

#[test]
fn test_coset_for_lde() {
    use murkl_prover::circle::Coset;
    
    // LDE typically uses a shifted coset
    let shift = CIRCLE_GENERATOR.mul(3);
    let coset = Coset::shifted(4, shift);
    
    assert_eq!(coset.size(), 16);
    
    // All coset points should be on circle
    for p in coset.iter() {
        assert!(p.is_on_circle());
    }
}

// === Murkl-specific tests ===

#[test]
fn test_murkl_witness_creation() {
    let witness = MurklWitness::new(16);
    
    assert_eq!(witness.siblings.len(), 16);
    assert_eq!(witness.path_bits.len(), 16);
    assert!(witness.leaf.is_zero());
}

#[test]
fn test_murkl_public_inputs_conversion() {
    let murkl_inputs = MurklPublicInputs {
        merkle_root: M31::new(12345),
        nullifier: M31::new(67890),
        recipient: M31::new(11111),
    };
    
    let public_inputs = murkl_inputs.to_public_inputs();
    
    assert_eq!(public_inputs.initial_state.len(), 1);
    assert_eq!(public_inputs.initial_state[0].value(), 12345);
    assert_eq!(public_inputs.final_state.len(), 2);
}

#[test]
fn test_murkl_air_constraint_count() {
    let air = MurklAir::new(16);
    let constraints = air.constraints();
    
    // Should have 16 boolean constraints + 1 secret consistency
    assert_eq!(constraints.len(), 17);
}

// === End-to-end tests ===

#[test]
fn test_end_to_end_fibonacci() {
    // 1. Generate trace
    let air = FibonacciAir::new(128);
    let trace = air.generate_trace(M31::new(1), M31::new(2));
    
    // 2. Verify constraints
    let constraint_result = verify_constraints(&air, &trace);
    assert!(constraint_result.is_ok());
    
    // 3. Generate proof
    let config = ProverConfig::fast();
    let prover = Prover::new(config.clone());
    
    let public_inputs = PublicInputs::new(
        vec![M31::new(1), M31::new(2)],
        vec![trace.get(127, 0)],
    );
    
    let proof = prover.prove(&air, &trace, public_inputs).unwrap();
    
    // 4. Verify proof structure
    let verifier = Verifier::new(config);
    assert!(verifier.quick_verify(&proof).is_ok());
    
    // 5. Check proof size is reasonable
    assert!(proof.size() < 100_000, "Proof should be reasonably small");
}

#[test]
fn test_end_to_end_different_fibonacci_inputs() {
    let air = FibonacciAir::new(64);
    let config = ProverConfig::fast();
    let prover = Prover::new(config.clone());
    let verifier = Verifier::new(config);
    
    // Test with different starting values
    let test_cases = [
        (M31::new(1), M31::new(1)),
        (M31::new(0), M31::new(1)),
        (M31::new(2), M31::new(3)),
        (M31::new(5), M31::new(8)),
    ];
    
    for (a, b) in test_cases {
        let trace = air.generate_trace(a, b);
        
        let public_inputs = PublicInputs::new(
            vec![a, b],
            vec![trace.get(63, 0)],
        );
        
        let proof = prover.prove(&air, &trace, public_inputs).unwrap();
        assert!(verifier.quick_verify(&proof).is_ok());
    }
}

#[test]
fn test_proof_serialization_roundtrip() {
    let config = ProverConfig::fast();
    let prover = Prover::new(config);
    
    let air = FibonacciAir::new(32);
    let trace = air.generate_trace(M31::ONE, M31::ONE);
    
    let public_inputs = PublicInputs::new(
        vec![M31::ONE],
        vec![trace.get(31, 0)],
    );
    
    let proof = prover.prove(&air, &trace, public_inputs).unwrap();
    
    // Serialize to bytes
    let bytes = proof.to_bytes();
    
    // Basic checks on serialized data
    assert!(!bytes.is_empty());
    assert!(bytes.len() > 32); // At least one hash
}

#[test]
fn test_witness_with_aux_data() {
    let values = vec![M31::new(1), M31::new(2), M31::new(3)];
    let aux_data = vec![0xDE, 0xAD, 0xBE, 0xEF];
    
    let witness = Witness::with_aux(values, aux_data.clone());
    
    assert_eq!(witness.values.len(), 3);
    assert_eq!(witness.aux_data, Some(aux_data));
}

// === Stress tests ===

#[test]
fn test_large_trace() {
    let air = FibonacciAir::new(1024);
    let trace = air.generate_trace(M31::ONE, M31::ONE);
    
    assert_eq!(trace.num_rows, 1024);
    
    // Verify a few constraints
    for i in [0, 100, 500, 1000] {
        let evals = air.evaluate(&trace, i);
        assert!(evals[0].is_zero(), "Constraint should be satisfied at row {}", i);
    }
}

#[test]
fn test_many_merkle_insertions() {
    let mut tree = MerkleTree::new(12); // 4096 capacity
    
    // Insert 1000 leaves
    for i in 0..1000u32 {
        tree.insert_m31(M31::new(i));
    }
    
    let root = tree.root();
    
    // Verify random sample of paths
    for i in [0, 123, 456, 789, 999] {
        let path = tree.get_path(i);
        let leaf_hash = murkl_prover::merkle::hash_leaf(M31::new(i as u32));
        assert!(path.verify(&leaf_hash, &root));
    }
}
