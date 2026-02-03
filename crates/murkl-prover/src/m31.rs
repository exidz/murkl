//! M31 (Mersenne-31) field implementation
//!
//! The Mersenne-31 prime: p = 2^31 - 1 = 2147483647
//!
//! This field is used by Circle STARKs for efficient arithmetic.
//! All operations fit in 32-bit integers with fast modular reduction.
//!
//! # SIMD Support
//!
//! When the `simd` feature is enabled, batch operations use portable SIMD
//! for significant performance improvements.

#[cfg(not(feature = "std"))]
use alloc::vec::Vec;

use bytemuck::{Pod, Zeroable};
use core::fmt::{self, Display};
use core::ops::{Add, AddAssign, Div, Mul, MulAssign, Neg, Sub, SubAssign};
use core::clone::Clone;

/// The Mersenne-31 prime: 2^31 - 1
pub const M31_PRIME: u32 = (1 << 31) - 1;

/// Number of bits in the modulus
pub const MODULUS_BITS: u32 = 31;

/// An element of the M31 field
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Pod, Zeroable)]
#[repr(transparent)]
pub struct M31(pub u32);

impl M31 {
    /// Zero element
    pub const ZERO: Self = Self(0);

    /// One element (multiplicative identity)
    pub const ONE: Self = Self(1);

    /// Create a new M31 element from any u32, reducing modulo p
    #[inline]
    pub fn new(value: u32) -> Self {
        Self::reduce(value as u64)
    }

    /// Create from u32 without checking (value must be < P)
    ///
    /// # Safety
    /// The value must be in the range [0, P)
    #[inline]
    pub const fn from_u32_unchecked(value: u32) -> Self {
        Self(value)
    }

    /// Fast modular reduction for M31
    ///
    /// Uses the identity: x mod (2^31 - 1) = (x & p) + (x >> 31)
    /// with one additional reduction step if needed.
    #[inline]
    pub const fn reduce(x: u64) -> Self {
        // First reduction: split into high and low parts
        let low = (x & M31_PRIME as u64) as u32;
        let high = (x >> 31) as u32;
        let sum = low.wrapping_add(high);

        // Second reduction if sum >= P
        // Use wrapping arithmetic to avoid branches
        let reduced = sum.wrapping_sub(M31_PRIME);
        let needs_reduction = sum >= M31_PRIME;
        Self(if needs_reduction { reduced } else { sum })
    }

    /// Partial reduction when value is in [0, 2P)
    #[inline]
    pub const fn partial_reduce(val: u32) -> Self {
        // If val >= P, subtract P, otherwise keep val
        let reduced = val.wrapping_sub(M31_PRIME);
        Self(if val >= M31_PRIME { reduced } else { val })
    }

    /// Addition in M31
    #[inline]
    pub const fn add(self, other: Self) -> Self {
        let sum = (self.0 as u64) + (other.0 as u64);
        Self::partial_reduce(sum as u32)
    }

    /// Subtraction in M31
    #[inline]
    pub const fn sub(self, other: Self) -> Self {
        // Add P to avoid underflow, then reduce
        let diff = (self.0 as u64) + (M31_PRIME as u64) - (other.0 as u64);
        Self::partial_reduce(diff as u32)
    }

    /// Multiplication in M31
    #[inline]
    pub const fn mul(self, other: Self) -> Self {
        let prod = (self.0 as u64) * (other.0 as u64);
        Self::reduce(prod)
    }

    /// Square (optimized: same as multiply but with self)
    #[inline]
    pub const fn square(self) -> Self {
        let sq = (self.0 as u64) * (self.0 as u64);
        Self::reduce(sq)
    }

    /// Double (add self to self, slightly faster than mul by 2)
    #[inline]
    pub const fn double(self) -> Self {
        self.add(self)
    }

