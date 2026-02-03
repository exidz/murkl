//! Benchmarks for M31 field operations

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use murkl_prover::m31::{M31, M31_PRIME};

fn bench_addition(c: &mut Criterion) {
    let a = M31::new(12345);
    let b = M31::new(67890);
    
    c.bench_function("m31_add", |bench| {
        bench.iter(|| black_box(a) + black_box(b))
    });
}

fn bench_subtraction(c: &mut Criterion) {
    let a = M31::new(12345);
    let b = M31::new(67890);
    
    c.bench_function("m31_sub", |bench| {
        bench.iter(|| black_box(a) - black_box(b))
    });
}

fn bench_multiplication(c: &mut Criterion) {
    let a = M31::new(12345);
    let b = M31::new(67890);
    
    c.bench_function("m31_mul", |bench| {
        bench.iter(|| black_box(a) * black_box(b))
    });
}

fn bench_square(c: &mut Criterion) {
    let a = M31::new(12345);
    
    c.bench_function("m31_square", |bench| {
        bench.iter(|| black_box(a).square())
    });
}

fn bench_inverse(c: &mut Criterion) {
    let a = M31::new(12345);
    
    c.bench_function("m31_inv", |bench| {
        bench.iter(|| black_box(a).inv())
    });
}

fn bench_pow(c: &mut Criterion) {
    let a = M31::new(12345);
    
    let mut group = c.benchmark_group("m31_pow");
    
    for exp in [10, 100, 1000, 10000] {
        group.bench_with_input(BenchmarkId::new("exp", exp), &exp, |b, &exp| {
            b.iter(|| black_box(a).pow(exp))
        });
    }
    
    group.finish();
}

fn bench_reduction(c: &mut Criterion) {
    let large: u64 = (M31_PRIME as u64) * 1234 + 5678;
    
    c.bench_function("m31_reduce", |bench| {
        bench.iter(|| M31::reduce(black_box(large)))
    });
}

fn bench_batch_operations(c: &mut Criterion) {
    let size = 1000;
    let a: Vec<M31> = (0..size).map(|i| M31::new(i)).collect();
    let b: Vec<M31> = (0..size).map(|i| M31::new(i * 2 + 1)).collect();
    
    let mut group = c.benchmark_group("m31_batch");
    
    group.bench_function("batch_mul_scalar", |bench| {
        bench.iter(|| {
            let _: Vec<M31> = black_box(&a)
                .iter()
                .zip(black_box(&b).iter())
                .map(|(&x, &y)| x * y)
                .collect();
        })
    });
    
    group.bench_function("batch_add_scalar", |bench| {
        bench.iter(|| {
            let _: Vec<M31> = black_box(&a)
                .iter()
                .zip(black_box(&b).iter())
                .map(|(&x, &y)| x + y)
                .collect();
        })
    });
    
    group.bench_function("batch_inverse_montgomery", |bench| {
        bench.iter(|| {
            #[cfg(feature = "simd")]
            {
                murkl_prover::m31::simd::batch_inverse(black_box(&a))
            }
            #[cfg(not(feature = "simd"))]
            {
                murkl_prover::m31::batch::batch_inverse(black_box(&a))
            }
        })
    });
    
    group.finish();
}

fn bench_sum(c: &mut Criterion) {
    let values: Vec<M31> = (0..1000).map(|i| M31::new(i)).collect();
    
    c.bench_function("m31_sum_1000", |bench| {
        bench.iter(|| {
            let sum: M31 = black_box(&values).iter().copied().sum();
            sum
        })
    });
}

fn bench_product(c: &mut Criterion) {
    let values: Vec<M31> = (1..100).map(|i| M31::new(i)).collect();
    
    c.bench_function("m31_product_99", |bench| {
        bench.iter(|| {
            let prod: M31 = black_box(&values).iter().copied().product();
            prod
        })
    });
}

criterion_group!(
    benches,
    bench_addition,
    bench_subtraction,
    bench_multiplication,
    bench_square,
    bench_inverse,
    bench_pow,
    bench_reduction,
    bench_batch_operations,
    bench_sum,
    bench_product,
);

criterion_main!(benches);
