//! Circle group implementation for Circle STARKs
//!
//! The circle curve: x² + y² = 1 over M31
//!
//! Points on this curve form a cyclic group of order p + 1 = 2^31
//! This power-of-two order enables efficient FFT operations.

#[cfg(not(feature = "std"))]
use alloc::vec::Vec;

use crate::m31::M31;
use core::fmt;

/// A point on the circle x² + y² = 1 over M31
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct CirclePoint {
    pub x: M31,
    pub y: M31,
}

impl fmt::Debug for CirclePoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "CirclePoint({}, {})", self.x.value(), self.y.value())
    }
}

impl CirclePoint {
    /// The identity element (1, 0)
    pub const IDENTITY: Self = Self {
        x: M31::ONE,
        y: M31::ZERO,
    };

    /// Create a new circle point (unchecked)
    #[inline]
    pub const fn new_unchecked(x: M31, y: M31) -> Self {
        Self { x, y }
    }

    /// Create a new circle point, verifying it's on the curve
    pub fn new(x: M31, y: M31) -> Option<Self> {
        let point = Self { x, y };
        if point.is_on_circle() {
            Some(point)
        } else {
            None
        }
    }

    /// Check if point is on the circle x² + y² = 1
    #[inline]
    pub fn is_on_circle(&self) -> bool {
        let x2 = self.x.square();
        let y2 = self.y.square();
        (x2 + y2).value() == 1
    }

    /// Circle group operation (complex multiplication on the unit circle)
    /// (x1, y1) ⊕ (x2, y2) = (x1*x2 - y1*y2, x1*y2 + y1*x2)
    #[inline]
    pub fn add(self, other: Self) -> Self {
        let x = self.x * other.x - self.y * other.y;
        let y = self.x * other.y + self.y * other.x;
        Self { x, y }
    }

    /// Inverse in the circle group: (x, y)⁻¹ = (x, -y)
    #[inline]
    pub fn neg(self) -> Self {
        Self {
            x: self.x,
            y: -self.y,
        }
    }

    /// Double a point: 2*(x,y) = (2x²-1, 2xy)
    /// This is derived from the addition formula with P = Q
    #[inline]
    pub fn double(self) -> Self {
        let x2 = self.x.square();
        let two = M31::new(2);
        Self {
            x: two * x2 - M31::ONE,
            y: two * self.x * self.y,
        }
    }

    /// Scalar multiplication using double-and-add
    pub fn mul(self, mut scalar: u32) -> Self {
        if scalar == 0 {
            return Self::IDENTITY;
        }

        let mut result = Self::IDENTITY;
        let mut base = self;

        while scalar > 0 {
            if scalar & 1 == 1 {
                result = result.add(base);
            }
            base = base.double();
            scalar >>= 1;
        }

        result
    }

    /// Efficient repeated doubling: 2^n * P
    pub fn repeated_double(mut self, n: u32) -> Self {
        for _ in 0..n {
            self = self.double();
        }
        self
    }

    /// Antipodal point: (-x, -y) — opposite on the circle
    #[inline]
    pub fn antipodal(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
        }
    }

    /// Subtraction: P - Q = P + (-Q)
    #[inline]
    pub fn sub(self, other: Self) -> Self {
        self.add(other.neg())
    }

    /// Convert to bytes (for hashing)
    pub fn to_bytes(&self) -> [u8; 8] {
        let mut bytes = [0u8; 8];
        bytes[0..4].copy_from_slice(&self.x.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.y.to_le_bytes());
        bytes
    }
}

impl Default for CirclePoint {
    fn default() -> Self {
        Self::IDENTITY
    }
}

/// Standard generator for the M31 circle group
///
/// Order of this generator is 2^31 (the full group)
/// G = (2, y) where y = sqrt(1 - 4) = sqrt(-3) in M31
/// sqrt(-3) mod (2^31 - 1) = 1268011823
pub const CIRCLE_GENERATOR: CirclePoint = CirclePoint {
    x: M31::from_u32_unchecked(2),
    y: M31::from_u32_unchecked(1268011823),
};

/// Order of the full circle group (2^31)
pub const CIRCLE_ORDER: u32 = 1 << 31;

/// Log2 of the circle group order
pub const LOG_CIRCLE_ORDER: u32 = 31;

