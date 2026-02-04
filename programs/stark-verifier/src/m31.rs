//! M31 (Mersenne-31) and QM31 field arithmetic for on-chain STARK verification
//!
//! M31 prime: p = 2^31 - 1 = 2147483647
//! QM31: Degree-4 extension of M31 for FRI folding
//!
//! NO SHORTCUTS. Proper field arithmetic with exact equality checks.

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
    /// Uses the identity: x = (x mod 2^31) + (x >> 31)
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
        // Multi-step reduction for 64-bit values
        let low = (x & P as u64) as u32;
        let mid = ((x >> 31) & P as u64) as u32;
        let high = (x >> 62) as u32;
        
        let sum1 = low.wrapping_add(mid);
        let carry1 = sum1 >> 31;
        let reduced1 = (sum1 & P) + carry1;
        
        let sum2 = reduced1.wrapping_add(high);
        let carry2 = sum2 >> 31;
        let reduced2 = (sum2 & P) + carry2;
        
        if reduced2 >= P { reduced2 - P } else { reduced2 }
    }

    /// Addition in M31
    #[inline]
    pub const fn add(self, other: Self) -> Self {
        let sum = self.0 as u64 + other.0 as u64;
        Self(Self::reduce_u64(sum))
    }

    /// Subtraction in M31
    #[inline]
    pub const fn sub(self, other: Self) -> Self {
        // a - b = a + (p - b) mod p
        let diff = self.0 as u64 + P as u64 - other.0 as u64;
        Self(Self::reduce_u64(diff))
    }

    /// Multiplication in M31
    #[inline]
    pub const fn mul(self, other: Self) -> Self {
        let prod = self.0 as u64 * other.0 as u64;
        Self(Self::reduce_u64(prod))
    }

    /// Negation in M31
    #[inline]
    pub const fn neg(self) -> Self {
        if self.0 == 0 { Self::ZERO } else { Self(P - self.0) }
    }

    /// Square in M31
    #[inline]
    pub const fn square(self) -> Self {
        self.mul(self)
    }

    /// Power using binary exponentiation
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
        debug_assert!(self.0 != 0, "Cannot invert zero");
        self.pow(P - 2)
    }

    /// Division in M31
    #[inline]
    pub fn div(self, other: Self) -> Self {
        self.mul(other.inv())
    }

    /// Convert to little-endian bytes
    pub fn to_le_bytes(self) -> [u8; 4] {
        self.0.to_le_bytes()
    }

    /// Convert from little-endian bytes
    pub fn from_le_bytes(bytes: [u8; 4]) -> Self {
        Self::new(u32::from_le_bytes(bytes))
    }
}