    /// Compute self^exp using square-and-multiply
    pub fn pow(self, mut exp: u32) -> Self {
        let mut base = self;
        let mut result = Self::ONE;

        while exp > 0 {
            if exp & 1 == 1 {
                result = result.mul(base);
            }
            base = base.square();
            exp >>= 1;
        }

        result
    }

    /// Compute multiplicative inverse using Fermat's little theorem
    /// a^(-1) = a^(p-2) mod p
    ///
    /// # Panics
    /// Panics if self is zero
    #[inline]
    pub fn inv(self) -> Self {
        debug_assert!(!self.is_zero(), "Cannot invert zero");
        // Use optimized inversion chain
        pow2147483645(self)
    }

    /// Division in M31 (multiply by inverse)
    #[inline]
    pub fn div(self, other: Self) -> Self {
        self.mul(other.inv())
    }

    /// Negation in M31
    #[inline]
    pub const fn neg(self) -> Self {
        if self.0 == 0 {
            self
        } else {
            Self(M31_PRIME - self.0)
        }
    }

    /// Check if zero
    #[inline]
    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Get the inner value
    #[inline]
    pub const fn value(self) -> u32 {
        self.0
    }

    /// Convert to bytes (little-endian)
    #[inline]
    pub fn to_le_bytes(self) -> [u8; 4] {
        self.0.to_le_bytes()
    }

    /// Convert from bytes (little-endian)
    #[inline]
    pub fn from_le_bytes(bytes: [u8; 4]) -> Self {
        Self::new(u32::from_le_bytes(bytes))
    }

    /// Convert to bytes (big-endian)
    #[inline]
    pub fn to_be_bytes(self) -> [u8; 4] {
        self.0.to_be_bytes()
    }

    /// Convert from bytes (big-endian)
    #[inline]
    pub fn from_be_bytes(bytes: [u8; 4]) -> Self {
        Self::new(u32::from_be_bytes(bytes))
    }
}

/// Optimized inverse computation: v^(2^31-3)
///
/// Uses an addition chain with 37 multiplications instead of naive 60.
/// This is the same algorithm used by STWO.
pub fn pow2147483645<T: FieldOps + Mul<Output = T>>(v: T) -> T {
    let t0 = sqn::<2, T>(v.clone()) * v.clone();
    let t1 = sqn::<1, T>(t0.clone()) * t0.clone();
    let t2 = sqn::<3, T>(t1.clone()) * t0.clone();
    let t3 = sqn::<1, T>(t2.clone()) * t0.clone();
    let t4 = sqn::<8, T>(t3.clone()) * t3.clone();
    let t5 = sqn::<8, T>(t4.clone()) * t3.clone();
    sqn::<7, T>(t5) * t2
}

/// Square n times
#[inline]
fn sqn<const N: usize, T: FieldOps>(mut v: T) -> T {
    for _ in 0..N {
        v = v.square();
    }
    v
}

/// Trait for field operations (enables generic algorithms)
pub trait FieldOps: Clone {
    fn square(&self) -> Self;
}

impl FieldOps for M31 {
    #[inline]
    fn square(&self) -> Self {
        M31::square(*self)
    }
}

impl Mul for M31 {
    type Output = Self;
    #[inline]
    fn mul(self, rhs: Self) -> Self::Output {
        M31::mul(self, rhs)
    }
}

// === Operator implementations ===

impl Display for M31 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<u32> for M31 {
    #[inline]
    fn from(value: u32) -> Self {
        Self::new(value)
    }
}

impl From<M31> for u32 {
    #[inline]
    fn from(value: M31) -> Self {
        value.0
    }
}

impl From<i32> for M31 {
    fn from(value: i32) -> Self {
        if value < 0 {
            let abs = value.unsigned_abs();
            Self(M31_PRIME - (abs % M31_PRIME))
        } else {
            Self::new(value as u32)
        }
    }
}

impl Add for M31 {
    type Output = Self;
    #[inline]
    fn add(self, other: Self) -> Self {
        M31::add(self, other)
    }
}

