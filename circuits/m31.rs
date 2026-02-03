//! M31 (Mersenne-31) field implementation for Murkl
//! 
//! The Mersenne-31 prime: p = 2^31 - 1 = 2147483647
//! 
//! This field is used by Circle STARKs for efficient arithmetic.
//! All operations fit in 32-bit integers with fast modular reduction.

/// The Mersenne-31 prime
pub const M31_PRIME: u32 = (1 << 31) - 1; // 2147483647

/// An element of the M31 field
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct M31(pub u32);

impl M31 {
    pub const ZERO: Self = Self(0);
    pub const ONE: Self = Self(1);

    /// Create a new M31 element, reducing modulo p
    #[inline]
    pub fn new(value: u32) -> Self {
        Self(Self::reduce(value as u64))
    }

    /// Fast modular reduction for M31
    /// Uses the identity: x mod (2^31 - 1) = (x & p) + (x >> 31)
    #[inline]
    pub fn reduce(x: u64) -> u32 {
        let low = (x & M31_PRIME as u64) as u32;
        let high = (x >> 31) as u32;
        let sum = low + high;
        // One more reduction if needed
        if sum >= M31_PRIME {
            sum - M31_PRIME
        } else {
            sum
        }
    }

    /// Addition in M31
    #[inline]
    pub fn add(self, other: Self) -> Self {
        let sum = self.0 as u64 + other.0 as u64;
        Self(Self::reduce(sum))
    }

    /// Subtraction in M31
    #[inline]
    pub fn sub(self, other: Self) -> Self {
        if self.0 >= other.0 {
            Self(self.0 - other.0)
        } else {
            Self(M31_PRIME - other.0 + self.0)
        }
    }

    /// Multiplication in M31
    #[inline]
    pub fn mul(self, other: Self) -> Self {
        let prod = self.0 as u64 * other.0 as u64;
        Self(Self::reduce(prod))
    }

    /// Square (slightly optimized)
    #[inline]
    pub fn square(self) -> Self {
        let sq = (self.0 as u64).pow(2);
        Self(Self::reduce(sq))
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
    pub fn inv(self) -> Self {
        debug_assert!(!self.is_zero(), "Cannot invert zero");
        self.pow(M31_PRIME - 2)
    }

    /// Division in M31
    pub fn div(self, other: Self) -> Self {
        self.mul(other.inv())
    }

    /// Negation in M31
    #[inline]
    pub fn neg(self) -> Self {
        if self.0 == 0 {
            self
        } else {
            Self(M31_PRIME - self.0)
        }
    }

    /// Check if zero
    #[inline]
    pub fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Get the inner value
    #[inline]
    pub fn value(self) -> u32 {
        self.0
    }

    /// Convert to bytes (little-endian)
    pub fn to_le_bytes(self) -> [u8; 4] {
        self.0.to_le_bytes()
    }

    /// Convert from bytes (little-endian)
    pub fn from_le_bytes(bytes: [u8; 4]) -> Self {
        Self::new(u32::from_le_bytes(bytes))
    }
}

impl From<u32> for M31 {
    fn from(value: u32) -> Self {
        Self::new(value)
    }
}

impl From<M31> for u32 {
    fn from(value: M31) -> Self {
        value.0
    }
}

// Operator overloads for ergonomics
impl std::ops::Add for M31 {
    type Output = Self;
    fn add(self, other: Self) -> Self { M31::add(self, other) }
}

impl std::ops::Sub for M31 {
    type Output = Self;
    fn sub(self, other: Self) -> Self { M31::sub(self, other) }
}

impl std::ops::Mul for M31 {
    type Output = Self;
    fn mul(self, other: Self) -> Self { M31::mul(self, other) }
}

impl std::ops::Neg for M31 {
    type Output = Self;
    fn neg(self) -> Self { M31::neg(self) }
}

impl std::ops::AddAssign for M31 {
    fn add_assign(&mut self, other: Self) { *self = *self + other; }
}

impl std::ops::SubAssign for M31 {
    fn sub_assign(&mut self, other: Self) { *self = *self - other; }
}

impl std::ops::MulAssign for M31 {
    fn mul_assign(&mut self, other: Self) { *self = *self * other; }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let a = M31::new(M31_PRIME);
        assert_eq!(a.value(), 0);
        
        let b = M31::new(M31_PRIME + 1);
        assert_eq!(b.value(), 1);
        
        let c = M31::new(M31_PRIME + 100);
        assert_eq!(c.value(), 100);
    }

    #[test]
    fn test_inverse() {
        let a = M31::new(12345);
        let a_inv = a.inv();
        let product = a * a_inv;
        assert_eq!(product.value(), 1);
    }

    #[test]
    fn test_negation() {
        let a = M31::new(100);
        let neg_a = -a;
        assert_eq!((a + neg_a).value(), 0);
    }

    #[test]
    fn test_pow() {
        let a = M31::new(2);
        assert_eq!(a.pow(10).value(), 1024);
        
        // a^(p-1) = 1 by Fermat's little theorem
        let b = M31::new(12345);
        assert_eq!(b.pow(M31_PRIME - 1).value(), 1);
    }
}
