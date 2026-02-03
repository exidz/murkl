//! AIR (Algebraic Intermediate Representation) constraints
//!
//! Defines the constraint system for Circle STARKs.

#[cfg(not(feature = "std"))]
use alloc::{vec, vec::Vec, string::String};

use crate::m31::M31;

/// Configuration for AIR constraints
#[derive(Clone, Debug)]
pub struct AirConfig {
    /// Log2 of the trace length
    pub log_trace_length: u32,
    /// Number of columns in the trace
    pub num_columns: usize,
    /// Number of public inputs
    pub num_public_inputs: usize,
}

impl AirConfig {
    /// Create a new AIR config
    pub fn new(log_trace_length: u32, num_columns: usize, num_public_inputs: usize) -> Self {
        Self {
            log_trace_length,
            num_columns,
            num_public_inputs,
        }
    }

    /// Trace length
    pub fn trace_length(&self) -> usize {
        1 << self.log_trace_length
    }
}

/// A column in the execution trace
#[derive(Clone, Debug)]
pub struct TraceColumn {
    /// Column index
    pub index: usize,
    /// Column values
    pub values: Vec<M31>,
}

impl TraceColumn {
    /// Create a new column
    pub fn new(index: usize, values: Vec<M31>) -> Self {
        Self { index, values }
    }

    /// Get value at row i
    pub fn at(&self, row: usize) -> M31 {
        self.values[row % self.values.len()]
    }

    /// Get value at row i + offset (with wrapping)
    pub fn at_offset(&self, row: usize, offset: i32) -> M31 {
        let len = self.values.len() as i32;
        let idx = ((row as i32 + offset) % len + len) % len;
        self.values[idx as usize]
    }
}

/// Execution trace (multiple columns)
#[derive(Clone, Debug)]
pub struct Trace {
    /// Columns of the trace
    pub columns: Vec<TraceColumn>,
    /// Number of rows
    pub num_rows: usize,
}

impl Trace {
    /// Create a new trace
    pub fn new(columns: Vec<TraceColumn>) -> Self {
        let num_rows = columns.first().map(|c| c.values.len()).unwrap_or(0);
        Self { columns, num_rows }
    }

    /// Create trace from a 2D array (row-major)
    pub fn from_rows(rows: Vec<Vec<M31>>) -> Self {
        if rows.is_empty() {
            return Self {
                columns: vec![],
                num_rows: 0,
            };
        }

        let num_cols = rows[0].len();
        let num_rows = rows.len();

        let columns = (0..num_cols)
            .map(|col_idx| {
                let values: Vec<M31> = rows.iter().map(|row| row[col_idx]).collect();
                TraceColumn::new(col_idx, values)
            })
            .collect();

        Self { columns, num_rows }
    }

    /// Get number of columns
    pub fn num_columns(&self) -> usize {
        self.columns.len()
    }

    /// Get a specific cell
    pub fn get(&self, row: usize, col: usize) -> M31 {
        self.columns[col].at(row)
    }

    /// Get log2 of trace length
    pub fn log_length(&self) -> u32 {
        (self.num_rows as f64).log2() as u32
    }
}

/// A polynomial constraint
#[derive(Clone, Debug)]
pub struct Constraint {
    /// Constraint name (for debugging)
    pub name: String,
    /// Degree of the constraint polynomial
    pub degree: usize,
    /// Columns involved in this constraint
    pub columns: Vec<usize>,
}

impl Constraint {
    /// Create a new constraint
    pub fn new(name: impl Into<String>, degree: usize, columns: Vec<usize>) -> Self {
        Self {
            name: name.into(),
            degree,
            columns,
        }
    }
}

/// Constraint evaluator trait
pub trait ConstraintEvaluator {
    /// Evaluate all constraints at a given row
    fn evaluate(&self, trace: &Trace, row: usize) -> Vec<M31>;

    /// Get constraint definitions
    fn constraints(&self) -> Vec<Constraint>;

    /// Maximum constraint degree
    fn max_degree(&self) -> usize {
        self.constraints().iter().map(|c| c.degree).max().unwrap_or(0)
    }
}

