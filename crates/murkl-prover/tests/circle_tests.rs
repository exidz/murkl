//! Comprehensive tests for Circle group operations

use murkl_prover::circle::{
    CirclePoint, CIRCLE_GENERATOR, CIRCLE_ORDER, LOG_CIRCLE_ORDER,
    subgroup_generator, compute_domain, compute_twiddles, Coset, CircleDomain,
};
use murkl_prover::m31::M31;

#[test]
fn test_identity_on_circle() {
    let id = CirclePoint::IDENTITY;
    
    assert!(id.is_on_circle(), "Identity should be on circle");
    assert_eq!(id.x.value(), 1);
    assert_eq!(id.y.value(), 0);
}

#[test]
fn test_generator_on_circle() {
    let g = CIRCLE_GENERATOR;
    
    assert!(g.is_on_circle(), "Generator should be on circle");
    
    // Verify x² + y² = 1
    let x2 = g.x.square();
    let y2 = g.y.square();
    let sum = x2 + y2;
    assert_eq!(sum.value(), 1, "x² + y² should be 1");
}

#[test]
fn test_add_identity() {
    let g = CIRCLE_GENERATOR;
    let id = CirclePoint::IDENTITY;
    
    // g + id = g
    let result1 = g.add(id);
    assert_eq!(result1.x.value(), g.x.value());
    assert_eq!(result1.y.value(), g.y.value());
    
    // id + g = g
    let result2 = id.add(g);
    assert_eq!(result2.x.value(), g.x.value());
    assert_eq!(result2.y.value(), g.y.value());
    
    // id + id = id
    let result3 = id.add(id);
    assert_eq!(result3.x.value(), id.x.value());
    assert_eq!(result3.y.value(), id.y.value());
}

#[test]
fn test_inverse() {
    let g = CIRCLE_GENERATOR;
    let neg_g = g.neg();
    
    // Inverse should also be on circle
    assert!(neg_g.is_on_circle(), "Inverse should be on circle");
    
    // g + (-g) = identity
    let result = g.add(neg_g);
    assert_eq!(result.x.value(), 1, "x should be 1");
    assert_eq!(result.y.value(), 0, "y should be 0");
    
    // Inverse of identity is identity
    let neg_id = CirclePoint::IDENTITY.neg();
    assert_eq!(neg_id.x.value(), 1);
    assert_eq!(neg_id.y.value(), 0);
}

#[test]
fn test_double() {
    let g = CIRCLE_GENERATOR;
    
    // Double should equal add(g, g)
    let g2_double = g.double();
    let g2_add = g.add(g);
    
    assert_eq!(g2_double.x.value(), g2_add.x.value());
    assert_eq!(g2_double.y.value(), g2_add.y.value());
    
    // Doubled point should be on circle
    assert!(g2_double.is_on_circle());
    
    // Double of identity is identity
    let id_doubled = CirclePoint::IDENTITY.double();
    assert_eq!(id_doubled.x.value(), 1);
    assert_eq!(id_doubled.y.value(), 0);
}

#[test]
fn test_scalar_mul() {
    let g = CIRCLE_GENERATOR;
    
    // 0 * g = identity
    let zero_g = g.mul(0);
    assert_eq!(zero_g.x.value(), 1);
    assert_eq!(zero_g.y.value(), 0);
    
    // 1 * g = g
    let one_g = g.mul(1);
    assert_eq!(one_g.x.value(), g.x.value());
    assert_eq!(one_g.y.value(), g.y.value());
    
    // 2 * g = double
    let two_g = g.mul(2);
    let g_doubled = g.double();
    assert_eq!(two_g.x.value(), g_doubled.x.value());
    assert_eq!(two_g.y.value(), g_doubled.y.value());
    
    // 3 * g = 2*g + g
    let three_g = g.mul(3);
    let expected = g.double().add(g);
    assert_eq!(three_g.x.value(), expected.x.value());
    assert_eq!(three_g.y.value(), expected.y.value());
    
    // 4 * g = 2*(2*g)
    let four_g = g.mul(4);
    let expected = g.double().double();
    assert_eq!(four_g.x.value(), expected.x.value());
}

