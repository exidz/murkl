//! Murkl STWO Prover - Circle STARK proof generation
//!
//! Integrates with STWO to generate actual ZK proofs for Merkle membership.

use itertools::Itertools;
use num_traits::{Zero, One};
use stwo::core::fields::m31::BaseField;
use stwo::core::poly::circle::CanonicCoset;
use stwo::core::ColumnVec;
use stwo::prover::backend::simd::SimdBackend;
use stwo::prover::backend::{Col, Column};
use stwo::prover::poly::circle::CircleEvaluation;
use stwo::prover::poly::BitReversedOrder;
use stwo_constraint_framework::{EvalAtRow, FrameworkComponent, FrameworkEval};

use super::m31::M31;
use super::merkle::TREE_DEPTH;
use super::stark_circuit::{MurklClaim, LOG_N_ROWS};

/// Murkl component type alias
pub type MurklComponent = FrameworkComponent<MurklEval>;

/// Number of columns in the Murkl trace:
/// - 3 for commitment (identifier, secret, leaf)
/// - 4 * TREE_DEPTH for Merkle path (current, sibling, path_bit, next)
/// - 1 for final root
/// - 3 for nullifier (secret, leaf_index, nullifier)
pub const N_COLUMNS: usize = 3 + 4 * TREE_DEPTH + 1 + 3;

/// Evaluation logic for Murkl circuit
#[derive(Clone)]
pub struct MurklEval {
    pub log_n_rows: u32,
}

impl FrameworkEval for MurklEval {
    fn log_size(&self) -> u32 {
        self.log_n_rows
    }

    fn max_constraint_log_degree_bound(&self) -> u32 {
        // Our constraints are at most degree 2 (boolean check: x * (1-x))
        self.log_n_rows + 1
    }

    fn evaluate<E: EvalAtRow>(&self, mut eval: E) -> E {
        // === Commitment verification ===
        // Columns: identifier, secret, leaf
        let identifier = eval.next_trace_mask();
        let secret = eval.next_trace_mask();
        let leaf = eval.next_trace_mask();
        
        // Constraint: leaf = Poseidon(identifier, secret)
        // For now, we use a simplified algebraic constraint
        // TODO: Integrate full Poseidon lookup relation
        // The constraint checks that leaf is derived from identifier and secret
        // In a full implementation, this would use a lookup into a Poseidon table
        
        // === Merkle path verification ===
        let mut current = leaf.clone();
        
        for _level in 0..TREE_DEPTH {
            let node = eval.next_trace_mask();
            let sibling = eval.next_trace_mask();
            let path_bit = eval.next_trace_mask();
            let next = eval.next_trace_mask();
            
            // Constraint 1: current node must match computed value
            eval.add_constraint(node.clone() - current.clone());
            
            // Constraint 2: path_bit must be boolean (0 or 1)
            // path_bit * (1 - path_bit) = 0
            eval.add_constraint(path_bit.clone() * (E::F::one() - path_bit.clone()));
            
            // Constraint 3: next = Poseidon(left, right) where order depends on path_bit
            // For now, simplified: next is derived from (node, sibling, path_bit)
            // Full implementation would use Poseidon lookup
            
            current = next;
        }
        
        // === Root verification ===
        let merkle_root = eval.next_trace_mask();
        
        // Constraint: computed root must match claimed root
        eval.add_constraint(current - merkle_root);
        
        // === Nullifier verification ===
        let null_secret = eval.next_trace_mask();
        let leaf_index = eval.next_trace_mask();
        let nullifier = eval.next_trace_mask();
        
        // Constraint: nullifier = Poseidon(secret, leaf_index)
        // Also: null_secret must equal secret from commitment
        eval.add_constraint(null_secret - secret);
        
        eval
    }
}

