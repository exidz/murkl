//! Circle group implementation for Murkl (Circle STARKs)
//! 
//! The circle curve: x² + y² = 1 over M31
//! 
//! Points on this curve form a cyclic group of order p + 1 = 2^31
//! This power-of-two order enables efficient FFT operations.

use super::m31::{M31, M31_PRIME};

/// A point on the circle x² + y² = 1 over M31
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CirclePoint {
    pub x: M31,
    pub y: M31,
}

impl CirclePoint {
    /// The identity element (1, 0)
    pub const IDENTITY: Self = Self {
        x: M31(1),
        y: M31(0),
    };

    /// Create a new circle point (unchecked)
    pub fn new_unchecked(x: M31, y: M31) -> Self {
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

    /// Antipodal point: (-x, -y) — opposite on the circle
    pub fn antipodal(self) -> Self {
        Self {
            x: -self.x,
            y: -self.y,
        }
    }
}

/// Standard generator for the M31 circle group
/// Order of this generator is 2^31 (the full group)
/// 
/// G = (2, y) where y = sqrt(1 - 4) = sqrt(-3) in M31
/// sqrt(-3) mod (2^31 - 1) = 1268011823
pub const CIRCLE_GENERATOR: CirclePoint = CirclePoint {
    x: M31(2),
    y: M31(1268011823),
};

/// Get a generator for a subgroup of order 2^log_size
/// 
/// The full group has order 2^31, so we compute G^(2^(31-log_size))
/// which generates a subgroup of the desired order.
pub fn subgroup_generator(log_size: u32) -> CirclePoint {
    assert!(log_size <= 31, "Subgroup order exceeds group order");
    if log_size == 0 {
        return CirclePoint::IDENTITY;
    }
    
    let exp = 1u32 << (31 - log_size);
    CIRCLE_GENERATOR.mul(exp)
}

/// Compute all powers of a generator (domain for polynomial evaluation)
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
        // x² + y² should equal 1
        let x2 = g.x.square();
        let y2 = g.y.square();
        let sum = x2 + y2;
        assert_eq!(sum.value(), 1, "Generator not on circle: x²+y² = {}", sum.value());
    }

    #[test]
    fn test_group_identity() {
        let g = CIRCLE_GENERATOR;
        let id = CirclePoint::IDENTITY;
        
        // g + id = g
        let result = g.add(id);
        assert_eq!(result.x.value(), g.x.value());
        assert_eq!(result.y.value(), g.y.value());
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
    }
}
