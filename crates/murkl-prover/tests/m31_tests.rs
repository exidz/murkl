//! Comprehensive tests for M31 field arithmetic

use murkl_prover::m31::{M31, M31_PRIME};

#[test]
fn test_field_constants() {
    assert_eq!(M31_PRIME, 2147483647);
    assert_eq!(M31_PRIME, (1 << 31) - 1);
    assert_eq!(M31::ZERO.value(), 0);
    assert_eq!(M31::ONE.value(), 1);
}

#[test]
fn test_addition() {
    // Basic addition
    assert_eq!((M31::new(10) + M31::new(20)).value(), 30);
    
    // Addition with wraparound
    let a = M31::new(M31_PRIME - 10);
    let b = M31::new(20);
    assert_eq!((a + b).value(), 10);
    
    // Addition with zero
    assert_eq!((M31::new(42) + M31::ZERO).value(), 42);
    
    // Commutativity
    let x = M31::new(123);
    let y = M31::new(456);
    assert_eq!((x + y).value(), (y + x).value());
    
    // Associativity
    let z = M31::new(789);
    assert_eq!(((x + y) + z).value(), (x + (y + z)).value());
}

#[test]
fn test_subtraction() {
    // Basic subtraction
    assert_eq!((M31::new(30) - M31::new(10)).value(), 20);
    
    // Subtraction with wraparound
    let a = M31::new(10);
    let b = M31::new(20);
    let diff = a - b;
    assert_eq!((diff + b).value(), a.value());
    
    // Subtraction from zero
    let c = M31::ZERO - M31::new(1);
    assert_eq!(c.value(), M31_PRIME - 1);
}

#[test]
fn test_multiplication() {
    // Basic multiplication
    assert_eq!((M31::new(6) * M31::new(7)).value(), 42);
    
    // Multiplication by zero
    assert_eq!((M31::new(12345) * M31::ZERO).value(), 0);
    
    // Multiplication by one
    assert_eq!((M31::new(12345) * M31::ONE).value(), 12345);
    
    // Large multiplication with reduction
    let a = M31::new(M31_PRIME - 1);
    let b = M31::new(M31_PRIME - 1);
    let prod = a * b;
    // (p-1)^2 = p^2 - 2p + 1 ≡ 1 (mod p)
    assert_eq!(prod.value(), 1);
    
    // Commutativity
    let x = M31::new(123);
    let y = M31::new(456);
    assert_eq!((x * y).value(), (y * x).value());
    
    // Associativity
    let z = M31::new(789);
    assert_eq!(((x * y) * z).value(), (x * (y * z)).value());
}

#[test]
fn test_negation() {
    let a = M31::new(100);
    let neg_a = -a;
    
    // a + (-a) = 0
    assert_eq!((a + neg_a).value(), 0);
    
    // Negation of zero
    assert_eq!((-M31::ZERO).value(), 0);
    
    // Double negation
    assert_eq!((-(-a)).value(), a.value());
    
    // Negation of p-1
    let pm1 = M31::new(M31_PRIME - 1);
    assert_eq!((-pm1).value(), 1);
}

#[test]
fn test_inverse() {
    // Basic inverse
    for val in [1, 2, 3, 42, 1000, 999999, M31_PRIME - 1] {
        let x = M31::new(val);
        let x_inv = x.inv();
        assert_eq!((x * x_inv).value(), 1, "Inverse failed for {}", val);
    }
    
    // Multiple random values
    let test_values: Vec<u32> = vec![
        7, 13, 17, 23, 31, 127, 255, 1023,
        65537, 524287, 1000000007 % M31_PRIME,
    ];
    
    for val in test_values {
        let x = M31::new(val);
        let x_inv = x.inv();
        let product = x * x_inv;
        assert_eq!(product.value(), 1, "Inverse failed for {}", val);
    }
}

#[test]
fn test_division() {
    let a = M31::new(100);
    let b = M31::new(20);
    
    // Division
    let quotient = a / b;
    
    // quotient * b = a
    assert_eq!((quotient * b).value(), a.value());
    
    // a / a = 1
    assert_eq!((a / a).value(), 1);
    
    // a / 1 = a
    assert_eq!((a / M31::ONE).value(), a.value());
}

#[test]
fn test_pow() {
    let base = M31::new(2);
    
    // Powers of 2
    assert_eq!(base.pow(0).value(), 1);
    assert_eq!(base.pow(1).value(), 2);
    assert_eq!(base.pow(2).value(), 4);
    assert_eq!(base.pow(3).value(), 8);
    assert_eq!(base.pow(10).value(), 1024);
    assert_eq!(base.pow(20).value(), 1048576);
    
    // Fermat's little theorem: a^(p-1) = 1
    let a = M31::new(12345);
    assert_eq!(a.pow(M31_PRIME - 1).value(), 1);
    
    // a^p = a
    assert_eq!(a.pow(M31_PRIME).value(), a.value());
    
    // 0^n = 0 for n > 0
    assert_eq!(M31::ZERO.pow(5).value(), 0);
    
    // a^0 = 1
    assert_eq!(M31::new(999).pow(0).value(), 1);
}