/// Fibonacci constraint system (example)
///
/// Proves: f[i+2] = f[i+1] + f[i] for all i
#[derive(Clone, Debug)]
pub struct FibonacciAir {
    /// Number of rows
    pub num_rows: usize,
}

impl FibonacciAir {
    pub fn new(num_rows: usize) -> Self {
        Self { num_rows }
    }

    /// Generate Fibonacci trace
    pub fn generate_trace(&self, a: M31, b: M31) -> Trace {
        let mut values = Vec::with_capacity(self.num_rows);
        values.push(a);
        values.push(b);

        for i in 2..self.num_rows {
            values.push(values[i - 1] + values[i - 2]);
        }

        Trace::new(vec![TraceColumn::new(0, values)])
    }
}

impl ConstraintEvaluator for FibonacciAir {
    fn evaluate(&self, trace: &Trace, row: usize) -> Vec<M31> {
        let col = &trace.columns[0];

        // f[i+2] - f[i+1] - f[i] = 0
        let constraint = col.at_offset(row, 2) - col.at_offset(row, 1) - col.at(row);

        vec![constraint]
    }

    fn constraints(&self) -> Vec<Constraint> {
        vec![Constraint::new("fibonacci", 1, vec![0])]
    }
}

/// Murkl-specific AIR for Merkle membership proofs
#[derive(Clone, Debug)]
pub struct MurklAir {
    /// Tree depth
    pub tree_depth: usize,
    /// Number of columns per Merkle level
    pub cols_per_level: usize,
}

impl MurklAir {
    /// Create AIR for Merkle proofs with given tree depth
    pub fn new(tree_depth: usize) -> Self {
        Self {
            tree_depth,
            // Each level: current, sibling, path_bit, output
            cols_per_level: 4,
        }
    }

    /// Total number of columns needed
    pub fn num_columns(&self) -> usize {
        // Commitment columns + Merkle levels + nullifier columns
        3 + self.tree_depth * self.cols_per_level + 3
    }
}

impl ConstraintEvaluator for MurklAir {
    fn evaluate(&self, trace: &Trace, row: usize) -> Vec<M31> {
        let mut constraints = Vec::new();

        // Skip if not enough columns
        if trace.num_columns() < self.num_columns() {
            return vec![M31::ZERO; self.tree_depth + 2];
        }

        let mut col = 0;

        // === Commitment verification ===
        let _identifier = trace.get(row, col);
        col += 1;
        let secret = trace.get(row, col);
        col += 1;
        let _leaf = trace.get(row, col);
        col += 1;

        // === Merkle path verification ===
        for _level in 0..self.tree_depth {
            let _current = trace.get(row, col);
            col += 1;
            let _sibling = trace.get(row, col);
            col += 1;
            let path_bit = trace.get(row, col);
            col += 1;
            let _next = trace.get(row, col);
            col += 1;

            // Constraint: path_bit must be boolean (0 or 1)
            // path_bit * (1 - path_bit) = 0
            constraints.push(path_bit * (M31::ONE - path_bit));
        }

        // === Root verification ===
        let _merkle_root = trace.get(row, col);
        col += 1;

        // === Nullifier verification ===
        let null_secret = trace.get(row, col);
        col += 1;
        let _leaf_index = trace.get(row, col);
        col += 1;
        let _nullifier = trace.get(row, col);

        // Constraint: nullifier secret must match commitment secret
        constraints.push(null_secret - secret);

        constraints
    }

    fn constraints(&self) -> Vec<Constraint> {
        let mut constraints = Vec::new();

        // Boolean constraints for each path bit
        for level in 0..self.tree_depth {
            constraints.push(Constraint::new(
                format!("path_bit_boolean_{}", level),
                2,  // Degree 2: x * (1-x)
                vec![3 + level * self.cols_per_level + 2],
            ));
        }

        // Secret consistency constraint
        constraints.push(Constraint::new(
            "secret_consistency",
            1,
            vec![1, 3 + self.tree_depth * self.cols_per_level + 1],
        ));

        constraints
    }
}

