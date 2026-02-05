/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const generate_commitment: (a: number, b: number, c: number, d: number) => [number, number];
export const generate_nullifier: (a: number, b: number, c: number) => [number, number];
export const generate_proof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
export const verify_commitment: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
export const get_sdk_version: () => [number, number];
export const __wbindgen_malloc: (a: number, b: number) => number;
export const __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_externrefs: WebAssembly.Table;
export const __wbindgen_free: (a: number, b: number, c: number) => void;
export const __wbindgen_start: () => void;