#[test]
fn test_square() {
    let values = [0, 1, 2, 3, 10, 100, 1000, M31_PRIME - 1];
    
    for &val in &values {
        let x = M31::new(val);
        let sq = x.square();
        let mul = x * x;
        assert_eq!(sq.value(), mul.value(), "Square mismatch for {}", val);
    }
}

#[test]
fn test_reduction() {
    // Values at boundary
    assert_eq!(M31::new(M31_PRIME).value(), 0);
    assert_eq!(M31::new(M31_PRIME + 1).value(), 1);
    assert_eq!(M31::new(M31_PRIME + 100).value(), 100);
    
    // Large values
    let large = M31::reduce(u64::MAX);
    assert!(large.value() < M31_PRIME);
    
    // 2*P
    let two_p = M31::reduce(2 * M31_PRIME as u64);
    assert_eq!(two_p.value(), 0);
    
    // 3*P + 7
    let three_p_plus_7 = M31::reduce(3 * M31_PRIME as u64 + 7);
    assert_eq!(three_p_plus_7.value(), 7);
}

#[test]
fn test_from_i32() {
    assert_eq!(M31::from(0i32).value(), 0);
    assert_eq!(M31::from(5i32).value(), 5);
    assert_eq!(M31::from(-1i32).value(), M31_PRIME - 1);
    assert_eq!(M31::from(-5i32).value(), M31_PRIME - 5);
    
    // -1 + 1 = 0
    let neg_one = M31::from(-1i32);
    assert_eq!((neg_one + M31::ONE).value(), 0);
}

#[test]
fn test_bytes_roundtrip() {
    let values = [0, 1, 100, 12345, M31_PRIME - 1];
    
    for &val in &values {
        let x = M31::new(val);
        
        // Little endian
        let le_bytes = x.to_le_bytes();
        let from_le = M31::from_le_bytes(le_bytes);
        assert_eq!(from_le.value(), x.value());
        
        // Big endian
        let be_bytes = x.to_be_bytes();
        let from_be = M31::from_be_bytes(be_bytes);
        assert_eq!(from_be.value(), x.value());
    }
}

#[test]
fn test_distributivity() {
    // a * (b + c) = a*b + a*c
    let a = M31::new(7);
    let b = M31::new(11);
    let c = M31::new(13);
    
    let left = a * (b + c);
    let right = (a * b) + (a * c);
    assert_eq!(left.value(), right.value());
}

#[test]
fn test_sum_iterator() {
    let values: Vec<M31> = (1..=10).map(|i| M31::new(i)).collect();
    let sum: M31 = values.iter().copied().sum();
    
    // 1 + 2 + ... + 10 = 55
    assert_eq!(sum.value(), 55);
}

#[test]
fn test_product_iterator() {
    let values: Vec<M31> = (1..=5).map(|i| M31::new(i)).collect();
    let product: M31 = values.iter().copied().product();
    
    // 1 * 2 * 3 * 4 * 5 = 120
    assert_eq!(product.value(), 120);
}

#[test]
fn test_assign_ops() {
    let mut x = M31::new(10);
    
    x += M31::new(5);
    assert_eq!(x.value(), 15);
    
    x -= M31::new(3);
    assert_eq!(x.value(), 12);
    
    x *= M31::new(2);
    assert_eq!(x.value(), 24);
}

#[test]
fn test_edge_cases() {
    // 0 - 0 = 0
    assert_eq!((M31::ZERO - M31::ZERO).value(), 0);
    
    // 1 - 1 = 0
    assert_eq!((M31::ONE - M31::ONE).value(), 0);
    
    // (p-1) + 1 = 0
    let pm1 = M31::new(M31_PRIME - 1);
    assert_eq!((pm1 + M31::ONE).value(), 0);
    
    // (p-1) * (p-1) = 1
    assert_eq!((pm1 * pm1).value(), 1);
    
    // 2 * ((p-1)/2) = p - 1
    let half_pm1 = M31::new((M31_PRIME - 1) / 2);
    assert_eq!((M31::new(2) * half_pm1).value(), M31_PRIME - 1);
}

// Property-based style tests
#[test]
fn test_additive_identity() {
    for val in [0, 1, 100, 1000, M31_PRIME - 1] {
        let x = M31::new(val);
        assert_eq!((x + M31::ZERO).value(), x.value());
        assert_eq!((M31::ZERO + x).value(), x.value());
    }
}

#[test]
fn test_multiplicative_identity() {
    for val in [0, 1, 100, 1000, M31_PRIME - 1] {
        let x = M31::new(val);
        assert_eq!((x * M31::ONE).value(), x.value());
        assert_eq!((M31::ONE * x).value(), x.value());
    }
}

#[test]
fn test_additive_inverse() {
    for val in [1, 2, 100, 1000, M31_PRIME - 1] {
        let x = M31::new(val);
        let neg_x = -x;
        assert_eq!((x + neg_x).value(), 0);
    }
}

#[test]
fn test_multiplicative_inverse() {
    for val in [1, 2, 100, 1000, M31_PRIME - 1] {
        let x = M31::new(val);
        let inv_x = x.inv();
        assert_eq!((x * inv_x).value(), 1);
    }
}