impl Sub for M31 {
    type Output = Self;
    #[inline]
    fn sub(self, other: Self) -> Self {
        M31::sub(self, other)
    }
}

impl Neg for M31 {
    type Output = Self;
    #[inline]
    fn neg(self) -> Self {
        M31::neg(self)
    }
}

impl Div for M31 {
    type Output = Self;
    #[inline]
    fn div(self, rhs: Self) -> Self::Output {
        M31::div(self, rhs)
    }
}

impl AddAssign for M31 {
    #[inline]
    fn add_assign(&mut self, other: Self) {
        *self = *self + other;
    }
}

impl SubAssign for M31 {
    #[inline]
    fn sub_assign(&mut self, other: Self) {
        *self = *self - other;
    }
}

impl MulAssign for M31 {
    #[inline]
    fn mul_assign(&mut self, other: Self) {
        *self = *self * other;
    }
}

impl core::iter::Sum for M31 {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(M31::ZERO, |a, b| a + b)
    }
}

impl core::iter::Product for M31 {
    fn product<I: Iterator<Item = Self>>(iter: I) -> Self {
        iter.fold(M31::ONE, |a, b| a * b)
    }
}

// === SIMD operations ===

#[cfg(feature = "simd")]
pub mod simd {
    //! SIMD-accelerated batch operations for M31
    //!
    //! This module provides vectorized implementations using portable SIMD.

    use super::*;
    use core::simd::{u32x16, Simd, cmp::SimdOrd};

    /// Number of lanes in SIMD vectors
    pub const N_LANES: usize = 16;
    pub const LOG_N_LANES: u32 = 4;

    /// SIMD modulus vector
    const MODULUS: Simd<u32, N_LANES> = Simd::from_array([M31_PRIME; N_LANES]);

    /// Packed M31 elements for SIMD operations
    #[derive(Clone, Copy, Debug)]
    #[repr(transparent)]
    pub struct PackedM31(pub u32x16);

    impl PackedM31 {
        /// Create from a single value (broadcast)
        #[inline]
        pub const fn broadcast(value: M31) -> Self {
            Self(Simd::from_array([value.0; N_LANES]))
        }

        /// Create from an array
        #[inline]
        pub fn from_array(values: [M31; N_LANES]) -> Self {
            Self(Simd::from_array(values.map(|m| m.0)))
        }

        /// Convert to array
        #[inline]
        pub fn to_array(self) -> [M31; N_LANES] {
            self.reduce().0.to_array().map(M31)
        }

        /// Zero vector
        #[inline]
        pub const fn zero() -> Self {
            Self(Simd::from_array([0; N_LANES]))
        }

        /// One vector
        #[inline]
        pub const fn one() -> Self {
            Self(Simd::from_array([1; N_LANES]))
        }

        /// Reduce each element to [0, P)
        #[inline]
        fn reduce(self) -> Self {
            Self(self.0.simd_min(self.0 - MODULUS))
        }

        /// Add two packed vectors
        #[inline]
        pub fn add(self, rhs: Self) -> Self {
            let sum = self.0 + rhs.0;
            Self(sum.simd_min(sum - MODULUS))
        }

        /// Subtract two packed vectors
        #[inline]
        pub fn sub(self, rhs: Self) -> Self {
            let diff = self.0 - rhs.0;
            Self((diff + MODULUS).simd_min(diff))
        }

        /// Negate packed vector
        #[inline]
        pub fn neg(self) -> Self {
            Self(MODULUS - self.0)
        }

        /// Multiply two packed vectors (portable implementation)
        #[inline]
        pub fn mul(self, rhs: Self) -> Self {
            // Split into even/odd elements and use 64-bit multiplication
            let a_lo: [u32; N_LANES] = self.0.to_array();
            let b_lo: [u32; N_LANES] = rhs.0.to_array();

            let mut result = [0u32; N_LANES];
            for i in 0..N_LANES {
                let prod = (a_lo[i] as u64) * (b_lo[i] as u64);
                result[i] = M31::reduce(prod).0;
            }

            Self(Simd::from_array(result))
        }

