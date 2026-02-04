//! QM31 - Quartic extension of M31
//!
//! QM31 = M31[i][j] where i² = -1 and j² = i+2
//!
//! Elements are represented as (a + bi) + (c + di)j = a + bi + cj + dij
//! where a, b, c, d ∈ M31
//!
//! This extension provides the algebraic closure needed for Circle STARK verification.

#[cfg(not(feature = "std"))]
use alloc::vec::Vec;

use crate::m31::M31;
use core::fmt;
use core::ops::{Add, Mul, Neg, Sub};

/// QM31 extension field element
///
/// Represents a + bi + cj + dij where i² = -1, j² = i+2
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct QM31 {
    /// Coefficient of 1
    pub a: M31,
    /// Coefficient of i
    pub b: M31,
    /// Coefficient of j
    pub c: M31,
    /// Coefficient of ij
    pub d: M31,
}

impl QM31 {
    /// Zero element
    pub const ZERO: Self = Self {
        a: M31::ZERO,
        b: M31::ZERO,
        c: M31::ZERO,
        d: M31::ZERO,
    };

    /// One element
    pub const ONE: Self = Self {
        a: M31::ONE,
        b: M31::ZERO,
        c: M31::ZERO,
        d: M31::ZERO,
    };

    /// Create a new QM31 element
    #[inline]
    pub const fn new(a: M31, b: M31, c: M31, d: M31) -> Self {
        Self { a, b, c, d }
    }

    /// Create from raw u32 values
    #[inline]
    pub fn from_u32(a: u32, b: u32, c: u32, d: u32) -> Self {
        Self {
            a: M31::new(a),
            b: M31::new(b),
            c: M31::new(c),
            d: M31::new(d),
        }
    }

    /// Create from a single M31 (embedded as real part)
    #[inline]
    pub const fn from_m31(x: M31) -> Self {
        Self {
            a: x,
            b: M31::ZERO,
            c: M31::ZERO,
            d: M31::ZERO,
        }
    }

    /// Check if zero
    #[inline]
    pub fn is_zero(&self) -> bool {
        self.a.is_zero() && self.b.is_zero() && self.c.is_zero() && self.d.is_zero()
    }

    /// Conjugate: a + bi + cj + dij → a - bi + cj - dij
    #[inline]
    pub fn conjugate(&self) -> Self {
        Self {
            a: self.a,
            b: -self.b,
            c: self.c,
            d: -self.d,
        }
    }

    /// Norm: x * x̄ (returns CM31 element, but we return QM31 with c=d=0)
    pub fn norm_squared(&self) -> Self {
        let real_part = self.a * self.a + self.b * self.b + self.c * self.c + self.d * self.d;
        let imag_part = self.a * self.b.double() + self.c * self.d.double();
        Self {
            a: real_part,
            b: imag_part,
            c: M31::ZERO,
            d: M31::ZERO,
        }
    }

    /// Serialize to bytes (16 bytes, little-endian)
    #[inline]
    pub fn to_bytes(&self) -> [u8; 16] {
        let mut bytes = [0u8; 16];
        bytes[0..4].copy_from_slice(&self.a.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.b.to_le_bytes());
        bytes[8..12].copy_from_slice(&self.c.to_le_bytes());
        bytes[12..16].copy_from_slice(&self.d.to_le_bytes());
        bytes
    }

    /// Deserialize from bytes (16 bytes, little-endian)
    #[inline]
    pub fn from_bytes(bytes: &[u8]) -> Self {
        assert!(bytes.len() >= 16, "QM31::from_bytes requires 16 bytes");
        Self {
            a: M31::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            b: M31::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
            c: M31::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]),
            d: M31::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]),
        }
    }
}

impl fmt::Display for QM31 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "({} + {}i + {}j + {}ij)",
            self.a.value(),
            self.b.value(),
            self.c.value(),
            self.d.value()
        )
    }
}

impl From<M31> for QM31 {
    #[inline]
    fn from(x: M31) -> Self {
        Self::from_m31(x)
    }
}

impl Add for QM31 {
    type Output = Self;

    #[inline]
    fn add(self, rhs: Self) -> Self {
        Self {
            a: self.a + rhs.a,
            b: self.b + rhs.b,
            c: self.c + rhs.c,
            d: self.d + rhs.d,
        }
    }
}

impl Sub for QM31 {
    type Output = Self;

    #[inline]
    fn sub(self, rhs: Self) -> Self {
        Self {
            a: self.a - rhs.a,
            b: self.b - rhs.b,
            c: self.c - rhs.c,
            d: self.d - rhs.d,
        }
    }
}

impl Neg for QM31 {
    type Output = Self;

    #[inline]
    fn neg(self) -> Self {
        Self {
            a: -self.a,
            b: -self.b,
            c: -self.c,
            d: -self.d,
        }
    }
}

impl Mul for QM31 {
    type Output = Self;

