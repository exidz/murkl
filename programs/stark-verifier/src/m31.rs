//! M31 (Mersenne-31) field for on-chain STARK verification
//!
//! The Mersenne-31 prime: p = 2^31 - 1 = 2147483647

/// The Mersenne-31 prime: 2^31 - 1
pub const P: u32 = 0x7FFFFFFF;

/// M31 field element
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct M31(pub u32);

impl M31 {
    pub const ZERO: Self = Self(0);
    pub const ONE: Self = Self(1);

    /// Create new M31 element, reducing mod p
    #[inline]
    pub const fn new(value: u32) -> Self {
        Self(Self::reduce_u32(value))
    }

    /// Fast reduction for u32: x mod (2^31 - 1)
    #[inline]
    pub const fn reduce_u32(x: u32) -> u32 {
        let low = x & P;
        let high = x >> 31;
        let sum = low + high;
        if sum >= P { sum - P } else { sum }
    }

    /// Fast reduction for u64: x mod (2^31 - 1)
    #[inline]
    pub const fn reduce_u64(x: u64) -> u32 {
        let low = (x & P as u64) as u32;
        let high = (x >> 31) as u32;
        let sum = low.wrapping_add(high);
        let reduced = sum.wrapping_add(sum >> 31) & P;
        if reduced >= P { reduced - P } else { reduced }
    }

    /// Addition
    #[inline]
    pub const fn add(self, other: Self) -> Self {
        let sum = self.0 as u64 + other.0 as u64;
        Self(Self::reduce_u64(sum))
    }

    /// Subtraction  
    #[inline]
    pub const fn sub(self, other: Self) -> Self {
        let diff = self.0 as u64 + P as u64 - other.0 as u64;
        Self(Self::reduce_u64(diff))
    }

    /// Multiplication
    #[inline]
    pub const fn mul(self, other: Self) -> Self {
        let prod = self.0 as u64 * other.0 as u64;
        Self(Self::reduce_u64(prod))
    }

    /// Negation
    #[inline]
    pub const fn neg(self) -> Self {
        if self.0 == 0 { Self::ZERO } else { Self(P - self.0) }
    }

    /// Square
    #[inline]
    pub const fn square(self) -> Self {
        self.mul(self)
    }

    /// Power (binary exponentiation)
    pub fn pow(self, mut exp: u32) -> Self {
        let mut result = Self::ONE;
        let mut base = self;
        while exp > 0 {
            if exp & 1 == 1 {
                result = result.mul(base);
            }
            base = base.square();
            exp >>= 1;
        }
        result
    }

    /// Multiplicative inverse using Fermat's little theorem: a^(-1) = a^(p-2)
    #[inline]
    pub fn inv(self) -> Self {
        self.pow(P - 2)
    }

    /// Division
    #[inline]
    pub fn div(self, other: Self) -> Self {
        self.mul(other.inv())
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

/// QM31 - Degree 4 extension of M31
/// Represented as a + b*i + c*j + d*ij where i^2 = j^2 = -1, ij = -ji
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct QM31 {
    pub a: M31,
    pub b: M31,
    pub c: M31,
    pub d: M31,
}

impl QM31 {
    pub const ZERO: Self = Self { a: M31::ZERO, b: M31::ZERO, c: M31::ZERO, d: M31::ZERO };
    pub const ONE: Self = Self { a: M31::ONE, b: M31::ZERO, c: M31::ZERO, d: M31::ZERO };

    pub fn new(a: M31, b: M31, c: M31, d: M31) -> Self {
        Self { a, b, c, d }
    }

    /// Addition
    pub fn add(self, other: Self) -> Self {
        Self {
            a: self.a.add(other.a),
            b: self.b.add(other.b),
            c: self.c.add(other.c),
            d: self.d.add(other.d),
        }
    }

    /// Subtraction
    pub fn sub(self, other: Self) -> Self {
        Self {
            a: self.a.sub(other.a),
            b: self.b.sub(other.b),
            c: self.c.sub(other.c),
            d: self.d.sub(other.d),
        }
    }

    /// Multiplication (QM31 is M31[i][j] with i^2 = j^2 = -1)
    pub fn mul(self, other: Self) -> Self {
        // (a + bi)(c + di) where i^2 = -1
        // First multiply in CM31: (a + bi)(c + di) = (ac - bd) + (ad + bc)i
        // Then extend to QM31...
        
        // Simplified: treat as (a + bi) + (c + di)j
        // where (a + bi)(c + di) uses complex multiplication
        let ac = self.a.mul(other.a);
        let bd = self.b.mul(other.b);
        let ad = self.a.mul(other.d);
        let bc = self.b.mul(other.c);
        
        // Real part of first component
        let r1 = ac.sub(bd);
        // Imaginary part of first component  
        let i1 = self.a.mul(other.b).add(self.b.mul(other.a));
        
        // Second component (j terms)
        let r2 = self.c.mul(other.a).add(self.d.mul(other.b));
        let i2 = self.c.mul(other.b).add(self.d.mul(other.a));
        
        // Third component (from j*j = -1)
        let cc = self.c.mul(other.c);
        let dd = self.d.mul(other.d);
        
        Self {
            a: r1.sub(cc).sub(dd),
            b: i1.sub(self.c.mul(other.d)).sub(self.d.mul(other.c)),
            c: r2.add(ad).sub(bc),
            d: i2.add(self.a.mul(other.c)).add(self.b.mul(other.d)),
        }
    }

    /// Square
    pub fn square(self) -> Self {
        self.mul(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_m31_add() {
        let a = M31::new(100);
        let b = M31::new(200);
        assert_eq!(a.add(b), M31::new(300));
    }

    #[test]
    fn test_m31_mul() {
        let a = M31::new(1000);
        let b = M31::new(2000);
        assert_eq!(a.mul(b), M31::new(2000000));
    }

    #[test]
    fn test_m31_inv() {
        let a = M31::new(12345);
        let inv = a.inv();
        assert_eq!(a.mul(inv), M31::ONE);
    }

    #[test]
    fn test_m31_overflow() {
        let a = M31::new(P - 1);
        let b = M31::new(2);
        // (P-1) + 2 = P + 1 ≡ 1 (mod P)
        assert_eq!(a.add(b), M31::ONE);
    }
}