/// Get a generator for a subgroup of order 2^log_size
///
/// The full group has order 2^31, so we compute G^(2^(31-log_size))
/// which generates a subgroup of the desired order.
pub fn subgroup_generator(log_size: u32) -> CirclePoint {
    assert!(log_size <= LOG_CIRCLE_ORDER, "Subgroup order exceeds group order");

    if log_size == 0 {
        return CirclePoint::IDENTITY;
    }

    // Compute G^(2^(31-log_size)) by repeated doubling
    CIRCLE_GENERATOR.repeated_double(LOG_CIRCLE_ORDER - log_size)
}

/// Compute all powers of a generator (domain for polynomial evaluation)
///
/// Returns [G^0, G^1, G^2, ..., G^(2^log_size - 1)]
pub fn compute_domain(log_size: u32) -> Vec<CirclePoint> {
    let size = 1usize << log_size;
    let g = subgroup_generator(log_size);

    let mut domain = Vec::with_capacity(size);
    let mut current = CirclePoint::IDENTITY;

    for _ in 0..size {
        domain.push(current);
        current = current.add(g);
    }

    domain
}

/// Compute twiddle factors (x-coordinates for FFT)
pub fn compute_twiddles(log_size: u32) -> Vec<M31> {
    compute_domain(log_size).iter().map(|p| p.x).collect()
}

/// Coset representation for evaluation domains
#[derive(Clone, Copy, Debug)]
pub struct Coset {
    /// Starting point of the coset
    pub initial: CirclePoint,
    /// Generator for stepping through the coset
    pub step: CirclePoint,
    /// Log2 of the coset size
    pub log_size: u32,
}

impl Coset {
    /// Create a standard coset of size 2^log_size
    pub fn new(log_size: u32) -> Self {
        Self {
            initial: CirclePoint::IDENTITY,
            step: subgroup_generator(log_size),
            log_size,
        }
    }

    /// Create a coset starting at a different point
    pub fn shifted(log_size: u32, shift: CirclePoint) -> Self {
        Self {
            initial: shift,
            step: subgroup_generator(log_size),
            log_size,
        }
    }

    /// Size of the coset
    pub fn size(&self) -> usize {
        1 << self.log_size
    }

    /// Get the i-th element of the coset
    pub fn at(&self, i: usize) -> CirclePoint {
        self.initial.add(self.step.mul(i as u32))
    }

    /// Iterate over all points in the coset
    pub fn iter(&self) -> CosetIter {
        CosetIter {
            current: self.initial,
            step: self.step,
            remaining: self.size(),
        }
    }

    /// Get all x-coordinates (twiddle factors)
    pub fn x_coordinates(&self) -> Vec<M31> {
        self.iter().map(|p| p.x).collect()
    }
}

/// Iterator over coset elements
pub struct CosetIter {
    current: CirclePoint,
    step: CirclePoint,
    remaining: usize,
}

impl Iterator for CosetIter {
    type Item = CirclePoint;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let result = self.current;
        self.current = self.current.add(self.step);
        self.remaining -= 1;
        Some(result)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}

impl ExactSizeIterator for CosetIter {}

/// Circle domain for polynomial evaluation
#[derive(Clone, Debug)]
pub struct CircleDomain {
    /// The underlying coset
    pub coset: Coset,
    /// Cached domain points (lazy evaluation)
    points: Option<Vec<CirclePoint>>,
}

impl CircleDomain {
    /// Create a new domain of size 2^log_size
    pub fn new(log_size: u32) -> Self {
        Self {
            coset: Coset::new(log_size),
            points: None,
        }
    }

    /// Get the domain size
    pub fn size(&self) -> usize {
        self.coset.size()
    }

    /// Get log2 of domain size
    pub fn log_size(&self) -> u32 {
        self.coset.log_size
    }

    /// Get all domain points (cached)
    pub fn points(&mut self) -> &[CirclePoint] {
        if self.points.is_none() {
            self.points = Some(self.coset.iter().collect());
        }
        self.points.as_ref().unwrap()
    }