    /// QM31 multiplication
    ///
    /// Using: i² = -1, j² = i + 2
    /// (a₁ + b₁i + c₁j + d₁ij)(a₂ + b₂i + c₂j + d₂ij)
    fn mul(self, rhs: Self) -> Self {
        // First compute the CM31 products (complex parts)
        // Let x₁ = a₁ + b₁i, y₁ = c₁ + d₁i
        // Let x₂ = a₂ + b₂i, y₂ = c₂ + d₂i
        // Result = x₁x₂ + y₁y₂(i+2) + (x₁y₂ + y₁x₂)j

        let x1_real = self.a;
        let x1_imag = self.b;
        let y1_real = self.c;
        let y1_imag = self.d;

        let x2_real = rhs.a;
        let x2_imag = rhs.b;
        let y2_real = rhs.c;
        let y2_imag = rhs.d;

        // x₁x₂ = (a₁a₂ - b₁b₂) + (a₁b₂ + b₁a₂)i
        let x1x2_real = x1_real * x2_real - x1_imag * x2_imag;
        let x1x2_imag = x1_real * x2_imag + x1_imag * x2_real;

        // y₁y₂ = (c₁c₂ - d₁d₂) + (c₁d₂ + d₁c₂)i
        let y1y2_real = y1_real * y2_real - y1_imag * y2_imag;
        let y1y2_imag = y1_real * y2_imag + y1_imag * y2_real;

        // y₁y₂(i+2) = y₁y₂ * 2 + y₁y₂ * i
        //           = (2*y1y2_real - y1y2_imag) + (2*y1y2_imag + y1y2_real)i
        let y1y2_times_j2_real = y1y2_real.double() - y1y2_imag;
        let y1y2_times_j2_imag = y1y2_imag.double() + y1y2_real;

        // x₁y₂ = (a₁c₂ - b₁d₂) + (a₁d₂ + b₁c₂)i
        let x1y2_real = x1_real * y2_real - x1_imag * y2_imag;
        let x1y2_imag = x1_real * y2_imag + x1_imag * y2_real;

        // y₁x₂ = (c₁a₂ - d₁b₂) + (c₁b₂ + d₁a₂)i
        let y1x2_real = y1_real * x2_real - y1_imag * x2_imag;
        let y1x2_imag = y1_real * x2_imag + y1_imag * x2_real;

        // Final result
        Self {
            a: x1x2_real + y1y2_times_j2_real,
            b: x1x2_imag + y1y2_times_j2_imag,
            c: x1y2_real + y1x2_real,
            d: x1y2_imag + y1x2_imag,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_qm31_creation() {
        let x = QM31::from_u32(1, 2, 3, 4);
        assert_eq!(x.a.value(), 1);
        assert_eq!(x.b.value(), 2);
        assert_eq!(x.c.value(), 3);
        assert_eq!(x.d.value(), 4);
    }

    #[test]
    fn test_qm31_zero_one() {
        assert!(QM31::ZERO.is_zero());
        assert!(!QM31::ONE.is_zero());
        assert_eq!(QM31::ONE.a.value(), 1);
    }

    #[test]
    fn test_qm31_from_m31() {
        let x = M31::new(42);
        let qx = QM31::from_m31(x);
        assert_eq!(qx.a, x);
        assert!(qx.b.is_zero());
        assert!(qx.c.is_zero());
        assert!(qx.d.is_zero());
    }

    #[test]
    fn test_qm31_add() {
        let x = QM31::from_u32(1, 2, 3, 4);
        let y = QM31::from_u32(5, 6, 7, 8);
        let sum = x + y;
        assert_eq!(sum.a.value(), 6);
        assert_eq!(sum.b.value(), 8);
        assert_eq!(sum.c.value(), 10);
        assert_eq!(sum.d.value(), 12);
    }

    #[test]
    fn test_qm31_sub() {
        let x = QM31::from_u32(10, 20, 30, 40);
        let y = QM31::from_u32(1, 2, 3, 4);
        let diff = x - y;
        assert_eq!(diff.a.value(), 9);
        assert_eq!(diff.b.value(), 18);
        assert_eq!(diff.c.value(), 27);
        assert_eq!(diff.d.value(), 36);
    }

    #[test]
    fn test_qm31_neg() {
        let x = QM31::from_u32(1, 2, 3, 4);
        let neg_x = -x;
        let sum = x + neg_x;
        assert!(sum.is_zero());
    }

    #[test]
    fn test_qm31_mul_identity() {
        let x = QM31::from_u32(123, 456, 789, 101);
        let prod = x * QM31::ONE;
        assert_eq!(prod, x);
    }

    #[test]
    fn test_qm31_mul_zero() {
        let x = QM31::from_u32(123, 456, 789, 101);
        let prod = x * QM31::ZERO;
        assert!(prod.is_zero());
    }

    #[test]
    fn test_qm31_mul_commutative() {
        let x = QM31::from_u32(11, 22, 33, 44);
        let y = QM31::from_u32(55, 66, 77, 88);
        assert_eq!(x * y, y * x);
    }

    #[test]
    fn test_qm31_serialization() {
        let x = QM31::from_u32(0x12345678, 0x9ABCDEF0, 0x11223344, 0x55667788);
        let bytes = x.to_bytes();
        let y = QM31::from_bytes(&bytes);
        assert_eq!(x, y);
    }

    #[test]
    fn test_qm31_conjugate() {
        let x = QM31::from_u32(1, 2, 3, 4);
        let conj = x.conjugate();
        assert_eq!(conj.a.value(), 1);
        assert_eq!(conj.c.value(), 3);
        // b and d should be negated
        assert_eq!((x.b + conj.b).value(), 0);
        assert_eq!((x.d + conj.d).value(), 0);
    }
}