        /// Square each element
        #[inline]
        pub fn square(self) -> Self {
            self.mul(self)
        }

        /// Double each element
        #[inline]
        pub fn double(self) -> Self {
            self.add(self)
        }

        /// Sum all elements in the vector
        #[inline]
        pub fn horizontal_sum(self) -> M31 {
            self.to_array().into_iter().sum()
        }

        /// Reverse element order
        #[inline]
        pub fn reverse(self) -> Self {
            let arr = self.0.to_array();
            let mut rev = [0u32; N_LANES];
            for i in 0..N_LANES {
                rev[i] = arr[N_LANES - 1 - i];
            }
            Self(Simd::from_array(rev))
        }
    }

    impl core::ops::Add for PackedM31 {
        type Output = Self;
        #[inline]
        fn add(self, rhs: Self) -> Self {
            PackedM31::add(self, rhs)
        }
    }

    impl core::ops::Sub for PackedM31 {
        type Output = Self;
        #[inline]
        fn sub(self, rhs: Self) -> Self {
            PackedM31::sub(self, rhs)
        }
    }

    impl core::ops::Mul for PackedM31 {
        type Output = Self;
        #[inline]
        fn mul(self, rhs: Self) -> Self {
            PackedM31::mul(self, rhs)
        }
    }

    impl core::ops::Neg for PackedM31 {
        type Output = Self;
        #[inline]
        fn neg(self) -> Self {
            PackedM31::neg(self)
        }
    }

    impl FieldOps for PackedM31 {
        #[inline]
        fn square(&self) -> Self {
            PackedM31::square(*self)
        }
    }

    /// Batch multiply: multiply all elements pairwise
    pub fn batch_mul(a: &[M31], b: &[M31]) -> Vec<M31> {
        assert_eq!(a.len(), b.len());

        let mut result = Vec::with_capacity(a.len());
        let chunks = a.len() / N_LANES;

        // Process full SIMD chunks
        for i in 0..chunks {
            let start = i * N_LANES;
            let a_packed = PackedM31::from_array(
                a[start..start + N_LANES].try_into().unwrap()
            );
            let b_packed = PackedM31::from_array(
                b[start..start + N_LANES].try_into().unwrap()
            );
            let prod = a_packed.mul(b_packed);
            result.extend_from_slice(&prod.to_array());
        }

        // Handle remainder
        let remainder_start = chunks * N_LANES;
        for i in remainder_start..a.len() {
            result.push(a[i] * b[i]);
        }

        result
    }

    /// Batch add: add all elements pairwise
    pub fn batch_add(a: &[M31], b: &[M31]) -> Vec<M31> {
        assert_eq!(a.len(), b.len());

        let mut result = Vec::with_capacity(a.len());
        let chunks = a.len() / N_LANES;

        for i in 0..chunks {
            let start = i * N_LANES;
            let a_packed = PackedM31::from_array(
                a[start..start + N_LANES].try_into().unwrap()
            );
            let b_packed = PackedM31::from_array(
                b[start..start + N_LANES].try_into().unwrap()
            );
            let sum = a_packed.add(b_packed);
            result.extend_from_slice(&sum.to_array());
        }

        let remainder_start = chunks * N_LANES;
        for i in remainder_start..a.len() {
            result.push(a[i] + b[i]);
        }

        result
    }

    /// Batch inverse using Montgomery's trick
    ///
    /// Computes inverses of all elements using only 3 multiplications per element
    /// (on average) instead of the ~37 for individual inversions.
    pub fn batch_inverse(values: &[M31]) -> Vec<M31> {
        if values.is_empty() {
            return Vec::new();
        }

        let n = values.len();
        let mut result = vec![M31::ZERO; n];

        // Compute prefix products: prefix[i] = values[0] * values[1] * ... * values[i]
        let mut prefix = vec![M31::ONE; n];
        prefix[0] = values[0];
        for i in 1..n {
            prefix[i] = prefix[i - 1] * values[i];
        }

        // Compute inverse of the total product
        let mut inv_prod = prefix[n - 1].inv();

        // Work backwards to compute individual inverses
        for i in (1..n).rev() {
            // result[i] = prefix[i-1] * inv(prefix[i])
            result[i] = prefix[i - 1] * inv_prod;
            // Update inv_prod for next iteration
            inv_prod = inv_prod * values[i];
        }
        result[0] = inv_prod;

        result
    }
}