    /// Get the i-th point
    pub fn at(&self, i: usize) -> CirclePoint {
        self.coset.at(i)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity() {
        let id = CirclePoint::IDENTITY;
        assert!(id.is_on_circle());
        assert_eq!(id.x.value(), 1);
        assert_eq!(id.y.value(), 0);
    }

    #[test]
    fn test_generator_on_circle() {
        let g = CIRCLE_GENERATOR;
        assert!(
            g.is_on_circle(),
            "Generator not on circle: x²+y² = {}",
            (g.x.square() + g.y.square()).value()
        );
    }

    #[test]
    fn test_group_identity() {
        let g = CIRCLE_GENERATOR;
        let id = CirclePoint::IDENTITY;

        // g + id = g
        let result = g.add(id);
        assert_eq!(result.x.value(), g.x.value());
        assert_eq!(result.y.value(), g.y.value());

        // id + g = g
        let result2 = id.add(g);
        assert_eq!(result2.x.value(), g.x.value());
        assert_eq!(result2.y.value(), g.y.value());
    }

    #[test]
    fn test_inverse() {
        let g = CIRCLE_GENERATOR;
        let neg_g = g.neg();
        let should_be_id = g.add(neg_g);

        assert_eq!(should_be_id.x.value(), 1);
        assert_eq!(should_be_id.y.value(), 0);
    }

    #[test]
    fn test_double_equals_add() {
        let g = CIRCLE_GENERATOR;
        let g2_add = g.add(g);
        let g2_double = g.double();

        assert_eq!(g2_add.x.value(), g2_double.x.value());
        assert_eq!(g2_add.y.value(), g2_double.y.value());
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

        // 2 * g should match double
        let two_g = g.mul(2);
        let g_doubled = g.double();
        assert_eq!(two_g.x.value(), g_doubled.x.value());
        assert_eq!(two_g.y.value(), g_doubled.y.value());

        // 3 * g = 2 * g + g
        let three_g = g.mul(3);
        let expected = g.double().add(g);
        assert_eq!(three_g.x.value(), expected.x.value());
        assert_eq!(three_g.y.value(), expected.y.value());
    }

    #[test]
    fn test_subgroup_generator() {
        // Generator for subgroup of order 2^4 = 16
        let g16 = subgroup_generator(4);
        assert!(g16.is_on_circle());

        // g^16 should be identity
        let g16_to_16 = g16.mul(16);
        assert_eq!(g16_to_16.x.value(), 1);
        assert_eq!(g16_to_16.y.value(), 0);

        // g^8 should NOT be identity (half the order)
        let g16_to_8 = g16.mul(8);
        assert!(g16_to_8.x.value() != 1 || g16_to_8.y.value() != 0);
    }

    #[test]
    fn test_compute_domain() {
        let log_size = 4;
        let domain = compute_domain(log_size);

        assert_eq!(domain.len(), 16);

        // All points should be on the circle
        for p in &domain {
            assert!(p.is_on_circle());
        }

        // First point is identity
        assert_eq!(domain[0].x.value(), 1);
        assert_eq!(domain[0].y.value(), 0);

        // Points should be distinct
        for i in 0..domain.len() {
            for j in (i + 1)..domain.len() {
                assert!(
                    domain[i] != domain[j],
                    "Points {} and {} are equal",
                    i,
                    j
                );
            }
        }
    }

    #[test]
    fn test_coset_iteration() {
        let coset = Coset::new(4);
        let points: Vec<_> = coset.iter().collect();

        assert_eq!(points.len(), 16);

        // Compare with compute_domain
        let domain = compute_domain(4);
        for (i, (p1, p2)) in points.iter().zip(domain.iter()).enumerate() {
            assert_eq!(p1.x.value(), p2.x.value(), "x mismatch at index {}", i);
            assert_eq!(p1.y.value(), p2.y.value(), "y mismatch at index {}", i);
        }
    }

    #[test]
    fn test_repeated_double() {
        let g = CIRCLE_GENERATOR;

        let doubled_3 = g.repeated_double(3);
        let expected = g.mul(8); // 2^3 = 8

        assert_eq!(doubled_3.x.value(), expected.x.value());
        assert_eq!(doubled_3.y.value(), expected.y.value());
    }

    #[test]
    fn test_subtraction() {
        let g = CIRCLE_GENERATOR;
        let g2 = g.double();

        let diff = g2.sub(g);
        assert_eq!(diff.x.value(), g.x.value());
        assert_eq!(diff.y.value(), g.y.value());
    }

    #[test]
    fn test_antipodal() {
        let g = CIRCLE_GENERATOR;
        let anti = g.antipodal();

        assert_eq!(anti.x.value(), (-g.x).value());
        assert_eq!(anti.y.value(), (-g.y).value());

        // Antipodal is also on the circle
        assert!(anti.is_on_circle());
    }

    #[test]
    fn test_associativity() {
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
    fn test_commutativity() {
        let g = CIRCLE_GENERATOR;
        let a = g.mul(5);
        let b = g.mul(7);

        // a + b = b + a
        let ab = a.add(b);
        let ba = b.add(a);

        assert_eq!(ab.x.value(), ba.x.value());
        assert_eq!(ab.y.value(), ba.y.value());
    }
}