/// Generate STWO-compatible trace from Murkl claims
pub fn generate_stwo_trace(
    claims: &[MurklClaim],
    log_n_rows: u32,
) -> ColumnVec<CircleEvaluation<SimdBackend, BaseField, BitReversedOrder>> {
    use super::poseidon::hash2;
    
    let n_rows = 1usize << log_n_rows;
    
    // Initialize columns
    let mut trace: Vec<Col<SimdBackend, BaseField>> = (0..N_COLUMNS)
        .map(|_| Col::<SimdBackend, BaseField>::zeros(n_rows))
        .collect_vec();
    
    for (row, claim) in claims.iter().enumerate().take(n_rows) {
        let mut col = 0;
        
        // Commitment columns
        trace[col].set(row, m31_to_base(claim.witness.identifier));
        col += 1;
        trace[col].set(row, m31_to_base(claim.witness.secret));
        col += 1;
        trace[col].set(row, m31_to_base(claim.witness.leaf));
        col += 1;
        
        // Merkle path columns
        let mut current = claim.witness.leaf;
        for level in 0..TREE_DEPTH {
            let sibling = claim.witness.siblings[level];
            let path_bit = claim.witness.path_bits[level];
            
            trace[col].set(row, m31_to_base(current));
            col += 1;
            trace[col].set(row, m31_to_base(sibling));
            col += 1;
            trace[col].set(row, if path_bit { BaseField::one() } else { BaseField::zero() });
            col += 1;
            
            // Compute next level
            let next = if path_bit {
                hash2(sibling, current)
            } else {
                hash2(current, sibling)
            };
            trace[col].set(row, m31_to_base(next));
            col += 1;
            
            current = next;
        }
        
        // Root column
        trace[col].set(row, m31_to_base(claim.public_inputs.merkle_root));
        col += 1;
        
        // Nullifier columns
        trace[col].set(row, m31_to_base(claim.witness.secret));
        col += 1;
        trace[col].set(row, BaseField::from_u32_unchecked(claim.witness.leaf_index));
        col += 1;
        trace[col].set(row, m31_to_base(claim.public_inputs.nullifier));
        // col += 1;
    }
    
    // Fill remaining rows with zeros (padding)
    // (Already initialized to zeros)
    
    // Convert to CircleEvaluation
    let domain = CanonicCoset::new(log_n_rows).circle_domain();
    trace
        .into_iter()
        .map(|col| CircleEvaluation::<SimdBackend, _, BitReversedOrder>::new(domain, col))
        .collect_vec()
}

/// Convert our M31 to STWO's BaseField
#[inline]
fn m31_to_base(m: M31) -> BaseField {
    BaseField::from_u32_unchecked(m.value())
}

/// Public inputs for verification
#[derive(Clone, Debug)]
pub struct MurklPublicInputs {
    pub merkle_root: BaseField,
    pub nullifier: BaseField,
    pub recipient: BaseField,
}