/// Compute the composition polynomial from constraint evaluations
pub fn compose_constraints(
    constraint_evals: &[Vec<M31>],
    random_coefficients: &[M31],
) -> Vec<M31> {
    if constraint_evals.is_empty() {
        return vec![];
    }

    let num_rows = constraint_evals.len();
    let _num_constraints = constraint_evals[0].len();

    let mut composition = vec![M31::ZERO; num_rows];

    for (row, evals) in constraint_evals.iter().enumerate() {
        for (i, &eval) in evals.iter().enumerate() {
            let coeff = random_coefficients.get(i).copied().unwrap_or(M31::ONE);
            composition[row] = composition[row] + eval * coeff;
        }
    }

    composition
}

/// Verify that all constraints evaluate to zero
pub fn verify_constraints<E: ConstraintEvaluator>(
    evaluator: &E,
    trace: &Trace,
) -> Result<(), Vec<(usize, String)>> {
    let mut failures = Vec::new();
    let constraints = evaluator.constraints();

    for row in 0..trace.num_rows.saturating_sub(2) {
        let evals = evaluator.evaluate(trace, row);

        for (i, eval) in evals.iter().enumerate() {
            if !eval.is_zero() {
                let name = constraints.get(i)
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| format!("constraint_{}", i));
                failures.push((row, name));
            }
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trace_creation() {
        let rows = vec![
            vec![M31::new(1), M31::new(2)],
            vec![M31::new(3), M31::new(4)],
            vec![M31::new(5), M31::new(6)],
        ];

        let trace = Trace::from_rows(rows);

        assert_eq!(trace.num_rows, 3);
        assert_eq!(trace.num_columns(), 2);
        assert_eq!(trace.get(0, 0).value(), 1);
        assert_eq!(trace.get(1, 1).value(), 4);
    }

    #[test]
    fn test_fibonacci_air() {
        let air = FibonacciAir::new(16);
        let trace = air.generate_trace(M31::ONE, M31::ONE);

        // Verify Fibonacci sequence
        assert_eq!(trace.get(0, 0).value(), 1);
        assert_eq!(trace.get(1, 0).value(), 1);
        assert_eq!(trace.get(2, 0).value(), 2);
        assert_eq!(trace.get(3, 0).value(), 3);
        assert_eq!(trace.get(4, 0).value(), 5);
        assert_eq!(trace.get(5, 0).value(), 8);
    }

    #[test]
    fn test_fibonacci_constraints() {
        let air = FibonacciAir::new(16);
        let trace = air.generate_trace(M31::ONE, M31::ONE);

        // All constraints should evaluate to zero
        for row in 0..14 {
            let evals = air.evaluate(&trace, row);
            assert!(
                evals[0].is_zero(),
                "Constraint failed at row {}: {}",
                row,
                evals[0].value()
            );
        }
    }

    #[test]
    fn test_verify_constraints() {
        let air = FibonacciAir::new(16);
        let trace = air.generate_trace(M31::ONE, M31::ONE);

        let result = verify_constraints(&air, &trace);
        assert!(result.is_ok());
    }

    #[test]
    fn test_fibonacci_constraint_violation() {
        let air = FibonacciAir::new(8);

        // Create invalid trace (not Fibonacci)
        let values: Vec<M31> = (0..8).map(|i| M31::new(i)).collect();
        let trace = Trace::new(vec![TraceColumn::new(0, values)]);

        let result = verify_constraints(&air, &trace);
        assert!(result.is_err());
    }

    #[test]
    fn test_murkl_air_columns() {
        let air = MurklAir::new(16);

        // 3 commitment + 16*4 merkle + 3 nullifier = 70
        assert_eq!(air.num_columns(), 70);
    }

    #[test]
    fn test_compose_constraints() {
        let evals = vec![
            vec![M31::new(1), M31::new(2)],
            vec![M31::new(3), M31::new(4)],
        ];
        let coeffs = vec![M31::new(10), M31::new(100)];

        let composition = compose_constraints(&evals, &coeffs);

        // Row 0: 1*10 + 2*100 = 210
        assert_eq!(composition[0].value(), 210);
        // Row 1: 3*10 + 4*100 = 430
        assert_eq!(composition[1].value(), 430);
    }

    #[test]
    fn test_constraint_max_degree() {
        let air = MurklAir::new(8);
        let constraints = air.constraints();

        let max_deg = air.max_degree();
        assert_eq!(max_deg, 2); // Boolean constraint is degree 2
    }
}