/// QM31 - Degree 4 extension of M31
/// 
/// Represented as a + b*i + c*u + d*iu where:
/// - i² = -1 (complex extension)
/// - u² = 2 + i (degree 2 extension over CM31)
/// - iu = u*i
///
/// This gives QM31 = M31[i][u] with the above relations.
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

    /// Create a new QM31 element
    pub fn new(a: M31, b: M31, c: M31, d: M31) -> Self {
        Self { a, b, c, d }
    }

    /// Create from a single M31 element (a + 0*i + 0*u + 0*iu)
    pub fn from_m31(x: M31) -> Self {
        Self { a: x, b: M31::ZERO, c: M31::ZERO, d: M31::ZERO }
    }

    /// Check exact equality (NOT the broken always-true version)
    #[inline]
    pub fn eq(&self, other: &Self) -> bool {
        self.a == other.a && self.b == other.b && self.c == other.c && self.d == other.d
    }

    /// Addition in QM31 (component-wise)
    pub fn add(self, other: Self) -> Self {
        Self {
            a: self.a.add(other.a),
            b: self.b.add(other.b),
            c: self.c.add(other.c),
            d: self.d.add(other.d),
        }
    }

    /// Subtraction in QM31 (component-wise)
    pub fn sub(self, other: Self) -> Self {
        Self {
            a: self.a.sub(other.a),
            b: self.b.sub(other.b),
            c: self.c.sub(other.c),
            d: self.d.sub(other.d),
        }
    }

    /// Negation in QM31
    pub fn neg(self) -> Self {
        Self {
            a: self.a.neg(),
            b: self.b.neg(),
            c: self.c.neg(),
            d: self.d.neg(),
        }
    }

    /// Multiplication in QM31
    /// 
    /// Using: i² = -1, u² = 2 + i
    /// 
    /// Let x = (a + bi) + (c + di)u and y = (e + fi) + (g + hi)u
    /// Then xy = (a+bi)(e+fi) + [(a+bi)(g+hi) + (c+di)(e+fi)]u + (c+di)(g+hi)u²
    /// 
    /// With u² = 2 + i:
    /// (c+di)(g+hi)u² = (c+di)(g+hi)(2+i) = (cg-dh + 2cg-2dh + chi + dgi)(more terms)
    pub fn mul(self, other: Self) -> Self {
        // Complex multiplication helper: (a+bi)(c+di) = (ac-bd) + (ad+bc)i
        let mul_cm31 = |a: M31, b: M31, c: M31, d: M31| -> (M31, M31) {
            let real = a.mul(c).sub(b.mul(d));
            let imag = a.mul(d).add(b.mul(c));
            (real, imag)
        };

        // x = x0 + x1*u where x0 = a+bi, x1 = c+di
        // y = y0 + y1*u where y0 = e+fi, y1 = g+hi
        let (e, f) = (other.a, other.b);
        let (g, h) = (other.c, other.d);

        // x0*y0
        let (r0, i0) = mul_cm31(self.a, self.b, e, f);
        
        // x0*y1 + x1*y0
        let (r1a, i1a) = mul_cm31(self.a, self.b, g, h);
        let (r1b, i1b) = mul_cm31(self.c, self.d, e, f);
        let (r1, i1) = (r1a.add(r1b), i1a.add(i1b));
        
        // x1*y1 * u² = x1*y1 * (2+i)
        let (cg_dh, ch_dg) = mul_cm31(self.c, self.d, g, h);
        // (cg-dh + (ch+dg)i)(2+i) = 2(cg-dh) - (ch+dg) + (2(ch+dg) + (cg-dh))i
        let r2_real = cg_dh.mul(M31::new(2)).sub(ch_dg);
        let r2_imag = ch_dg.mul(M31::new(2)).add(cg_dh);

        // Result: (r0 + r2_real) + (i0 + r2_imag)i + r1*u + i1*iu
        Self {
            a: r0.add(r2_real),
            b: i0.add(r2_imag),
            c: r1,
            d: i1,
        }
    }

    /// Square in QM31
    pub fn square(self) -> Self {
        self.mul(self)
    }

    /// Power using binary exponentiation
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

    /// Norm of QM31 (product with conjugate, gives CM31)
    /// For x in QM31, norm(x) = x * conj(x) is in CM31
    fn norm_cm31(self) -> (M31, M31) {
        // conj(a + bi + cu + diu) = a + bi - cu - diu (conjugate over u)
        // x * conj(x) = (a+bi)² - (c+di)²u² 
        // = (a²-b² + 2abi) - (c²-d² + 2cdi)(2+i)
        
        let a2_b2 = self.a.mul(self.a).sub(self.b.mul(self.b));
        let two_ab = self.a.mul(self.b).mul(M31::new(2));
        
        let c2_d2 = self.c.mul(self.c).sub(self.d.mul(self.d));
        let two_cd = self.c.mul(self.d).mul(M31::new(2));
        
        // (c²-d² + 2cdi)(2+i) = 2(c²-d²) - 2cd + (c²-d² + 4cd)i
        let u2_real = c2_d2.mul(M31::new(2)).sub(two_cd);
        let u2_imag = c2_d2.add(two_cd.mul(M31::new(2)));
        
        (a2_b2.sub(u2_real), two_ab.sub(u2_imag))
    }

    /// Multiplicative inverse in QM31
    /// x^(-1) = conj(x) / norm(x)
    pub fn inv(self) -> Self {
        // First get norm in CM31
        let (nr, ni) = self.norm_cm31();
        
        // Norm of CM31 element to get M31
        // norm_m31((r + si)) = r² + s² (since i² = -1)
        let norm_m31 = nr.mul(nr).add(ni.mul(ni));
        let norm_inv = norm_m31.inv();
        
        // conj of CM31: (r + si) -> (r - si)
        // (r - si) / (r² + s²)
        let cm31_inv_r = nr.mul(norm_inv);
        let cm31_inv_i = ni.neg().mul(norm_inv);
        
        // conj(x) = (a + bi) - (c + di)u
        // result = conj(x) * cm31_inv
        // = [(a+bi) - (c+di)u] * (cm31_inv_r + cm31_inv_i * i)
        
        // (a+bi)(r+si) = ar-bs + (as+br)i
        let res_a = self.a.mul(cm31_inv_r).sub(self.b.mul(cm31_inv_i));
        let res_b = self.a.mul(cm31_inv_i).add(self.b.mul(cm31_inv_r));
        
        // -(c+di)(r+si) = -(cr-ds + (cs+dr)i) 
        let res_c = self.c.mul(cm31_inv_r).sub(self.d.mul(cm31_inv_i)).neg();
        let res_d = self.c.mul(cm31_inv_i).add(self.d.mul(cm31_inv_r)).neg();
        
        Self { a: res_a, b: res_b, c: res_c, d: res_d }
    }

    /// Convert to 16 bytes (little-endian)
    pub fn to_le_bytes(self) -> [u8; 16] {
        let mut bytes = [0u8; 16];
        bytes[0..4].copy_from_slice(&self.a.to_le_bytes());
        bytes[4..8].copy_from_slice(&self.b.to_le_bytes());
        bytes[8..12].copy_from_slice(&self.c.to_le_bytes());
        bytes[12..16].copy_from_slice(&self.d.to_le_bytes());
        bytes
    }

    /// Convert from 16 bytes (little-endian)
    pub fn from_le_bytes(bytes: [u8; 16]) -> Self {
        Self {
            a: M31::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            b: M31::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
            c: M31::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]),
            d: M31::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_m31_basic() {
        let a = M31::new(100);
        let b = M31::new(200);
        assert_eq!(a.add(b), M31::new(300));
        assert_eq!(b.sub(a), M31::new(100));
        assert_eq!(a.mul(b), M31::new(20000));
    }

    #[test]
    fn test_m31_overflow() {
        let a = M31::new(P - 1);
        let b = M31::new(2);
        // (P-1) + 2 = P + 1 ≡ 1 (mod P)
        assert_eq!(a.add(b), M31::ONE);
    }

    #[test]
    fn test_m31_inverse() {
        let a = M31::new(12345);
        let inv = a.inv();
        assert_eq!(a.mul(inv), M31::ONE);

        let b = M31::new(P - 1);
        let inv_b = b.inv();
        assert_eq!(b.mul(inv_b), M31::ONE);
    }

    #[test]
    fn test_qm31_eq() {
        let a = QM31::new(M31::new(1), M31::new(2), M31::new(3), M31::new(4));
        let b = QM31::new(M31::new(1), M31::new(2), M31::new(3), M31::new(4));
        let c = QM31::new(M31::new(1), M31::new(2), M31::new(3), M31::new(5));
        
        assert!(a.eq(&b));
        assert!(!a.eq(&c)); // This would fail with the broken qm31_close!
    }

    #[test]
    fn test_qm31_add_sub() {
        let a = QM31::new(M31::new(10), M31::new(20), M31::new(30), M31::new(40));
        let b = QM31::new(M31::new(1), M31::new(2), M31::new(3), M31::new(4));
        
        let sum = a.add(b);
        assert_eq!(sum.a, M31::new(11));
        assert_eq!(sum.b, M31::new(22));
        
        let diff = a.sub(b);
        assert_eq!(diff.a, M31::new(9));
        assert_eq!(diff.b, M31::new(18));
    }

    #[test]
    fn test_qm31_mul_identity() {
        let a = QM31::new(M31::new(123), M31::new(456), M31::new(789), M31::new(101112));
        let result = a.mul(QM31::ONE);
        assert!(result.eq(&a));
    }

    #[test]
    fn test_qm31_inverse() {
        let a = QM31::new(M31::new(12345), M31::new(67890), M31::new(11111), M31::new(22222));
        let inv = a.inv();
        let product = a.mul(inv);
        
        assert!(product.eq(&QM31::ONE));
    }

    #[test]
    fn test_qm31_pow() {
        let a = QM31::new(M31::new(2), M31::ZERO, M31::ZERO, M31::ZERO);
        let a_squared = a.pow(2);
        let expected = a.mul(a);
        assert!(a_squared.eq(&expected));
        
        let a_cubed = a.pow(3);
        let expected3 = a.mul(a).mul(a);
        assert!(a_cubed.eq(&expected3));
    }
}
