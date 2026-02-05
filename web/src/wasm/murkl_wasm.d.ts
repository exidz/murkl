/* tslint:disable */
/* eslint-disable */

export function generate_commitment(identifier: string, password: string): string;

export function generate_nullifier(password: string, leaf_index: number): string;

export function generate_proof(identifier: string, password: string, leaf_index: number, merkle_root_hex: string): any;

export function get_sdk_version(): string;

export function verify_commitment(identifier: string, password: string, commitment_hex: string): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly generate_commitment: (a: number, b: number, c: number, d: number) => [number, number];
    readonly generate_nullifier: (a: number, b: number, c: number) => [number, number];
    readonly generate_proof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly verify_commitment: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly get_sdk_version: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