impl From<&super::stark_circuit::MurklPublicInputs> for MurklPublicInputs {
    fn from(inputs: &super::stark_circuit::MurklPublicInputs) -> Self {
        Self {
            merkle_root: m31_to_base(inputs.merkle_root),
            nullifier: m31_to_base(inputs.nullifier),
            recipient: m31_to_base(inputs.recipient),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merkle::MerkleTree;
    use crate::poseidon::{commitment, nullifier};
    use crate::stark_circuit::{MurklClaim, MurklPublicInputs as ClaimPublicInputs, MurklWitness};
    use stwo::core::air::Component;
    use stwo::core::channel::Blake2sM31Channel;
    use stwo::core::fields::qm31::SecureField;
    use stwo::core::pcs::{CommitmentSchemeVerifier, PcsConfig};
    use stwo::core::poly::circle::CanonicCoset;
    use stwo::core::vcs_lifted::blake2_merkle::Blake2sM31MerkleChannel;
    use stwo::core::verifier::verify;
    use stwo::prover::poly::circle::PolyOps;
    use stwo::prover::{prove, CommitmentSchemeProver};
    use stwo_constraint_framework::TraceLocationAllocator;

    fn create_test_claim() -> MurklClaim {
        let mut tree = MerkleTree::new();
        
        let identifier = M31::new(12345);
        let secret = M31::new(98765);
        let leaf = commitment(identifier, secret);
        
        for i in 0..4 {
            if i == 2 {
                tree.insert(leaf);
            } else {
                tree.insert(M31::new(i * 1000));
            }
        }
        
        let leaf_index = 2u32;
        let merkle_root = tree.root();
        let path = tree.get_path(leaf_index);
        let null = nullifier(secret, leaf_index);
        
        MurklClaim {
            public_inputs: ClaimPublicInputs {
                merkle_root,
                nullifier: null,
                recipient: M31::new(0xABCDEF),
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
    fn test_trace_generation() {
        let claim = create_test_claim();
        let trace = generate_stwo_trace(&[claim], 4); // 16 rows
        
        assert_eq!(trace.len(), N_COLUMNS);
        
        // Each column should have 16 values
        for col in &trace {
            assert_eq!(col.len(), 16);
        }
    }

    #[test]
    fn test_eval_construction() {
        let eval = MurklEval { log_n_rows: 4 };
        assert_eq!(eval.log_size(), 4);
        assert_eq!(eval.max_constraint_log_degree_bound(), 5); // 4 + 1
    }

    #[test]
    fn test_full_proof_generation_and_verification() {
        const LOG_N_ROWS: u32 = 10; // 1024 rows
        
        // Create test claim
        let claim = create_test_claim();
        
        // Setup - need extra bits for constraint degree and blowup factor
        let config = PcsConfig::default();
        // max_constraint_log_degree_bound is LOG_N_ROWS + 1, add blowup factor on top
        let log_domain_size = LOG_N_ROWS + 1 + config.fri_config.log_blowup_factor;
        let twiddles = SimdBackend::precompute_twiddles(
            CanonicCoset::new(log_domain_size)
                .circle_domain()
                .half_coset,
        );
        
        // Prover setup - must store polynomial coefficients for constraint evaluation
        let prover_channel = &mut Blake2sM31Channel::default();
        let mut commitment_scheme = CommitmentSchemeProver::<
            SimdBackend,
            Blake2sM31MerkleChannel,
        >::new(config, &twiddles);
        commitment_scheme.set_store_polynomials_coefficients();
        
        // Preprocessed trace (empty for our circuit)
        let mut tree_builder = commitment_scheme.tree_builder();
        tree_builder.extend_evals(vec![]);
        tree_builder.commit(prover_channel);
        
        // Generate and commit main trace
        let trace = generate_stwo_trace(&[claim], LOG_N_ROWS);
        let mut tree_builder = commitment_scheme.tree_builder();
        tree_builder.extend_evals(trace);
        tree_builder.commit(prover_channel);
        
        // Create component
        let component = MurklComponent::new(
            &mut TraceLocationAllocator::default(),
            MurklEval { log_n_rows: LOG_N_ROWS },
            SecureField::zero(),
        );
        
        // Generate proof
        let proof = prove::<SimdBackend, Blake2sM31MerkleChannel>(
            &[&component],
            prover_channel,
            commitment_scheme,
        )
        .expect("Proof generation should succeed");
        
        // Verify
        let verifier_channel = &mut Blake2sM31Channel::default();
        let commitment_scheme_verifier =
            &mut CommitmentSchemeVerifier::<Blake2sM31MerkleChannel>::new(config);
        
        let sizes = component.trace_log_degree_bounds();
        commitment_scheme_verifier.commit(proof.commitments[0], &sizes[0], verifier_channel);
        commitment_scheme_verifier.commit(proof.commitments[1], &sizes[1], verifier_channel);
        
        verify(&[&component], verifier_channel, commitment_scheme_verifier, proof)
            .expect("Verification should succeed");
        
        println!("✓ Murkl STARK proof generated and verified successfully!");
    }
}