#[test]
fn test_repeated_double() {
    let g = CIRCLE_GENERATOR;
    
    // repeated_double(n) = mul(2^n)
    for n in 0..5 {
        let doubled = g.repeated_double(n);
        let expected = g.mul(1 << n);
        assert_eq!(doubled.x.value(), expected.x.value());
        assert_eq!(doubled.y.value(), expected.y.value());
    }
}

#[test]
fn test_subgroup_generator_order() {
    // Test small subgroups
    for log_size in 1..8 {
        let g = subgroup_generator(log_size);
        let order = 1u32 << log_size;
        
        // Generator should be on circle
        assert!(g.is_on_circle(), "Generator for 2^{} should be on circle", log_size);
        
        // g^order = identity
        let g_to_order = g.mul(order);
        assert_eq!(g_to_order.x.value(), 1, "g^order should be identity for log_size={}", log_size);
        assert_eq!(g_to_order.y.value(), 0, "g^order should be identity for log_size={}", log_size);
        
        // g^(order/2) ≠ identity (for order > 1)
        if log_size > 0 {
            let half = g.mul(order / 2);
            assert!(
                half.x.value() != 1 || half.y.value() != 0,
                "g^(order/2) should not be identity for log_size={}",
                log_size
            );
        }
    }
}

#[test]
fn test_subgroup_generator_identity() {
    // Subgroup of order 1 (log_size = 0) should return identity
    let g = subgroup_generator(0);
    assert_eq!(g.x.value(), 1);
    assert_eq!(g.y.value(), 0);
}

#[test]
fn test_compute_domain() {
    for log_size in 1..6 {
        let domain = compute_domain(log_size);
        let size = 1usize << log_size;
        
        assert_eq!(domain.len(), size, "Domain should have 2^{} elements", log_size);
        
        // All points should be on circle
        for (i, p) in domain.iter().enumerate() {
            assert!(p.is_on_circle(), "Point {} should be on circle", i);
        }
        
        // First point should be identity
        assert_eq!(domain[0].x.value(), 1);
        assert_eq!(domain[0].y.value(), 0);
        
        // Points should be distinct
        for i in 0..domain.len() {
            for j in (i + 1)..domain.len() {
                assert!(
                    domain[i] != domain[j],
                    "Points {} and {} should be distinct",
                    i, j
                );
            }
        }
    }
}

#[test]
fn test_compute_twiddles() {
    let log_size = 4;
    let twiddles = compute_twiddles(log_size);
    let domain = compute_domain(log_size);
    
    assert_eq!(twiddles.len(), domain.len());
    
    // Twiddles should be x-coordinates of domain
    for (t, p) in twiddles.iter().zip(domain.iter()) {
        assert_eq!(t.value(), p.x.value());
    }
}

#[test]
fn test_coset_basic() {
    let log_size = 4;
    let coset = Coset::new(log_size);
    
    assert_eq!(coset.size(), 16);
    assert_eq!(coset.log_size, log_size);
    
    // First element should be initial
    assert_eq!(coset.at(0).x.value(), coset.initial.x.value());
}

#[test]
fn test_coset_shifted() {
    let log_size = 4;
    let shift = CIRCLE_GENERATOR.mul(5);
    let coset = Coset::shifted(log_size, shift);
    
    // First element should be the shift
    assert_eq!(coset.at(0).x.value(), shift.x.value());
    assert_eq!(coset.at(0).y.value(), shift.y.value());
}

#[test]
fn test_coset_iteration() {
    let log_size = 4;
    let coset = Coset::new(log_size);
    
    let from_iter: Vec<_> = coset.iter().collect();
    let from_domain = compute_domain(log_size);
    
    assert_eq!(from_iter.len(), from_domain.len());
    
    for (a, b) in from_iter.iter().zip(from_domain.iter()) {
        assert_eq!(a.x.value(), b.x.value());
        assert_eq!(a.y.value(), b.y.value());
    }
}

#[test]
fn test_coset_x_coordinates() {
    let coset = Coset::new(4);
    let x_coords = coset.x_coordinates();
    let twiddles = compute_twiddles(4);
    
    assert_eq!(x_coords, twiddles);
}