// === Non-SIMD batch operations ===

#[cfg(not(feature = "simd"))]
pub mod batch {
    //! Batch operations without SIMD

    use super::*;

    /// Batch inverse using Montgomery's trick
    pub fn batch_inverse(values: &[M31]) -> Vec<M31> {
        if values.is_empty() {
            return Vec::new();
        }

        let n = values.len();
        let mut result = vec![M31::ZERO; n];

        let mut prefix = vec![M31::ONE; n];
        prefix[0] = values[0];
        for i in 1..n {
            prefix[i] = prefix[i - 1] * values[i];
        }

        let mut inv_prod = prefix[n - 1].inv();

        for i in (1..n).rev() {
            result[i] = prefix[i - 1] * inv_prod;
            inv_prod = inv_prod * values[i];
        }
        result[0] = inv_prod;

        result
    }

    /// Batch multiply (scalar fallback)
    pub fn batch_mul(a: &[M31], b: &[M31]) -> Vec<M31> {
        assert_eq!(a.len(), b.len());
        a.iter().zip(b.iter()).map(|(&x, &y)| x * y).collect()
    }

    /// Batch add (scalar fallback)
    pub fn batch_add(a: &[M31], b: &[M31]) -> Vec<M31> {
        assert_eq!(a.len(), b.len());
        a.iter().zip(b.iter()).map(|(&x, &y)| x + y).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constants() {
        assert_eq!(M31_PRIME, 2147483647);
        assert_eq!(M31_PRIME, (1 << 31) - 1);
    }

    #[test]
    fn test_basic_arithmetic() {
        let a = M31::new(100);
        let b = M31::new(200);

        assert_eq!((a + b).value(), 300);
        assert_eq!((b - a).value(), 100);
        assert_eq!((a * b).value(), 20000);
    }

    #[test]
    fn test_reduction() {
        // Test that P reduces to 0
        let a = M31::new(M31_PRIME);
        assert_eq!(a.value(), 0);

        // Test P + 1 reduces to 1
        let b = M31::new(M31_PRIME + 1);
        assert_eq!(b.value(), 1);

        // Test P + 100 reduces to 100
        let c = M31::new(M31_PRIME + 100);
        assert_eq!(c.value(), 100);

        // Test 2P reduces to 0
        let d = M31::reduce(2 * M31_PRIME as u64);
        assert_eq!(d.value(), 0);
    }

    #[test]
    fn test_inverse() {
        let a = M31::new(12345);
        let a_inv = a.inv();
        let product = a * a_inv;
        assert_eq!(product.value(), 1);

        // Test several random values
        for val in [1, 2, 42, 1000, 999999, M31_PRIME - 1] {
            let x = M31::new(val);
            let x_inv = x.inv();
            assert_eq!((x * x_inv).value(), 1, "Failed for value {}", val);
        }
    }

    #[test]
    fn test_negation() {
        let a = M31::new(100);
        let neg_a = -a;
        assert_eq!((a + neg_a).value(), 0);

        // Negation of zero is zero
        assert_eq!((-M31::ZERO).value(), 0);

        // Double negation
        assert_eq!((-(-a)).value(), a.value());
    }

    #[test]
    fn test_subtraction() {
        let a = M31::new(100);
        let b = M31::new(200);

        // Normal subtraction
        assert_eq!((b - a).value(), 100);

        // Subtraction with wraparound
        let diff = a - b;
        assert_eq!((diff + b).value(), a.value());
    }

    #[test]
    fn test_pow() {
        let a = M31::new(2);
        assert_eq!(a.pow(0).value(), 1);
        assert_eq!(a.pow(1).value(), 2);
        assert_eq!(a.pow(10).value(), 1024);

        // Fermat's little theorem: a^(p-1) = 1
        let b = M31::new(12345);
        assert_eq!(b.pow(M31_PRIME - 1).value(), 1);

        // a^p = a
        assert_eq!(b.pow(M31_PRIME).value(), b.value());
    }

    #[test]
    fn test_division() {
        let a = M31::new(1000);
        let b = M31::new(100);

        // a / b * b = a
        let quotient = a / b;
        assert_eq!((quotient * b).value(), a.value());
    }

    #[test]
    fn test_from_i32() {
        assert_eq!(M31::from(5i32).value(), 5);
        assert_eq!((M31::from(-1i32) + M31::ONE).value(), 0);
        assert_eq!(M31::from(-5i32).value(), M31_PRIME - 5);
    }

    #[test]
    fn test_bytes_roundtrip() {
        let a = M31::new(123456789);
        let bytes_le = a.to_le_bytes();
        assert_eq!(M31::from_le_bytes(bytes_le), a);

        let bytes_be = a.to_be_bytes();
        assert_eq!(M31::from_be_bytes(bytes_be), a);
    }

    #[test]
    fn test_sum_product() {
        let values = vec![M31::new(1), M31::new(2), M31::new(3), M31::new(4)];

        let sum: M31 = values.iter().copied().sum();
        assert_eq!(sum.value(), 10);

        let product: M31 = values.iter().copied().product();
        assert_eq!(product.value(), 24);
    }

    #[test]
    fn test_large_multiplication() {
        // Test multiplication that would overflow u32
        let a = M31::new(M31_PRIME - 1);
        let b = M31::new(M31_PRIME - 1);
        let prod = a * b;
        // (p-1)^2 mod p = 1
        assert_eq!(prod.value(), 1);
    }
}

#[cfg(all(test, feature = "simd"))]
mod simd_tests {
    use super::simd::*;
    use super::*;