#[test]
fn test_circle_domain() {
    let log_size = 4;
    let mut domain = CircleDomain::new(log_size);
    
    assert_eq!(domain.size(), 16);
    assert_eq!(domain.log_size(), log_size);
    
    // Get points (should cache)
    let points1 = domain.points().len();
    let points2 = domain.points().len();
    assert_eq!(points1, points2);
    assert_eq!(points1, 16);
}

#[test]
fn test_group_associativity() {
    let g = CIRCLE_GENERATOR;
    let a = g.mul(5);
    let b = g.mul(7);
    let c = g.mul(11);
    
    // (a + b) + c = a + (b + c)
    let left = a.add(b).add(c);
    let right = a.add(b.add(c));
    
    assert_eq!(left.x.value(), right.x.value());
    assert_eq!(left.y.value(), right.y.value());
}

#[test]
fn test_group_commutativity() {
    let g = CIRCLE_GENERATOR;
    let a = g.mul(5);
    let b = g.mul(7);
    
    // a + b = b + a
    let ab = a.add(b);
    let ba = b.add(a);
    
    assert_eq!(ab.x.value(), ba.x.value());
    assert_eq!(ab.y.value(), ba.y.value());
}

#[test]
fn test_subtraction() {
    let g = CIRCLE_GENERATOR;
    let g2 = g.double();
    
    // g2 - g = g
    let diff = g2.sub(g);
    assert_eq!(diff.x.value(), g.x.value());
    assert_eq!(diff.y.value(), g.y.value());
    
    // g - g = identity
    let zero = g.sub(g);
    assert_eq!(zero.x.value(), 1);
    assert_eq!(zero.y.value(), 0);
}

#[test]
fn test_antipodal() {
    let g = CIRCLE_GENERATOR;
    let anti = g.antipodal();
    
    // Antipodal should be (-x, -y)
    assert_eq!(anti.x.value(), (-g.x).value());
    assert_eq!(anti.y.value(), (-g.y).value());
    
    // Antipodal should be on circle
    assert!(anti.is_on_circle());
    
    // Double antipodal = original
    let double_anti = anti.antipodal();
    assert_eq!(double_anti.x.value(), g.x.value());
    assert_eq!(double_anti.y.value(), g.y.value());
}

#[test]
fn test_new_checked() {
    // Valid point (identity)
    let valid = CirclePoint::new(M31::ONE, M31::ZERO);
    assert!(valid.is_some());
    
    // Invalid point
    let invalid = CirclePoint::new(M31::new(2), M31::new(3));
    assert!(invalid.is_none());
    
    // Generator should be valid
    let gen = CirclePoint::new(CIRCLE_GENERATOR.x, CIRCLE_GENERATOR.y);
    assert!(gen.is_some());
}

#[test]
fn test_to_bytes() {
    let g = CIRCLE_GENERATOR;
    let bytes = g.to_bytes();
    
    assert_eq!(bytes.len(), 8);
    
    // First 4 bytes should be x
    let x_bytes = &bytes[0..4];
    let x = u32::from_le_bytes(x_bytes.try_into().unwrap());
    assert_eq!(x, g.x.value());
    
    // Last 4 bytes should be y
    let y_bytes = &bytes[4..8];
    let y = u32::from_le_bytes(y_bytes.try_into().unwrap());
    assert_eq!(y, g.y.value());
}

#[test]
fn test_scalar_mul_distributive() {
    let g = CIRCLE_GENERATOR;
    
    // (a + b) * g = a*g + b*g
    let a = 5u32;
    let b = 7u32;
    
    let left = g.mul(a + b);
    let right = g.mul(a).add(g.mul(b));
    
    assert_eq!(left.x.value(), right.x.value());
    assert_eq!(left.y.value(), right.y.value());
}

#[test]
fn test_default() {
    let default = CirclePoint::default();
    assert_eq!(default.x.value(), CirclePoint::IDENTITY.x.value());
    assert_eq!(default.y.value(), CirclePoint::IDENTITY.y.value());
}