    #[test]
    fn test_packed_basic() {
        let a = PackedM31::broadcast(M31::new(100));
        let b = PackedM31::broadcast(M31::new(200));

        let sum = a + b;
        for val in sum.to_array() {
            assert_eq!(val.value(), 300);
        }

        let diff = b - a;
        for val in diff.to_array() {
            assert_eq!(val.value(), 100);
        }
    }

    #[test]
    fn test_packed_mul() {
        let a_arr: [M31; 16] = core::array::from_fn(|i| M31::new((i + 1) as u32));
        let b_arr: [M31; 16] = core::array::from_fn(|i| M31::new((i + 1) as u32));
        let a = PackedM31::from_array(a_arr);
        let b = PackedM31::from_array(b_arr);

        let prod = a * b;
        let result = prod.to_array();

        for i in 0..16 {
            let expected = ((i + 1) * (i + 1)) as u32;
            assert_eq!(result[i].value(), expected);
        }
    }

    #[test]
    fn test_batch_mul_equivalence() {
        let a: Vec<M31> = (1..=32).map(|i| M31::new(i)).collect();
        let b: Vec<M31> = (1..=32).map(|i| M31::new(i * 2)).collect();

        let simd_result = batch_mul(&a, &b);
        let scalar_result: Vec<M31> = a.iter().zip(b.iter()).map(|(&x, &y)| x * y).collect();

        assert_eq!(simd_result, scalar_result);
    }

    #[test]
    fn test_batch_inverse() {
        let values: Vec<M31> = (1..=100).map(|i| M31::new(i)).collect();
        let inverses = batch_inverse(&values);

        for (i, (&val, &inv)) in values.iter().zip(inverses.iter()).enumerate() {
            let prod = val * inv;
            assert_eq!(prod.value(), 1, "Failed at index {}", i);
        }
    }
}
